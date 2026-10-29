#!/usr/bin/env node
/**
 * End-to-end payment check: one payment from link to payout, checked at
 * every step. Write-up and expected results:
 * docs/verification/end-to-end-2026-10-30.md.
 *
 * What it does, all through the HTTP API unless noted:
 *   1. merchant signs in (password + OTP; needs the dev OTP exposed, i.e. not
 *      production) and registers a webhook endpoint
 *   2. creates a payment link for 47.333 BHD and pays it as a customer, then
 *      checks a second payment is refused
 *   3. reads the transaction and its timeline
 *   4. checks the ledger in SQL (needs DATABASE_URL): every group balances,
 *      the capture legs, the fee at the rate in effect
 *   5. waits for the transaction.captured webhook and verifies its signature
 *   6. if SETTLEMENT_BIN is set: runs settlement for today, checks the batch,
 *      the residue posting, clearing == scheme file, payout, settlement.paid
 *   7. checks reconciliation explains to zero
 *
 * Usage (from the repo root, with the API running):
 *   API_URL=http://localhost:3000 \
 *   DATABASE_URL=postgres://... \
 *   SETTLEMENT_BIN=./apps/settlement/settlement \
 *   node scripts/e2e/payment-check.mjs
 *
 * Optional: MERCHANT_ID, MERCHANT_EMAIL, MERCHANT_PASSWORD (default: the
 * seed's Alpha Retail owner), RECEIVER_PORT (default 4100), AMOUNT_FILS
 * (default 47333). Against a deployed API that cannot reach this machine,
 * set WEBHOOK_URL to a public receiver; signature checks are then skipped.
 *
 * Exit code 0 when every check passed, 1 otherwise. Creates real rows; run
 * it against a dev or staging database, not production.
 */
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import http from "node:http";
import pg from "pg";

const API = process.env.API_URL ?? "http://localhost:3000";
const MERCHANT_ID = process.env.MERCHANT_ID ?? "9972daab-2c86-459f-9d78-3fe1be4e3280";
const EMAIL = process.env.MERCHANT_EMAIL ?? "owner@alpharetail.example";
const PASSWORD = process.env.MERCHANT_PASSWORD ?? "FilsPaySeed!2026";
const RECEIVER_PORT = Number(process.env.RECEIVER_PORT ?? 4100);
const AMOUNT = Number(process.env.AMOUNT_FILS ?? 47_333);
const PUBLIC_WEBHOOK_URL = process.env.WEBHOOK_URL;
// Each run registers its own endpoint path, so deliveries to endpoints left
// over from earlier runs (signed with their own secrets) are ignored.
const RUN_PATH = `/hooks/${randomUUID()}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

let cookie = "";
async function call(method, path, body, { auth = true, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(auth && cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (auth && set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

// The shop: records every delivery.
const deliveries = [];
const receiver = PUBLIC_WEBHOOK_URL
  ? null
  : http
      .createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          if (req.url === RUN_PATH) deliveries.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
          res.writeHead(200).end("ok");
        });
      })
      .listen(RECEIVER_PORT, "127.0.0.1");

async function waitForDelivery(type, predicate, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const hit = deliveries.find((d) => {
      const body = JSON.parse(d.body);
      return body.type === type && predicate(body.data ?? {});
    });
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function signatureValid(delivery, secret) {
  const header = delivery.headers["webhook-signature"] ?? "";
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const expected = createHmac("sha256", secret).update(`${parts.t}.${delivery.body}`).digest("hex");
  return expected === parts.v1;
}

const bahrainToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const nextDay = (d) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

const db = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

try {
  // 1. Merchant sign-in and webhook endpoint.
  const login = await call("POST", "/v1/auth/login", { merchantId: MERCHANT_ID, email: EMAIL, password: PASSWORD });
  check("merchant login", login.status === 200, `HTTP ${login.status}`);
  const otp = await call("POST", "/v1/auth/otp/verify", { code: login.json.devOtpCode });
  check("OTP verify", otp.status === 200, login.json.devOtpCode ? "" : "no devOtpCode: the API must expose the dev OTP");

  const hookUrl = PUBLIC_WEBHOOK_URL ?? `http://127.0.0.1:${RECEIVER_PORT}${RUN_PATH}`;
  const endpoint = await call("POST", `/v1/merchants/${MERCHANT_ID}/webhook-endpoints`, { url: hookUrl });
  check("webhook endpoint created", endpoint.status === 201, `HTTP ${endpoint.status}`);

  // 2. Link, payment, second payment refused.
  const reference = `E2E-${Date.now()}`;
  const link = await call("POST", `/v1/merchants/${MERCHANT_ID}/payment-links`, {
    amountFils: AMOUNT,
    reference,
    description: "End-to-end check",
    expiresAt: new Date(Date.now() + 2 * 3600e3).toISOString(),
  });
  check("payment link created", link.status === 201, `HTTP ${link.status}`);
  const card = { pan: "4242424242424242", expiryMonth: 12, expiryYear: new Date().getFullYear() + 3, cvv: "123" };
  const pay = await call("POST", `/v1/payment-links/${link.json.token}/pay`, { card }, { auth: false, headers: { "Idempotency-Key": randomUUID() } });
  check("customer payment succeeds", pay.status === 200 && pay.json.status === "paid", `HTTP ${pay.status}`);
  const again = await call("POST", `/v1/payment-links/${link.json.token}/pay`, { card }, { auth: false, headers: { "Idempotency-Key": randomUUID() } });
  check("second payment is refused", again.status === 409, `HTTP ${again.status} ${again.json?.error ?? ""}`);
  const txnId = pay.json.transactionId;

  // 3. Transaction and timeline.
  const txn = await call("GET", `/v1/transactions/${txnId}`);
  check("transaction is captured for the full amount", txn.json.status === "captured" && txn.json.capturedFils === AMOUNT);
  const events = await call("GET", `/v1/transactions/${txnId}/events`);
  const types = (Array.isArray(events.json) ? events.json : []).map((e) => e.eventType);
  check("timeline shows authorized then captured", types.join(",") === "authorized,captured", types.join(","));
  const feeFils = events.json.find?.((e) => e.eventType === "captured")?.metadata?.feeFils;

  // 4. Ledger.
  if (db) {
    const unbalanced = await db.query(
      `SELECT count(*)::int AS n FROM (SELECT entry_group_id FROM ledger_entries GROUP BY 1
         HAVING sum(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END) <> 0) g`,
    );
    check("every ledger group balances", unbalanced.rows[0].n === 0, `${unbalanced.rows[0].n} unbalanced`);
    const legs = await db.query(
      `SELECT account_id, direction, amount_fils::int AS amount FROM ledger_entries WHERE transaction_id = $1 AND settlement_batch_id IS NULL`,
      [txnId],
    );
    const leg = (a, d) => legs.rows.filter((r) => r.account_id === a && r.direction === d).reduce((s, r) => s + r.amount, 0);
    check("capture legs: gross to merchant payable", leg("card_scheme_clearing", "debit") === AMOUNT && leg("merchant_payable", "credit") === AMOUNT);
    check("capture legs: fee matches the timeline", leg("platform_fee_revenue", "credit") === feeFils, `fee ${feeFils}`);
  } else {
    console.log("SKIP  ledger checks (set DATABASE_URL)");
  }

  // 5. transaction.captured webhook.
  if (receiver) {
    const captured = await waitForDelivery("transaction.captured", (d) => d.transactionId === txnId);
    check("shop received transaction.captured", Boolean(captured));
    if (captured) {
      const body = JSON.parse(captured.body);
      check("captured webhook signature is valid", signatureValid(captured, endpoint.json.secret));
      check("captured webhook carries the amount and fee", body.data.amountCapturedFils === AMOUNT && body.data.feeFils === feeFils);
    }
  } else {
    console.log(`SKIP  webhook checks (deliveries go to ${PUBLIC_WEBHOOK_URL}; check them there)`);
  }

  // 6. Settlement.
  const today = bahrainToday();
  const existing = db
    ? await db.query(`SELECT status FROM settlement_batches WHERE merchant_id = $1 AND batch_date = $2`, [MERCHANT_ID, today])
    : { rows: [] };
  if (existing.rows[0] && existing.rows[0].status !== "open") {
    // A day closes once; captures after that wait for tomorrow's batch.
    console.log(`SKIP  settlement checks (today's batch for this merchant is already ${existing.rows[0].status}; use a fresh database or another day)`);
  } else if (process.env.SETTLEMENT_BIN && db) {
    const out = execFileSync(process.env.SETTLEMENT_BIN, ["run-batch", `--date=${today}`, `--merchant=${MERCHANT_ID}`], {
      encoding: "utf8",
      env: process.env,
    });
    console.log(out.trim().split("\n").map((l) => `      ${l}`).join("\n"));
    const line = await db.query(
      `SELECT sel.settlement_batch_id AS batch, sel.amount_fils::int AS exported, sb.status, sb.fee_fils::int AS fee
         FROM scheme_export_lines sel JOIN settlement_batches sb ON sb.id = sel.settlement_batch_id
        WHERE sel.transaction_id = $1`,
      [txnId],
    );
    const row = line.rows[0];
    check("payment is in a paid batch", row?.status === "paid", row?.status);
    const truncated = Math.floor(AMOUNT / 10) * 10;
    check("scheme file line is truncated to 10 fils", row?.exported === truncated, `${row?.exported}`);
    const clearing = await db.query(
      `SELECT COALESCE(sum(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END), 0)::int AS net
         FROM ledger_entries WHERE account_id = 'card_scheme_clearing' AND transaction_id = $1`,
      [txnId],
    );
    check("card scheme clearing equals the scheme file (residue journalled)", clearing.rows[0].net === truncated, `${clearing.rows[0].net}`);
    const payable = await db.query(
      `SELECT COALESCE(sum(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)::int AS net
         FROM ledger_entries WHERE account_id = 'merchant_payable' AND merchant_id = $1
          AND (transaction_id = $2 OR settlement_batch_id = $3)`,
      [MERCHANT_ID, txnId, row?.batch],
    );
    check("merchant payable is zero after payout", payable.rows[0].net === 0, `${payable.rows[0].net}`);
    if (receiver) {
      const paid = await waitForDelivery("settlement.paid", (d) => d.settlementBatchId === row?.batch);
      check("shop received settlement.paid with a valid signature", Boolean(paid) && signatureValid(paid, endpoint.json.secret));
    }
  } else {
    console.log("SKIP  settlement checks (set SETTLEMENT_BIN and DATABASE_URL)");
  }

  // 7. Reconciliation.
  const rec = await call("GET", `/v1/settlement/reconciliation?from=${today}&to=${nextDay(today)}`);
  check("reconciliation explains to zero", rec.status === 200 && rec.json.gapFils === 0, JSON.stringify(rec.json));
} catch (err) {
  check("run completed without an exception", false, err instanceof Error ? err.message : String(err));
} finally {
  receiver?.close();
  await db?.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

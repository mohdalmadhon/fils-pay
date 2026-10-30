#!/usr/bin/env node
/**
 * Checkout capacity test: how many buyers can check out at once while
 * checkout stays fast and every payment is recorded correctly, and what
 * happens past that point. Write-up: docs/perf/checkout-capacity.md.
 *
 * Each virtual buyer repeats the public checkout, as the checkout page does
 * it: load a fresh payment link (GET /v1/payment-links/:token), then pay it
 * (POST /v1/payment-links/:token/pay with a test card). Links are created
 * before each step and are not timed. Buyers are added in steps; each step
 * reports throughput, latency percentiles and every outcome:
 *
 *   paid      200, the link is paid
 *   declined  402, the simulated acquirer declined (ACQUIRER_FAILURE_RATE)
 *   acquirer  502 acquirer_unavailable: the simulated acquirer's injected
 *             outage (also ACQUIRER_FAILURE_RATE); handled, nobody charged
 *   shed      503 or 429: the API turned the request away (load shedding);
 *             the buyer was not charged and may retry (Retry-After)
 *   error     anything else, including timeouts and dropped connections
 *
 * A step is "fast and correct" when p95 checkout time is within P95_MS and
 * there are no errors. The capacity is the largest such step. Afterwards
 * every outcome is checked against the server: every paid link reads
 * "paid" with exactly the captured transaction it reported, and no link
 * that was shed, declined or failed was charged.
 *
 * Usage, from the repo root (Node 22, no dependencies):
 *
 *   API_URL=https://<api host> API_KEY=<merchant API key> MERCHANT_ID=<id> \
 *     node scripts/load/checkout-load.mjs
 *
 * Locally, without API_KEY, it signs in as the seed's Alpha Retail owner
 * using the development one-time code (API started with OTP_DEV_EXPOSE=true).
 *
 * Options (environment):
 *   STEPS         buyers per step, comma separated     (default 5,10,20,40,60,80)
 *   STEP_SECONDS  length of each step                   (default 30)
 *   P95_MS        "fast" limit for a whole checkout     (default 1500)
 *   TIMEOUT_MS    give up on one request after          (default 15000)
 *   AMOUNT_FILS   amount of each payment link           (default 12345)
 *   REPORT        where to write the JSON report        (default scripts/out/checkout-load-<time>.json)
 *   RETRY         after a 503, retry the same link: "honor" waits Retry-After
 *                 like the checkout page (default); "immediate" retries at
 *                 once, the harshest client a load tool can be
 *   MAX_RATE      checkouts a second to create links for, at most (default 60)
 *   SKIP_VERIFY   1 to skip the correctness check
 *
 * It creates real payment links and payments: use a staging merchant.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const API = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MERCHANT_ID = process.env.MERCHANT_ID ?? "9972daab-2c86-459f-9d78-3fe1be4e3280";
const EMAIL = process.env.MERCHANT_EMAIL ?? "owner@alpharetail.example";
const PASSWORD = process.env.MERCHANT_PASSWORD ?? "FilsPaySeed!2026";
const STEPS = (process.env.STEPS ?? "5,10,20,40,60,80").split(",").map(Number);
const STEP_SECONDS = Number(process.env.STEP_SECONDS ?? 30);
const P95_MS = Number(process.env.P95_MS ?? 1500);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 15_000);
const AMOUNT = Number(process.env.AMOUNT_FILS ?? 12_345);
const REPORT = process.env.REPORT ?? `scripts/out/checkout-load-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const RETRY = process.env.RETRY ?? "honor";
const MAX_RATE = Number(process.env.MAX_RATE ?? 60);
const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

let auth = process.env.API_KEY ? { authorization: `Bearer ${process.env.API_KEY}` } : null;

async function call(method, path, body, headers = {}) {
  const started = performance.now();
  try {
    const res = await fetch(API + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, ms: performance.now() - started, headers: res.headers };
  } catch (err) {
    return { status: 0, json: null, ms: performance.now() - started, error: err.name === "TimeoutError" ? "timeout" : String(err.cause?.code ?? err.message) };
  }
}

/** Local only: sign in with the development one-time code; keep the session cookie. */
async function devSignIn() {
  const login = await call("POST", "/v1/auth/login", { merchantId: MERCHANT_ID, email: EMAIL, password: PASSWORD });
  if (!login.json?.devOtpCode) throw new Error(`sign-in failed (${login.status}); set API_KEY, or start the API with OTP_DEV_EXPOSE=true`);
  const res = await fetch(API + "/v1/auth/otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieFrom(login.headers) },
    body: JSON.stringify({ code: login.json.devOtpCode }),
  });
  if (res.status !== 200) throw new Error(`one-time code rejected (${res.status})`);
  return { cookie: cookieFrom(res.headers) };
}

function cookieFrom(headers) {
  return (headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function createLinks(count) {
  const tokens = [];
  const expiresAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < count) {
        next += 1;
        // Retried, so a restart or a busy API during setup doesn't end the run.
        let r;
        for (let attempt = 0; ; attempt++) {
          r = await call(
            "POST",
            `/v1/merchants/${MERCHANT_ID}/payment-links`,
            { amountFils: AMOUNT, reference: `load-${randomUUID().slice(0, 8)}`, description: "Capacity test", expiresAt },
            auth,
          );
          if (r.status === 201 || (r.status > 0 && r.status < 500) || attempt >= 30) break;
          await new Promise((res) => setTimeout(res, 1000));
        }
        if (r.status !== 201) throw new Error(`could not create a payment link (${r.status} ${JSON.stringify(r.json)})`);
        tokens.push(r.json.token);
      }
    }),
  );
  return tokens;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
}

function classify(status, error) {
  if (status === 200) return "paid";
  if (status === 402) return "declined";
  if (status === 502 && error === "acquirer_unavailable") return "acquirer";
  if (status === 503 || status === 429) return "shed";
  return "error";
}

/** One checkout: load the link, then pay it, as a buyer would.
 *
 *  - 503/429 (turned away): wait Retry-After (RETRY=honor) and try again.
 *  - No answer or a 5xx (the API restarting, the database down): wait 1 s
 *    and try again, the pay step with a fresh Idempotency-Key, as the
 *    checkout page sends on every click. If an earlier attempt did go
 *    through, the retry must hear "already paid", never charge again.
 *  - Until the step's deadline; each retry is counted. */
async function checkout(token, deadline) {
  const started = performance.now();
  let shed = 0;
  let recovered = 0;
  let waitedMs = 0;
  const wait = async (r, seconds) => {
    const waitStart = performance.now();
    if (seconds > 0) await new Promise((res) => setTimeout(res, 1000 * seconds));
    waitedMs += performance.now() - waitStart + r.ms;
  };
  const attempt = async (method, path, body, freshHeaders) => {
    for (;;) {
      const r = await call(method, path, body, freshHeaders?.());
      if (performance.now() >= deadline) return r;
      if (r.status === 503 || r.status === 429) {
        shed += 1;
        await wait(r, RETRY === "honor" ? Number(r.headers?.get("retry-after") ?? 1) : 0);
        continue;
      }
      const failed = r.status === 0 || (r.status >= 500 && !(r.status === 502 && r.json?.error === "acquirer_unavailable"));
      if (failed) {
        recovered += 1;
        await wait(r, 1);
        continue;
      }
      return r;
    }
  };
  const view = await attempt("GET", `/v1/payment-links/${token}`);
  const done = (fields) => ({ token, shed, recovered, waitedMs, ms: performance.now() - started, ...fields });
  if (view.status !== 200) {
    return done({ outcome: classify(view.status, view.json?.error), stage: "view", status: view.status, error: view.error ?? view.json?.error });
  }
  if (view.json?.status === "paid") {
    // An earlier attempt of this buyer's went through before a crash.
    return done({ outcome: "paid", stage: "view", status: 200, confirmedByRetry: true });
  }
  let pay = await attempt("POST", `/v1/payment-links/${token}/pay`, { card: CARD }, () => ({ "idempotency-key": randomUUID() }));
  // A retry after a lost answer: "already paid" means the lost attempt paid.
  if (pay.status === 409 && pay.json?.error === "payment_link_already_paid" && recovered > 0) {
    return done({ outcome: "paid", stage: "pay", status: 200, confirmedByRetry: true });
  }
  // Someone (this buyer's lost attempt) holds the link: keep trying until it
  // is released (reservation timeout) or the step ends.
  while (pay.status === 409 && pay.json?.error === "payment_link_processing" && performance.now() < deadline) {
    recovered += 1;
    await wait(pay, 2);
    pay = await attempt("POST", `/v1/payment-links/${token}/pay`, { card: CARD }, () => ({ "idempotency-key": randomUUID() }));
    if (pay.status === 409 && pay.json?.error === "payment_link_already_paid") {
      return done({ outcome: "paid", stage: "pay", status: 200, confirmedByRetry: true });
    }
  }
  return done({
    outcome: classify(pay.status, pay.json?.error),
    stage: "pay",
    status: pay.status,
    error: pay.error ?? (pay.status >= 500 && pay.status !== 503 ? pay.json?.error : pay.status === 409 ? pay.json?.error : undefined),
    transactionId: pay.json?.transactionId,
  });
}

async function runStep(users, tokens) {
  const results = [];
  const started = performance.now();
  const deadline = started + STEP_SECONDS * 1000;
  let next = 0;
  await Promise.all(
    Array.from({ length: users }, async () => {
      while (performance.now() < deadline && next < tokens.length) {
        const token = tokens[next++];
        results.push(await checkout(token, deadline));
      }
    }),
  );
  // Include the drain: requests started before the deadline can finish
  // afterwards. Dividing those completions by just STEP_SECONDS inflates
  // throughput, especially on a slow or overloaded server.
  const elapsed = (performance.now() - started) / 1000;
  const count = (o) => results.filter((r) => r.outcome === o).length;
  // Latency of checkouts the server actually handled (shed answers are
  // instant by design and would flatter the percentiles).
  const answered = (r) => r.outcome === "paid" || r.outcome === "declined" || r.outcome === "acquirer";
  // Server time: the requests that were let in, without time spent turned
  // away and waiting to retry. Buyer time: everything, retries included.
  const handled = results.filter(answered).map((r) => r.ms - r.waitedMs).sort((a, b) => a - b);
  const buyer = results.filter(answered).map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => r.outcome === "error");
  const step = {
    users,
    arrivalWindowSeconds: STEP_SECONDS,
    elapsedSeconds: Number(elapsed.toFixed(3)),
    checkouts: results.length,
    paid: count("paid"),
    declined: count("declined"),
    acquirer: count("acquirer"),
    // Turned away and never got through before the step ended.
    shed: count("shed"),
    // 503 answers in all (every retry counts), and checkouts that met at
    // least one: a buyer who was asked to wait.
    shedResponses: results.reduce((n, r) => n + r.shed, 0),
    checkoutsDelayedByShedding: results.filter((r) => r.shed > 0).length,
    // Checkouts that met no answer or a 5xx (a restart, the database down)
    // and went through on a retry.
    recoveredAfterFailure: results.filter((r) => r.recovered > 0 && (r.outcome === "paid" || r.outcome === "declined" || r.outcome === "acquirer")).length,
    errors: errors.length,
    errorKinds: [...new Set(errors.map((e) => `${e.stage}:${e.status}${e.error ? ` ${e.error}` : ""}`))].slice(0, 5),
    completedPerSecond: Number((handled.length / elapsed).toFixed(1)),
    p50: percentile(handled, 50),
    p95: percentile(handled, 95),
    p99: percentile(handled, 99),
    max: handled.length ? Math.round(handled[handled.length - 1]) : null,
    buyerP95: percentile(buyer, 95),
    unusedLinks: tokens.length - next,
    exhaustedLinkSupply: next >= tokens.length,
  };
  step.fastAndCorrect = !step.exhaustedLinkSupply && step.errors === 0 && step.shedResponses === 0 && step.recoveredAfterFailure === 0 && step.p95 !== null && step.buyerP95 <= P95_MS;
  return { step, results };
}

/** Every outcome against the server's records. */
async function verify(all) {
  const problems = [];
  const sample = all;
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < sample.length) {
        const r = sample[next++];
        const link = await call("GET", `/v1/payment-links/${r.token}`);
        const status = link.json?.status;
        if (r.outcome === "paid") {
          if (status !== "paid") problems.push(`${r.token}: answered paid, link is ${status}`);
          if (!r.transactionId) continue; // confirmed by a retry: the link reading paid is the check
          const txn = await call("GET", `/v1/transactions/${r.transactionId}`, null, auth);
          if (txn.status !== 200 || txn.json?.status !== "captured" || Number(txn.json?.capturedFils ?? txn.json?.captured_fils) !== AMOUNT) {
            problems.push(`${r.token}: transaction ${r.transactionId} is ${txn.status} ${txn.json?.status} ${txn.json?.capturedFils}`);
          }
        } else if (status === "paid") {
          // Turned away or failed, yet charged: the one thing that must never happen.
          problems.push(`${r.token}: answered ${r.outcome} (${r.status}), but the link is paid`);
        }
      }
    }),
  );
  return problems;
}

async function main() {
  console.log(`checkout capacity test against ${API}: steps ${STEPS.join(", ")} buyers, ${STEP_SECONDS}s each, fast = p95 <= ${P95_MS} ms`);
  if (!auth) auth = await devSignIn();
  const steps = [];
  const all = [];
  for (const users of STEPS) {
    // Enough links for every buyer to finish a checkout every 0.5 s (faster
    // than the acquirer's two round trips allow), but no more than
    // MAX_RATE a second could use: past capacity the rest go unused.
    const tokens = await createLinks(Math.ceil(Math.min((users * STEP_SECONDS) / 0.5, MAX_RATE * STEP_SECONDS)));
    console.log(`step ${users} buyers started`);
    const { step, results } = await runStep(users, tokens);
    steps.push(step);
    all.push(...results);
    console.log(
      `${String(users).padStart(4)} buyers  ${String(step.completedPerSecond).padStart(5)}/s  p50 ${step.p50} p95 ${step.p95} p99 ${step.p99} ms (buyer p95 ${step.buyerP95})  ` +
        `paid ${step.paid} declined ${step.declined + step.acquirer} 503s ${step.shedResponses} (${step.checkoutsDelayedByShedding} buyers waited) errors ${step.errors}${step.recoveredAfterFailure ? ` (recovered after a failure: ${step.recoveredAfterFailure})` : ""}  ${step.fastAndCorrect ? "OK" : "OVER"}` +
        (step.errorKinds.length ? `  [${step.errorKinds.join("; ")}]` : ""),
    );
    // Let the server settle between steps.
    await new Promise((r) => setTimeout(r, 3000));
  }
  const good = steps.filter((s) => s.fastAndCorrect);
  const capacity = good.length ? good[good.length - 1] : null;
  console.log(capacity ? `\ncapacity: ${capacity.users} concurrent buyers, ${capacity.completedPerSecond} checkouts/s at p95 ${capacity.p95} ms` : "\nno step was fast and correct");

  let problems = [];
  if (process.env.SKIP_VERIFY !== "1") {
    console.log(`verifying ${all.length} checkouts against the server...`);
    problems = await verify(all);
    console.log(problems.length === 0 ? "verified: every paid link has its captured transaction; nothing turned away or failed was charged" : `${problems.length} PROBLEMS:\n  ${problems.slice(0, 20).join("\n  ")}`);
  }
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify({ api: API, at: new Date().toISOString(), p95LimitMs: P95_MS, stepSeconds: STEP_SECONDS, steps, capacity, problems }, null, 2));
  console.log(`report: ${REPORT}`);
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

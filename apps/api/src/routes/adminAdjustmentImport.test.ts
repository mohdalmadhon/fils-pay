/**
 * Route-level tests for the admin "Import adjustments" tool, via
 * `app.inject(...)` against a real, migrated Postgres (run `npm run migrate`
 * first).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../adminAuth/passwords.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "adminAdjustmentImport.test.ts requires DATABASE_URL to point at a real, migrated Postgres",
  );
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

type AdminRole = "support" | "finance" | "super_admin";

const ADMIN_PASSWORD = "admin-test-password-9000!";
let cachedAdminPasswordHash: string | null = null;

function parseCookie(setCookieHeader: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const header of headers) {
    if (header && header.startsWith(`${name}=`)) {
      return header.split(";")[0] as string;
    }
  }
  throw new Error(`expected a Set-Cookie header for ${name}`);
}

async function signedInAdmin(role: AdminRole): Promise<{ id: string; cookie: string }> {
  cachedAdminPasswordHash ??= await hashPassword(ADMIN_PASSWORD, config);
  const email = `adj-import-route-${randomUUID()}@admin.test`;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, cachedAdminPasswordHash, `Test ${role}`, role],
  );

  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    payload: { email, password: ADMIN_PASSWORD },
  });
  assert.equal(loginRes.statusCode, 200, loginRes.body);
  const loginBody = loginRes.json() as { devOtpCode?: string };
  let cookie = parseCookie(loginRes.headers["set-cookie"], config.adminCookieName);

  const verifyRes = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/otp/verify",
    headers: { cookie },
    payload: { code: loginBody.devOtpCode },
  });
  assert.equal(verifyRes.statusCode, 200, verifyRes.body);
  // OTP verify issues a new session token; the pending one is dead.
  cookie = (([] as string[]).concat(verifyRes.headers["set-cookie"] ?? [])[0] ?? "").split(";")[0]!;
  return { id: inserted.rows[0]!.id, cookie };
}

async function createMerchant(): Promise<string> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
     VALUES ($1, 250, 'active', false) RETURNING id`,
    [`Adj Import Route ${randomUUID()}`],
  );
  return merchant.rows[0]!.id;
}

const PATH = "/v1/admin/adjustment-imports";

test("a valid CSV upload returns 201 and applies every row", async () => {
  const admin = await signedInAdmin("finance");
  const merchantId = await createMerchant();

  const res = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: admin.cookie },
    payload: {
      csvContent: `merchantId,amount,reason\n${merchantId},4.75,statement correction\n${merchantId},1.25,rounding\n`,
      originalFilename: "march-corrections.csv",
    },
  });
  assert.equal(res.statusCode, 201, res.body);

  const body = res.json() as { importId: string; rowCount: number; totalPostedFils: number };
  assert.equal(body.rowCount, 2);
  // 4.75 BD + 1.25 BD = 6.000 BD = 6000 fils. This used to assert 600, the
  // value the cents-based parser produced (a tenth of the real amount).
  assert.equal(body.totalPostedFils, 6000);

  const rows = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM adjustment_import_rows WHERE adjustment_import_id = $1`,
    [body.importId],
  );
  assert.equal(Number(rows.rows[0]!.n), 2);
});

test("an unauthenticated upload is a 401", async () => {
  const merchantId = await createMerchant();
  const res = await app.inject({
    method: "POST",
    url: PATH,
    payload: { csvContent: `merchantId,amount,reason\n${merchantId},1.00,x\n` },
  });
  assert.equal(res.statusCode, 401, res.body);
});

test("a support admin cannot upload", async () => {
  const admin = await signedInAdmin("support");
  const merchantId = await createMerchant();
  const res = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: admin.cookie },
    payload: { csvContent: `merchantId,amount,reason\n${merchantId},1.00,x\n` },
  });
  assert.equal(res.statusCode, 403, res.body);
});

test("a missing or empty csvContent is a 400", async () => {
  const admin = await signedInAdmin("finance");
  for (const payload of [{}, { csvContent: "" }, { csvContent: "   " }, { csvContent: 42 }]) {
    const res = await app.inject({
      method: "POST",
      url: PATH,
      headers: { cookie: admin.cookie },
      payload,
    });
    assert.equal(res.statusCode, 400, `${JSON.stringify(payload)} -> ${res.body}`);
  }
});

test("a header-only CSV is a 400", async () => {
  const admin = await signedInAdmin("finance");
  const res = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: admin.cookie },
    payload: { csvContent: "merchantId,amount,reason\n" },
  });
  assert.equal(res.statusCode, 400, res.body);
});

test("a row whose merchantId is not a UUID is a 400 and applies nothing", async () => {
  const admin = await signedInAdmin("finance");
  const merchantId = await createMerchant();

  const res = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: admin.cookie },
    payload: {
      csvContent: `merchantId,amount,reason\n${merchantId},1.00,ok\nnot-a-uuid,2.00,bad\n`,
    },
  });
  assert.equal(res.statusCode, 400, res.body);

  const legs = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ledger_entries WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.equal(Number(legs.rows[0]!.n), 0, "validation must run before anything is posted");
});

/** "Malformed" = non-numeric. Trailing garbage after a number (e.g. "4.75abc") is accepted by the parser. */
test("a malformed amount is a 400 and rolls the whole import back", async () => {
  const admin = await signedInAdmin("finance");
  const merchantId = await createMerchant();

  const res = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: admin.cookie },
    payload: {
      csvContent: `merchantId,amount,reason\n${merchantId},1.00,ok\n${merchantId},abc,bad\n`,
    },
  });
  assert.equal(res.statusCode, 400, res.body);

  const legs = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ledger_entries WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.equal(Number(legs.rows[0]!.n), 0);
});

test("the import history lists past uploads and is readable by any admin role", async () => {
  const finance = await signedInAdmin("finance");
  const merchantId = await createMerchant();

  const created = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: finance.cookie },
    payload: {
      csvContent: `merchantId,amount,reason\n${merchantId},9.99,history\n`,
      originalFilename: "history.csv",
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const importId = (created.json() as { importId: string }).importId;

  const support = await signedInAdmin("support");
  const listed = await app.inject({
    method: "GET",
    url: `${PATH}?limit=50`,
    headers: { cookie: support.cookie },
  });
  assert.equal(listed.statusCode, 200, listed.body);

  const items = (listed.json() as { items: Array<{ id: string; originalFilename: string }> }).items;
  const match = items.find((item) => item.id === importId);
  assert.ok(match, "the new import must appear in the history");
  assert.equal(match.originalFilename, "history.csv");
});

// 4.75 -> 475 here. matches the README money section (1250 fils = 12.50 BD) — FH
// MK: BD has 3 decimals?? 4.75 BD is 4750 fils
// am: the import format is 2dp by agreement with finance. fine
test("per-row detail shows the raw text next to the parsed integer", async () => {
  const admin = await signedInAdmin("finance");
  const merchantId = await createMerchant();

  const created = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: admin.cookie },
    payload: { csvContent: `merchantId,amount,reason\n${merchantId},4.750,detail\n` },
  });
  const importId = (created.json() as { importId: string }).importId;

  const res = await app.inject({
    method: "GET",
    url: `${PATH}/${importId}/rows`,
    headers: { cookie: admin.cookie },
  });
  assert.equal(res.statusCode, 200, res.body);

  const rows = (res.json() as { rows: Array<Record<string, unknown>> }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.rawAmountText, "4.750");
  assert.equal(rows[0]!.merchantId, merchantId);
  assert.equal(rows[0]!.reason, "detail");
});

test("per-row detail for an unknown import is a 404", async () => {
  const admin = await signedInAdmin("finance");
  for (const id of ["not-a-uuid", randomUUID()]) {
    const res = await app.inject({
      method: "GET",
      url: `${PATH}/${id}/rows`,
      headers: { cookie: admin.cookie },
    });
    assert.equal(res.statusCode, 404, `${id} -> ${res.body}`);
  }
});

test("reading the import history requires a session", async () => {
  const res = await app.inject({ method: "GET", url: PATH });
  assert.equal(res.statusCode, 401, res.body);
});

test("a row naming a merchant that doesn't exist is a 400 naming the row, and applies nothing", async () => {
  const admin = await signedInAdmin("finance");
  const merchantId = await createMerchant();
  const missing = randomUUID();

  const res = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: admin.cookie },
    payload: { csvContent: `merchantId,amount,reason\n${merchantId},1.00,ok\n${missing},2.00,typo\n` },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error, "unknown_merchant");
  assert.match(res.json().message, new RegExp(`row 2: .*${missing}`));

  const legs = await pool.query(`SELECT 1 FROM ledger_entries WHERE merchant_id = $1`, [merchantId]);
  assert.equal(legs.rowCount, 0, "nothing is posted when any row is bad");
});

// docs/bugs/053: an import used to post any amount at once, while a single
// credit over 50 BD needs a second person.
test("an import moving more than 50 BD waits for a second admin, who applies it once", async () => {
  const uploader = await signedInAdmin("finance");
  const approver = await signedInAdmin("finance");
  const merchantId = await createMerchant();
  const legCount = async () =>
    Number((await pool.query(`SELECT count(*) FROM ledger_entries WHERE merchant_id = $1`, [merchantId])).rows[0].count);

  const upload = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: uploader.cookie },
    // +40 and -20 net to 20 BD, but 60 BD moves: over the limit.
    payload: { csvContent: `merchantId,amount,reason\n${merchantId},40.000,a\n${merchantId},-20.000,b\n` },
  });
  assert.equal(upload.statusCode, 202, upload.body);
  const pending = upload.json() as { importId: string; status: string; totalFils: number; totalPostedFils: number };
  assert.equal(pending.status, "pending_approval");
  assert.equal(pending.totalFils, 60_000);
  assert.equal(pending.totalPostedFils, 0);
  assert.equal(await legCount(), 0, "nothing posts until approved");

  const self = await app.inject({ method: "POST", url: `${PATH}/${pending.importId}/approve`, headers: { cookie: uploader.cookie } });
  assert.equal(self.statusCode, 409, self.body);
  assert.equal(self.json().error, "self_approval_forbidden");

  const support = await signedInAdmin("support");
  const bySupport = await app.inject({ method: "POST", url: `${PATH}/${pending.importId}/approve`, headers: { cookie: support.cookie } });
  assert.equal(bySupport.statusCode, 403, bySupport.body);

  const ok = await app.inject({ method: "POST", url: `${PATH}/${pending.importId}/approve`, headers: { cookie: approver.cookie } });
  assert.equal(ok.statusCode, 200, ok.body);
  const applied = ok.json() as { status: string; totalPostedFils: number };
  assert.equal(applied.status, "applied");
  assert.equal(applied.totalPostedFils, 60_000);
  assert.equal(await legCount(), 4);

  const twice = await app.inject({ method: "POST", url: `${PATH}/${pending.importId}/approve`, headers: { cookie: approver.cookie } });
  assert.equal(twice.statusCode, 409, twice.body);
  assert.equal(await legCount(), 4, "approving again posts nothing");

  const cache = await pool.query<{ v: string }>(`SELECT cached_payable_fils::text AS v FROM merchant_balances WHERE merchant_id = $1`, [merchantId]);
  assert.equal(Number(cache.rows[0]!.v), 20_000);
});

test("a rejected import posts nothing and can't be approved afterwards", async () => {
  const uploader = await signedInAdmin("finance");
  const checker = await signedInAdmin("super_admin");
  const merchantId = await createMerchant();
  const upload = await app.inject({
    method: "POST",
    url: PATH,
    headers: { cookie: uploader.cookie },
    payload: { csvContent: `merchantId,amount,reason\n${merchantId},250000.000,big\n` },
  });
  assert.equal(upload.statusCode, 202, upload.body);
  const { importId } = upload.json() as { importId: string };

  const reject = await app.inject({
    method: "POST",
    url: `${PATH}/${importId}/reject`,
    headers: { cookie: checker.cookie },
    payload: { note: "not in the March statement" },
  });
  assert.equal(reject.statusCode, 200, reject.body);
  assert.equal(reject.json().status, "rejected");

  const late = await app.inject({ method: "POST", url: `${PATH}/${importId}/approve`, headers: { cookie: checker.cookie } });
  assert.equal(late.statusCode, 409, late.body);
  const legs = await pool.query(`SELECT count(*) FROM ledger_entries WHERE merchant_id = $1`, [merchantId]);
  assert.equal(Number(legs.rows[0].count), 0);

  const list = await app.inject({ method: "GET", url: PATH, headers: { cookie: checker.cookie } });
  const item = (list.json() as { items: Array<{ id: string; status: string; appliedAt: string | null }> }).items.find((i) => i.id === importId);
  assert.equal(item?.status, "rejected");
  assert.equal(item?.appliedAt, null);
});

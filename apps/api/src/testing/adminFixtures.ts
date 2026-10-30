/**
 * Shared fixtures for route tests that need a signed-in admin, a merchant,
 * or an admin impersonation grant. Test-only: imported from *.test.ts files,
 * never from application code.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { buildApp } from "../app.js";
import type { Config } from "../config.js";
import { hashPassword } from "../adminAuth/passwords.js";

export type AdminRole = "support" | "finance" | "super_admin";
type App = ReturnType<typeof buildApp>;

export const ADMIN_PASSWORD = "admin-fixture-password-9000!";
let cachedHash: string | null = null;

export function parseCookie(setCookieHeader: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const header of headers) {
    if (header && header.startsWith(`${name}=`)) return header.split(";")[0] as string;
  }
  throw new Error(`expected a Set-Cookie header for ${name}`);
}

export async function createAdminUser(
  pool: Pool,
  config: Config,
  role: AdminRole,
  label: string,
  displayName = `Fixture ${role} ${randomUUID().slice(0, 8)}`,
): Promise<{ id: string; email: string; displayName: string }> {
  cachedHash ??= await hashPassword(ADMIN_PASSWORD, config);
  const email = `${label}-${randomUUID()}@admin.test`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, cachedHash, displayName, role],
  );
  return { id: result.rows[0]!.id, email, displayName };
}

/** Password, then OTP (requires OTP_DEV_EXPOSE=true), returns the admin cookie. */
export async function loginAdmin(app: App, config: Config, email: string): Promise<string> {
  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    payload: { email, password: ADMIN_PASSWORD },
  });
  assert.equal(loginRes.statusCode, 200, loginRes.body);
  const { devOtpCode } = loginRes.json() as { devOtpCode?: string };
  assert.ok(devOtpCode, "OTP_DEV_EXPOSE must be on for fixtures");
  let cookie = parseCookie(loginRes.headers["set-cookie"], config.adminCookieName);
  const verifyRes = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/otp/verify",
    headers: { cookie },
    payload: { code: devOtpCode },
  });
  assert.equal(verifyRes.statusCode, 200, verifyRes.body);
  // OTP verify issues a new session token; the pending one is dead.
  cookie = (([] as string[]).concat(verifyRes.headers["set-cookie"] ?? [])[0] ?? "").split(";")[0]!;
  return cookie;
}

export async function signedInAdmin(app: App, pool: Pool, config: Config, role: AdminRole, label: string) {
  const user = await createAdminUser(pool, config, role, label);
  const cookie = await loginAdmin(app, config, user.email);
  return { ...user, cookie };
}

export async function createMerchant(
  pool: Pool,
  label: string,
  opts: { testMode?: boolean } = {},
): Promise<{ merchantId: string; ownerUserId: string }> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, test_mode) VALUES ($1, 250, $2) RETURNING id`,
    [`Fixture ${label} ${randomUUID()}`, opts.testMode ?? false],
  );
  const merchantId = merchant.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  return { merchantId, ownerUserId: user.rows[0]!.id };
}

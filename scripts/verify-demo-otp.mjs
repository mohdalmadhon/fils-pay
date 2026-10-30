// Disposable migrated DB only: DATABASE_URL=... node --import tsx scripts/verify-demo-otp.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { buildApp } from '../apps/api/src/app.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { createAdminUser, ADMIN_PASSWORD } from '../apps/api/src/testing/adminFixtures.ts';

assert.equal(process.env.OTP_VERIFY_DISPOSABLE_DB, '1', 'Requires explicit disposable DB acknowledgement');
assert.ok(process.env.DATABASE_URL, 'Requires DATABASE_URL');
const dir = mkdtempSync(join(tmpdir(), 'filspay-demo-otp-'));
const env = {
  DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: 'production',
  SETTLEMENT_INTERNAL_TOKEN: 'verification-only', ACQUIRER_CALLBACK_SIGNING_SECRET: 'verification-only',
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  CORS_ALLOWED_ORIGINS: 'https://example.test', OTP_LOG_FILE: join(dir, 'otp.jsonl'),
};
const normal = loadConfig(env);
const demo = loadConfig({ ...env, OTP_DEMO_DISPLAY: 'true' });
assert.equal(normal.otpDemoDisplay, false);
assert.equal(loadConfig({ ...env, OTP_DEMO_DISPLAY: 'false' }).otpDemoDisplay, false);
assert.equal(demo.otpDemoDisplay, true);
assert.equal(demo.otpDevExpose, false);
assert.throws(() => loadConfig({ ...env, OTP_DEV_EXPOSE: 'true' }), /OTP_DEV_EXPOSE/);
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
const hiddenApp = buildApp(normal, pool);
const demoApp = buildApp(demo, pool);
const cookie = response => [].concat(response.headers['set-cookie'] ?? [])[0].split(';')[0];
try {
  const email = `demo-${randomUUID()}@example.test`;
  const password = 'Demo-verification-password-123!';
  const signup = await demoApp.inject({ method: 'POST', url: '/v1/merchants', payload: {
    businessProfile: { legalName: 'OTP Display Check', registrationNumber: randomUUID(), businessType: 'llc',
      contactEmail: email, contactPhone: '+97300000000', addressLine1: '1 Test Street', city: 'Manama' },
    owner: { email, password },
  } });
  assert.equal(signup.statusCode, 201, signup.body);
  const merchantId = signup.json().merchantId;
  const input = { merchantId, email, password };
  const hidden = await hiddenApp.inject({ method: 'POST', url: '/v1/auth/login', payload: input });
  assert.equal(hidden.statusCode, 200, hidden.body);
  assert.equal(hidden.json().devOtpCode, undefined);
  const wrong = await demoApp.inject({ method: 'POST', url: '/v1/auth/login', payload: { ...input, password: 'wrong' } });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().devOtpCode, undefined);
  const login = await demoApp.inject({ method: 'POST', url: '/v1/auth/login', payload: input });
  assert.equal(login.statusCode, 200, login.body);
  assert.match(login.json().devOtpCode, /^\d{6}$/);
  assert.match([].concat(login.headers['set-cookie']).join(';'), /Secure/);
  const pending = cookie(login);
  const me = await demoApp.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: pending } });
  assert.equal(me.statusCode, 401);
  await pool.query("UPDATE otp_challenges SET created_at = now() - interval '1 minute' WHERE merchant_user_id IN (SELECT id FROM merchant_users WHERE merchant_id = $1)", [merchantId]);
  const resend = await demoApp.inject({ method: 'POST', url: '/v1/auth/otp/resend', headers: { cookie: pending } });
  assert.equal(resend.statusCode, 200, resend.body);
  assert.match(resend.json().devOtpCode, /^\d{6}$/);
  const verified = await demoApp.inject({ method: 'POST', url: '/v1/auth/otp/verify', headers: { cookie: pending }, payload: { code: resend.json().devOtpCode } });
  assert.equal(verified.statusCode, 200, verified.body);
  const admin = await createAdminUser(pool, demo, 'support', 'demo-otp-display');
  const adminInput = { email: admin.email, password: ADMIN_PASSWORD };
  const hiddenAdmin = await hiddenApp.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: adminInput });
  assert.equal(hiddenAdmin.statusCode, 200, hiddenAdmin.body);
  assert.equal(hiddenAdmin.json().devOtpCode, undefined);
  const adminLogin = await demoApp.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: adminInput });
  assert.equal(adminLogin.statusCode, 200, adminLogin.body);
  assert.match(adminLogin.json().devOtpCode, /^\d{6}$/);
  const adminVerify = await demoApp.inject({ method: 'POST', url: '/v1/admin/auth/otp/verify', headers: { cookie: cookie(adminLogin) }, payload: { code: adminLogin.json().devOtpCode } });
  assert.equal(adminVerify.statusCode, 200, adminVerify.body);
  console.log('PASS: demo flag off/on, production guards, wrong password, pending session, merchant login/resend/verify, admin login/verify');
} finally {
  await hiddenApp.close();
  await demoApp.close();
  await pool.end();
  rmSync(dir, { recursive: true, force: true });
}

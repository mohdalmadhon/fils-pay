// Run with: node --import tsx scripts/verify-otp-file.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, chmodSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendOtpCode } from '../apps/api/src/auth/notifier.ts';
import { sendAdminOtpCode } from '../apps/api/src/adminAuth/notifier.ts';
import { loadConfig } from '../apps/api/src/config.ts';

const dir = mkdtempSync(join(tmpdir(), 'filspay-otp-'));
const file = join(dir, 'otp.jsonl');
const logs = [];
const logger = { info: (...args) => logs.push(args) };
const config = loadConfig({
  NODE_ENV: 'production', DATABASE_URL: 'postgres://unused/db',
  SETTLEMENT_INTERNAL_TOKEN: 'verification-only',
  ACQUIRER_CALLBACK_SIGNING_SECRET: 'verification-only',
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  CORS_ALLOWED_ORIGINS: 'https://example.test', OTP_LOG_FILE: file,
});
try {
  assert.equal(config.otpDevExpose, false);
  sendOtpCode(logger, config, { merchantUserId: 'merchant-user', email: 'unused@example.test' }, '012345');
  sendAdminOtpCode(logger, config, { adminUserId: 'admin-user', email: 'unused@example.test' }, '654321');
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(({ channel, userId, code }) => ({ channel, userId, code })), [
    { channel: 'merchant', userId: 'merchant-user', code: '012345' },
    { channel: 'admin', userId: 'admin-user', code: '654321' },
  ]);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(rows.every(row => Number.isFinite(Date.parse(row.timestamp))));
  assert.ok(!JSON.stringify(logs).includes('012345') && !JSON.stringify(logs).includes('654321'));
  const send = path => sendOtpCode(logger, { ...config, otpLogFile: path }, { merchantUserId: 'user', email: 'unused' }, '111111');
  assert.throws(() => send('relative.jsonl'), /absolute/);
  symlinkSync(file, join(dir, 'symlink'));
  assert.throws(() => send(join(dir, 'symlink')));
  linkSync(file, join(dir, 'hardlink'));
  assert.throws(() => send(file), /private/);
  rmSync(join(dir, 'hardlink'));
  chmodSync(file, 0o644);
  assert.throws(() => send(file), /private/);
  chmodSync(file, 0o600);
  assert.throws(() => send(join(dir, 'missing', 'otp.jsonl')));
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);
  assert.ok(!JSON.stringify(logs).includes('111111'));
  console.log('PASS: production configuration, both OTP channels, private permissions, normal-log redaction, unsafe paths and failed-delivery behavior');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

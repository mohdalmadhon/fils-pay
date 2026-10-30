/**
 * Security defaults in loadConfig. Pure (no database).
 *
 * Before the fix: any NODE_ENV other than the three exact strings (or none at
 * all, as on the hosted box) became "development", which turned the OTP
 * echo-back on by default; OTP_DEV_EXPOSE=true was honoured even in
 * production; and there was a built-in webhook encryption key for non-
 * production boots.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const KEY = "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=";
const base = { DATABASE_URL: "postgres://unused/db", WEBHOOK_SECRET_ENCRYPTION_KEY: KEY };
const prod = {
  ...base,
  NODE_ENV: "production",
  SETTLEMENT_INTERNAL_TOKEN: "t",
  ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
};

test("the OTP is not echoed back unless OTP_DEV_EXPOSE=true is set explicitly", () => {
  assert.equal(loadConfig({ ...base }).otpDevExpose, false, "NODE_ENV unset");
  assert.equal(loadConfig({ ...base, NODE_ENV: "development" }).otpDevExpose, false);
  assert.equal(loadConfig({ ...base, NODE_ENV: "development", OTP_DEV_EXPOSE: "true" }).otpDevExpose, true);
  assert.equal(loadConfig({ ...base, NODE_ENV: "test", OTP_DEV_EXPOSE: "true" }).otpDevExpose, true);
});

test("OTP_DEV_EXPOSE=true in production refuses to boot", () => {
  assert.throws(() => loadConfig({ ...prod, OTP_DEV_EXPOSE: "true" }), /OTP_DEV_EXPOSE/);
  assert.equal(loadConfig({ ...prod }).otpDevExpose, false);
});

test("production shows the code on screen only with a second, explicit switch (hosted demo)", () => {
  // docs/deploy.md: sign-in codes have no delivery channel yet, so the
  // hosted demo shows them on screen. Both switches, or it refuses as above.
  assert.equal(loadConfig({ ...prod, OTP_DEV_EXPOSE: "true", OTP_SHOW_IN_PRODUCTION: "true" }).otpDevExpose, true);
  assert.throws(() => loadConfig({ ...prod, OTP_DEV_EXPOSE: "true", OTP_SHOW_IN_PRODUCTION: "yes" }), /OTP_DEV_EXPOSE/);
  // The second switch alone turns nothing on.
  assert.equal(loadConfig({ ...prod, OTP_SHOW_IN_PRODUCTION: "true" }).otpDevExpose, false);
});

test("an unrecognised NODE_ENV refuses to boot instead of becoming development", () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "prod" }), /NODE_ENV/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "Production" }), /NODE_ENV/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "staging" }), /NODE_ENV/);
});

test("there is no built-in webhook encryption key", () => {
  assert.throws(
    () => loadConfig({ DATABASE_URL: "postgres://unused/db", NODE_ENV: "development" }),
    /WEBHOOK_SECRET_ENCRYPTION_KEY/,
  );
});

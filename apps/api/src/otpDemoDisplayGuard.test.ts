/**
 * OTP_DEMO_DISPLAY shows sign-in codes on the login screens, which makes the
 * password alone enough to sign in. In production it now needs the same
 * second, deliberately named switch as OTP_DEV_EXPOSE (docs/defence/02).
 * Pure: loadConfig only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const BASE = {
  DATABASE_URL: "postgres://x@localhost/x",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  SETTLEMENT_INTERNAL_TOKEN: "t",
  ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
};

test("in production OTP_DEMO_DISPLAY alone is refused at boot", () => {
  assert.throws(() => loadConfig({ ...BASE, NODE_ENV: "production", OTP_DEMO_DISPLAY: "true" }), /OTP_DEMO_DISPLAY/);
  // "1" used to switch it on too; now it does nothing, in production as anywhere.
  assert.equal(loadConfig({ ...BASE, NODE_ENV: "production", OTP_DEMO_DISPLAY: "1" }).otpDemoDisplay, false);
});

test("in production it is allowed with OTP_SHOW_IN_PRODUCTION=true", () => {
  const config = loadConfig({ ...BASE, NODE_ENV: "production", OTP_DEMO_DISPLAY: "true", OTP_SHOW_IN_PRODUCTION: "true" });
  assert.equal(config.otpDemoDisplay, true);
});

test("only the exact value true turns it on", () => {
  assert.equal(loadConfig({ ...BASE, NODE_ENV: "development", OTP_DEMO_DISPLAY: "1" }).otpDemoDisplay, false);
  assert.equal(loadConfig({ ...BASE, NODE_ENV: "development", OTP_DEMO_DISPLAY: "yes" }).otpDemoDisplay, false);
  assert.equal(loadConfig({ ...BASE, NODE_ENV: "development", OTP_DEMO_DISPLAY: "true" }).otpDemoDisplay, true);
  assert.equal(loadConfig({ ...BASE, NODE_ENV: "production" }).otpDemoDisplay, false);
});

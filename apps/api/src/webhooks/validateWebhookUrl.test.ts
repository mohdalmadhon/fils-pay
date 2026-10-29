/** Save-time webhook URL checks. Pure. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateWebhookUrl } from "./create.js";

const prod = { nodeEnv: "production" as const, webhookAllowPrivateHosts: false };
const dev = { nodeEnv: "development" as const, webhookAllowPrivateHosts: true };

test("production refuses private, loopback, metadata and local-name hosts", () => {
  for (const url of [
    "https://127.0.0.1/hook",
    "https://10.0.0.5/hook",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/hook",
    "https://localhost/hook",
    "https://settlement:8091/internal",
    "https://metadata.google.internal/",
  ]) {
    assert.throws(() => validateWebhookUrl(url, prod), /invalid_url|public host/, url);
  }
});

test("URLs carrying credentials are refused", () => {
  assert.throws(() => validateWebhookUrl("https://user:pass@hooks.example.com/x", prod));
});

test("a public https host is accepted", () => {
  assert.equal(validateWebhookUrl("https://hooks.example.com/x", prod).hostname, "hooks.example.com");
});

test("local receivers still work where private hosts are allowed (dev, tests)", () => {
  assert.equal(validateWebhookUrl("http://127.0.0.1:4000/hook", dev).port, "4000");
});

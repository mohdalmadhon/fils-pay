/**
 * Request logs must not carry bearer secrets in the URL. A payment link
 * token is the only credential the public pay page needs, and Fastify's
 * default request log line includes the full URL. Pure.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { redactUrl, requestLogSerializer } from "./logRedaction.js";

test("payment link tokens are removed from logged URLs", () => {
  assert.equal(redactUrl("/v1/payment-links/plk_abc123DEF"), "/v1/payment-links/[redacted]");
  assert.equal(redactUrl("/v1/payment-links/plk_abc123DEF/pay"), "/v1/payment-links/[redacted]/pay");
  assert.equal(redactUrl("/v1/payment-links/plk_abc123DEF/pay?x=1"), "/v1/payment-links/[redacted]/pay?x=1");
});

test("other URLs are untouched", () => {
  assert.equal(redactUrl("/v1/merchants/abc/payment-links"), "/v1/merchants/abc/payment-links");
  assert.equal(redactUrl("/health"), "/health");
});

test("the request serializer logs the redacted URL and nothing secret", () => {
  const line = requestLogSerializer({
    method: "POST",
    url: "/v1/payment-links/plk_secret/pay",
    headers: { authorization: "Bearer fp_live_x", cookie: "fp_sid=y", host: "api" },
    ip: "10.0.0.1",
  });
  const text = JSON.stringify(line);
  assert.equal(text.includes("plk_secret"), false);
  assert.equal(text.includes("fp_live_x"), false);
  assert.equal(text.includes("fp_sid"), false);
  assert.equal(line.url, "/v1/payment-links/[redacted]/pay");
});

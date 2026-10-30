/**
 * The Caddyfile keeps the pages' security headers (docs/defence/06): no
 * framing of the checkout or the Ops console, HSTS, and a CSP that allows
 * only the apps' own scripts and calls. Pure: reads ops/Caddyfile.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const caddyfile = readFileSync(new URL("../ops/Caddyfile", import.meta.url), "utf8");
const block = caddyfile.slice(caddyfile.indexOf("(app) {"), caddyfile.indexOf("@api"));

test("the app pages are sent with framing, HSTS and CSP headers", () => {
  assert.match(block, /X-Frame-Options DENY/);
  assert.match(block, /Strict-Transport-Security "max-age=\d{7,}/);
  const csp = /Content-Security-Policy "([^"]+)"/.exec(block)?.[1] ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/, "scripts from the app's own origin only");
  assert.match(csp, /connect-src 'self'(;|$)/, "calls only to its own origin (/v1)");
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(block, /X-Content-Type-Options nosniff/);
});

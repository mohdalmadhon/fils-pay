/**
 * The real webhook transport must not be usable as an SSRF proxy:
 *   - it refuses to connect to loopback/private/link-local addresses unless
 *     private hosts are explicitly allowed (local dev and these tests);
 *   - it never follows redirects (a 3xx is returned as the result);
 *   - it reads at most WEBHOOK_RESPONSE_BODY_LIMIT bytes of the response.
 *
 * Before the fix the transport was plain fetch(): it connected anywhere,
 * followed redirects (302 to the cloud metadata address), and read the
 * whole body into memory. No database needed.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createFetchTransport, WEBHOOK_RESPONSE_BODY_LIMIT } from "./transport.js";

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    handler!(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hook`, hits: () => hits };
}

const send = (transport: ReturnType<typeof createFetchTransport>, url: string) =>
  transport({ url, headers: { "Content-Type": "application/json" }, body: "{}", timeoutMs: 5_000 });

test("a loopback receiver is refused unless private hosts are allowed", async () => {
  const receiver = await listen((_req, res) => res.end("ok"));

  const blocked = await send(createFetchTransport({ allowPrivateHosts: false }), receiver.url);
  assert.equal(blocked.statusCode, null);
  assert.match(blocked.errorMessage ?? "", /not allowed/);
  assert.equal(receiver.hits(), 0, "no connection was made");

  const allowed = await send(createFetchTransport({ allowPrivateHosts: true }), receiver.url);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body, "ok");
});

test("a localhost name resolving to loopback is refused too", async () => {
  const receiver = await listen((_req, res) => res.end("ok"));
  const url = receiver.url.replace("127.0.0.1", "localhost");
  const blocked = await send(createFetchTransport({ allowPrivateHosts: false }), url);
  assert.equal(blocked.statusCode, null);
  assert.equal(receiver.hits(), 0);
});

test("redirects are not followed", async () => {
  const target = await listen((_req, res) => res.end("secret-from-internal-service"));
  const redirector = await listen((_req, res) => {
    res.writeHead(302, { location: target.url });
    res.end();
  });

  const result = await send(createFetchTransport({ allowPrivateHosts: true }), redirector.url);
  assert.equal(result.statusCode, 302);
  assert.equal(result.body.includes("secret-from-internal-service"), false);
  assert.equal(target.hits(), 0, "the redirect target was never contacted");
});

test("the response body read is capped", async () => {
  const big = "x".repeat(WEBHOOK_RESPONSE_BODY_LIMIT * 8);
  const receiver = await listen((_req, res) => res.end(big));
  const result = await send(createFetchTransport({ allowPrivateHosts: true }), receiver.url);
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.length <= WEBHOOK_RESPONSE_BODY_LIMIT, `read ${result.body.length} bytes`);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { isPriorityRequest, overloadGuardPlugin } from "./overloadGuard.js";

/**
 * The overload guard (docs/perf/checkout-capacity.md): turns requests away
 * with 503 and Retry-After once the API is full, gives paying priority over
 * everything else, never sheds health probes, and frees its slot when a
 * request finishes.
 */

function build(maxInFlight: number, waiting = { waitingCount: 0 }) {
  const app = Fastify();
  app.register(overloadGuardPlugin, {
    config: { overloadMaxInFlight: maxInFlight, overloadMaxEventLoopDelayMs: 0, overloadMaxPoolWaiting: 5 },
    pool: waiting,
  });
  // A route that stays in flight until released.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  app.get("/v1/slow", async () => {
    await held;
    return { ok: true };
  });
  app.get("/v1/payment-links/:token", async () => ({ status: "active" }));
  app.post("/v1/payment-links/:token/pay", async () => ({ paid: true }));
  app.get("/healthz", async () => ({ status: "ok" }));
  return { app, release: () => release() };
}

test("pay requests are recognised as the priority", () => {
  assert.equal(isPriorityRequest({ method: "POST", url: "/v1/payment-links/abc/pay" }), true);
  assert.equal(isPriorityRequest({ method: "GET", url: "/v1/payment-links/abc" }), false);
  assert.equal(isPriorityRequest({ method: "POST", url: "/v1/payment-links/abc/pay/extra" }), false);
});

test("a full API answers 503 with Retry-After, and nothing reaches the route", async () => {
  const { app, release } = build(4); // general limit 3, pay limit 4
  await app.ready();
  const slow = [1, 2, 3].map(() => app.inject({ method: "GET", url: "/v1/slow" }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(app.overload.inFlight, 3);

  const view = await app.inject({ method: "GET", url: "/v1/payment-links/abc" });
  assert.equal(view.statusCode, 503);
  assert.equal(view.headers["retry-after"], "1");
  assert.equal(view.json().error, "overloaded");

  // Paying may still use the last slot.
  const pay = await app.inject({ method: "POST", url: "/v1/payment-links/abc/pay", payload: {} });
  assert.equal(pay.statusCode, 200);

  // Health probes are never shed, so a busy API isn't restarted as dead.
  const health = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(health.statusCode, 200);

  release();
  await Promise.all(slow);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(app.overload.inFlight, 0, "every slot is freed once its response is sent");
  assert.equal(app.overload.shedTotal, 1);
  const again = await app.inject({ method: "GET", url: "/v1/payment-links/abc" });
  assert.equal(again.statusCode, 200, "it takes requests again as soon as there is room");
  await app.close();
});

test("requests queueing for a database connection shed page loads, not payments", async () => {
  const pool = { waitingCount: 5 };
  const { app } = build(100, pool);
  await app.ready();
  assert.equal((await app.inject({ method: "GET", url: "/v1/payment-links/abc" })).statusCode, 503);
  assert.equal((await app.inject({ method: "POST", url: "/v1/payment-links/abc/pay", payload: {} })).statusCode, 200);
  pool.waitingCount = 0;
  assert.equal((await app.inject({ method: "GET", url: "/v1/payment-links/abc" })).statusCode, 200);
  await app.close();
});

test("OVERLOAD_MAX_IN_FLIGHT=0 turns shedding off", async () => {
  const { app } = build(0, { waitingCount: 99 });
  await app.ready();
  assert.equal((await app.inject({ method: "GET", url: "/v1/payment-links/abc" })).statusCode, 200);
  await app.close();
});

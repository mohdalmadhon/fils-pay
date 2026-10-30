import { monitorEventLoopDelay } from "node:perf_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Pool } from "pg";
import type { Config } from "../config.js";

/**
 * Load shedding (docs/perf/checkout-capacity.md). Past its capacity the API
 * used to accept every request and let them queue for the 5 database
 * connections: checkout slowed for everyone at once, then requests failed
 * with 500s when a connection wait passed 5 s. Now, once it is full, it
 * turns the excess away at once with 503 and Retry-After, before reading
 * the body or touching the database, so the requests it does accept stay
 * fast and a turned-away buyer is never charged and can simply retry.
 *
 * "Full" is any of:
 *   - in-flight requests at the limit (OVERLOAD_MAX_IN_FLIGHT);
 *   - the event loop lagging (OVERLOAD_MAX_EVENT_LOOP_DELAY_MS, p99 over
 *     the last 250 ms): the CPU is saturated;
 *   - requests queueing for a database connection
 *     (OVERLOAD_MAX_POOL_WAITING).
 *
 * Paying has priority: a checkout's pay request may use the whole in-flight
 * limit and is turned away only by that limit; everything else (loading
 * the link, the dashboard) gets 75 % of it and is also turned away by the
 * other two signals. So a buyer who already has the page finishes before
 * new page loads are let in: once a buyer is paying, finishing that
 * checkout is the most useful thing the API can do, so the softer signals
 * never refuse it. (An earlier note here said refusing payments on lag
 * made throughput collapse. That drop turned out to be the load test
 * running out of payment links, not the guard; see "Corrections" in
 * docs/perf/checkout-capacity.md.) Liveness and
 * readiness probes and CORS preflights are never shed, so a busy API isn't
 * mistaken for a dead one and restarted.
 */
export interface OverloadState {
  inFlight: number;
  shedTotal: number;
  eventLoopDelayMs: number;
}

const EXEMPT = new Set(["/healthz", "/readyz"]);
const PAY = /^\/v1\/payment-links\/[^/]+\/pay(?:\?|$)/;

export function isPriorityRequest(request: Pick<FastifyRequest, "method" | "url">): boolean {
  return request.method === "POST" && PAY.test(request.url);
}

export const overloadGuardPlugin = fp<{
  config: Pick<Config, "overloadMaxInFlight" | "overloadMaxEventLoopDelayMs" | "overloadMaxPoolWaiting">;
  pool: Pick<Pool, "waitingCount">;
}>(
  async (app: FastifyInstance, opts): Promise<void> => {
    const { overloadMaxInFlight, overloadMaxEventLoopDelayMs, overloadMaxPoolWaiting } = opts.config;
    const state: OverloadState = { inFlight: 0, shedTotal: 0, eventLoopDelayMs: 0 };
    app.decorate("overload", state);
    if (overloadMaxInFlight <= 0) return; // 0 turns shedding off

    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const sampler = setInterval(() => {
      state.eventLoopDelayMs = Math.round(delay.percentile(99) / 1e6);
      delay.reset();
    }, 250);
    sampler.unref();
    app.addHook("onClose", async () => {
      clearInterval(sampler);
      delay.disable();
    });

    const generalLimit = Math.max(1, Math.floor(overloadMaxInFlight * 0.75));

    app.addHook("onRequest", async (request, reply) => {
      if (request.method === "OPTIONS" || EXEMPT.has(request.url.split("?")[0]!)) return;
      const busy = isPriorityRequest(request)
        ? state.inFlight >= overloadMaxInFlight
        : state.inFlight >= generalLimit ||
          (overloadMaxEventLoopDelayMs > 0 && state.eventLoopDelayMs > overloadMaxEventLoopDelayMs) ||
          (overloadMaxPoolWaiting > 0 && opts.pool.waitingCount >= overloadMaxPoolWaiting);
      if (busy) {
        state.shedTotal += 1;
        reply.header("Retry-After", "1");
        reply.code(503);
        return reply.send({
          error: "overloaded",
          message: "FilsPay is busy right now. Nothing was charged. Try again in a moment.",
        });
      }
      state.inFlight += 1;
      let released = false;
      // 'close' fires once the response is sent or the client goes away,
      // whichever comes first, so the count can't leak.
      reply.raw.once("close", () => {
        if (released) return;
        released = true;
        state.inFlight -= 1;
      });
    });
  },
  { name: "overload-guard" },
);

declare module "fastify" {
  interface FastifyInstance {
    overload: OverloadState;
  }
}

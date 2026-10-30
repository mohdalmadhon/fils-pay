import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "../config.js";

/**
 * Baseline security headers on every response (errors and 404s included).
 * The API serves JSON, CSV and KYC files, never HTML pages, so:
 *   - nosniff: browsers must not reinterpret a response's content type;
 *   - frame-options DENY / frame-ancestors 'none': nothing here is framed;
 *   - referrer-policy no-referrer;
 *   - cache-control no-store on /v1: responses are per-user (balances,
 *     transactions, KYC files) and must not sit in shared or browser caches;
 *   - HSTS in production only (local runs are plain http).
 * No CSP beyond frame-ancestors: there is no HTML to protect.
 */
export const securityHeadersPlugin = fp<{ config: Pick<Config, "nodeEnv"> }>(
  async (app: FastifyInstance, opts): Promise<void> => {
    app.addHook("onSend", async (request, reply, payload) => {
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("X-Frame-Options", "DENY");
      reply.header("Content-Security-Policy", "frame-ancestors 'none'");
      reply.header("Referrer-Policy", "no-referrer");
      if (request.url.startsWith("/v1/")) {
        reply.header("Cache-Control", "no-store");
      }
      if (opts.config.nodeEnv === "production") {
        reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      }
      return payload;
    });
  },
);

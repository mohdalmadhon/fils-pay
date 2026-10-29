import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

/**
 * CORS for the two browser apps (merchant dashboard, admin console).
 *
 * Both are served from their own origin (localhost:5173 / :5174 in dev) and
 * call this API with `credentials: "include"`, because they authenticate with
 * cookies. A browser only lets such a call through if the API answers with
 * `Access-Control-Allow-Origin: <that exact origin>` and
 * `Access-Control-Allow-Credentials: true`, and answers the OPTIONS
 * preflight that precedes any JSON POST. The API sent neither, so every
 * request from either app failed in the browser with "Failed to fetch".
 * (Comments in apps/web's client said "CORS is locked to the two origins in
 * config"; no such code existed.)
 *
 * Only origins in config.corsAllowedOrigins get these headers. Any other
 * origin gets none, so the browser keeps blocking it: a credentialed
 * response must never echo an arbitrary Origin.
 */

const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization, Idempotency-Key";
const PREFLIGHT_MAX_AGE_SECONDS = "600";

export const corsPlugin = fp(async (app: FastifyInstance): Promise<void> => {
  const allowed = new Set(app.config.corsAllowedOrigins);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    reply.header("Vary", "Origin");
    if (!origin || !allowed.has(origin)) {
      return;
    }

    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Access-Control-Allow-Credentials", "true");

    const isPreflight = request.method === "OPTIONS" && request.headers["access-control-request-method"] !== undefined;
    if (isPreflight) {
      reply
        .header("Access-Control-Allow-Methods", ALLOWED_METHODS)
        .header("Access-Control-Allow-Headers", ALLOWED_HEADERS)
        .header("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SECONDS)
        .code(204)
        .send();
      return reply;
    }
  });
});

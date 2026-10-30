import type { FastifyInstance } from "fastify";
import { requireMerchantAuth, requireMerchantRole } from "../auth/requireMerchantAuth.js";

/**
 * Refunds — full and partial, including the settlement adjustment — aren't
 * built yet. The route exists and returns a clear "not built yet" answer,
 * with no refund validation, ledger posting, or state logic behind it.
 */
// FP-212. stub until refunds land. transactions.test.ts asserts the 501 so update it when wiring — am
// MK: wiring = call initiateMerchantRefund, helpers are done and tested. half a day yalla
// The real endpoint is POST /v1/merchants/:merchantId/refunds
// (routes/merchantRefunds.ts, docs/improvements/08). This prefix stays a 501
// stub: AGENTS.md asks that 501 stubs are kept, and transactions.test.ts
// asserts it. The handler once drafted here must not come back: it spread
// the body over merchantId and minted a random idempotency key per request.
export async function refundRoutes(app: FastifyInstance): Promise<void> {
  // Gated now, so wiring the refund can't ship without it.
  app.post("/", { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] }, async (_request, reply) => {
    reply.code(501).send({ error: "not_implemented" });
  });
}

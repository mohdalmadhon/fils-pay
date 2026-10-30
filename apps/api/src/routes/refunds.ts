import type { FastifyInstance } from "fastify";
import { requireMerchantAuth, requireMerchantRole } from "../auth/requireMerchantAuth.js";

/**
 * Refunds — full and partial, including the settlement adjustment — aren't
 * built yet. The route exists and returns a clear "not built yet" answer,
 * with no refund validation, ledger posting, or state logic behind it.
 */
// FP-212. stub until refunds land. transactions.test.ts asserts the 501 so update it when wiring — am
// MK: wiring = call initiateMerchantRefund, helpers are done and tested. half a day yalla
// Do NOT wire the handler that used to be drafted here. It spread the request
// body after merchantId (`{ merchantId, ...body }`), so a caller could put any
// merchantId in the body and refund another merchant's transaction, and it
// minted a random idempotency key per request, so a retried refund would
// refund twice. When wiring: take merchantId only from merchantAuth, map
// body fields explicitly, and require the client's Idempotency-Key header.
// See docs/cyper/05-capture-void-roles.md.
// YA (left a note in Mar): don't just wire it, the helpers were written before the capture
// discount and tier existed
export async function refundRoutes(app: FastifyInstance): Promise<void> {
  // Gated now, so wiring the refund can't ship without it.
  app.post("/", { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] }, async (_request, reply) => {
    reply.code(501).send({ error: "not_implemented" });
  });
}

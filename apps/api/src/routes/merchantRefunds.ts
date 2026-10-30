import type { FastifyInstance, FastifyRequest } from "fastify";
import { toFils } from "@filspay/money";
import { requireMerchantAuth, requireMerchantRole, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
import { assertRefundRequestScope, initiateMerchantRefund } from "../refunds/initiateMerchantRefund.js";
import { canonicalUuid } from "../lib/uuid.js";
import { BadRequestError } from "../lib/errors.js";

interface MerchantIdParams {
  merchantId: string;
}

interface RefundBody {
  transactionId?: unknown;
  amountFils?: unknown;
  reason?: unknown;
}

function idempotencyKeyOf(request: FastifyRequest): string {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || key.length > 255) {
    throw new BadRequestError("idempotency_key_required", "Idempotency-Key header is required");
  }
  return key;
}

/**
 * Registered with prefix '/v1/merchants'.
 *
 * POST /:merchantId/refunds { transactionId, amountFils?, reason? }
 *   Full refund when amountFils is omitted. Answers what processRefund
 *   answers: 200 with the refund, 404 for a transaction that isn't the
 *   caller's, 409/422 when it can't be refunded, 402 declined, 502 acquirer
 *   down (retry with the same Idempotency-Key).
 *
 * What makes this safe (docs/improvements/08):
 *   - the merchant comes only from the path, checked against the caller;
 *     nothing in the body can choose it (the handler once drafted for the
 *     old stub spread the body over merchantId);
 *   - the body is mapped field by field and validated;
 *   - the client's Idempotency-Key is required, so a retried request replays
 *     instead of refunding twice (the draft minted a random key per request);
 *   - owner and finance only (API keys are owner-issued); view-only users
 *     and view-only admin sessions are refused.
 */
export async function merchantRefundRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: MerchantIdParams; Body: RefundBody }>(
    "/:merchantId/refunds",
    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
    async (request, reply) => {
      const auth = request.merchantAuth!;
      assertRefundRequestScope(auth, request.params.merchantId);
      const idempotencyKey = idempotencyKeyOf(request);

      const body = request.body ?? {};
      const transactionId = canonicalUuid(body.transactionId);
      if (!transactionId) {
        throw new BadRequestError("invalid_request", "transactionId (a UUID) is required");
      }
      let amountFils;
      if (body.amountFils !== undefined) {
        if (typeof body.amountFils !== "number") {
          throw new BadRequestError("invalid_request", "amountFils must be an integer number of fils");
        }
        try {
          amountFils = toFils(body.amountFils);
        } catch {
          throw new BadRequestError("invalid_request", "amountFils must be an integer number of fils");
        }
      }
      if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500)) {
        throw new BadRequestError("invalid_request", "reason must be a string of at most 500 characters");
      }

      const result = await initiateMerchantRefund(app.db, app.acquirer, {
        merchantId: auth.merchantId,
        transactionId,
        amountFils,
        idempotencyKey,
        actor: requireMerchantWriterActor(auth),
        reason: body.reason as string | undefined,
      });
      reply.code(result.statusCode).send(result.body);
    },
  );
}

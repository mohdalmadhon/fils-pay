import type { FastifyInstance, FastifyRequest } from "fastify";
import { BadRequestError, UnauthorizedError } from "../lib/errors.js";
import { isTimestampText } from "../lib/cursorParts.js";
import { canonicalUuid } from "../lib/uuid.js";
import { verifyAcquirerCallbackSignature } from "../webhooks/inboundVerify.js";
import { applyAcquirerCallback, withCallbackRetry, type AcquirerCallbackInput } from "../acquirer/callbacks.js";

// header name confirmed with the acquirer's integration guide v3.2 — am
const ACQUIRER_SIGNATURE_HEADER = "acquirer-callback-signature";

declare module "fastify" {
  interface FastifyRequest {
    /** The request body exactly as received, kept for signature checks. */
    acquirerRawBody?: string;
  }
}

/**
 * Body of a fraud_review.completed callback. `outcome` must be one of
 * AcquirerCallbackInput's values ("cleared" | "confirmed_fraud"),
 * `transactionId` a UUID and `occurredAt` a real date; anything else is a
 * 400 (docs/bugs/013).
 */
interface AcquirerCallbackBody {
  callbackId?: string;
  type?: string;
  transactionId?: string;
  occurredAt?: string;
  outcome?: string;
  note?: string;
}

const CALLBACK_OUTCOMES: readonly AcquirerCallbackInput["outcome"][] = ["cleared", "confirmed_fraud"];

function isCallbackOutcome(value: unknown): value is AcquirerCallbackInput["outcome"] {
  return typeof value === "string" && (CALLBACK_OUTCOMES as readonly string[]).includes(value);
}

/** Header format: "t=<unix seconds>,v1=<hex hmac>". A repeated header uses the first value. */
function getSignatureHeader(request: FastifyRequest): string | undefined {
  const header = request.headers[ACQUIRER_SIGNATURE_HEADER];
  return Array.isArray(header) ? header[0] : header;
}

/**
 * The acquirer's own async callback surface: the
 * acquirer simulator's authorize/capture/refund calls
 * (acquirer/simulator.ts) stay fully synchronous request/response, but a
 * delayed fraud-review verdict only ever resolves out of band, so the
 * acquirer posts the result back to us instead. Public — the caller is the
 * acquirer, not a FilsPay merchant session or admin user, so this route
 * carries no requireMerchantAuth/requireAdminSession preHandler.
 * Acquirer-Callback-Signature verification is the only authentication this
 * endpoint has.
 */
export async function acquirerCallbackRoutes(app: FastifyInstance): Promise<void> {
  // Keep the raw body for signature verification. The signature covers the
  // bytes the acquirer sent; re-serializing the parsed JSON can produce
  // different bytes. This parser is scoped to this plugin only, so no other
  // route's JSON handling changes.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, rawBody, done) => {
    const text = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    request.acquirerRawBody = text;
    if (text.trim() === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new BadRequestError("invalid_json", "request body is not valid JSON"), undefined);
    }
  });

  app.post<{ Body: AcquirerCallbackBody }>("/callbacks", async (request, reply) => {
    const body = request.body ?? {};
    if (
      !body.callbackId ||
      body.type !== "fraud_review.completed" ||
      !body.transactionId ||
      !body.occurredAt ||
      !body.outcome ||
      !body.note
    ) {
      throw new BadRequestError(
        "invalid_request",
        "callbackId, type, transactionId, occurredAt, outcome, and note are required",
      );
    }

    const verification = verifyAcquirerCallbackSignature(
      request.acquirerRawBody ?? body,
      getSignatureHeader(request),
      app.config.acquirerCallbackSigningSecret,
      app.config.acquirerCallbackRequireSignature,
      { toleranceSeconds: app.config.acquirerCallbackToleranceSeconds },
    );
    if (!verification.valid) {
      throw new UnauthorizedError("invalid_signature", verification.reason);
    }

    // The values, not just their presence. outcome used to be cast and
    // stored as any string (the column has no CHECK), and a bad
    // transactionId or occurredAt reached SQL and came back as a 500 after
    // being retried. docs/bugs/013.
    if (!isCallbackOutcome(body.outcome)) {
      throw new BadRequestError("invalid_outcome", `outcome must be one of: ${CALLBACK_OUTCOMES.join(", ")}`);
    }
    const transactionId = canonicalUuid(body.transactionId);
    if (!transactionId) {
      throw new BadRequestError("invalid_request", "transactionId must be a UUID");
    }
    if (typeof body.occurredAt !== "string" || !isTimestampText(body.occurredAt)) {
      throw new BadRequestError("invalid_request", "occurredAt must be an ISO 8601 date-time");
    }
    if (typeof body.callbackId !== "string" || typeof body.note !== "string") {
      throw new BadRequestError("invalid_request", "callbackId and note must be strings");
    }

    const callback: AcquirerCallbackInput = {
      callbackId: body.callbackId,
      type: "fraud_review.completed",
      transactionId,
      occurredAt: body.occurredAt,
      outcome: body.outcome,
      note: body.note,
    };

    const { duplicate } = await withCallbackRetry(() => applyAcquirerCallback(app.db, callback));
    if (duplicate) {
      // A redelivery of a callback we already saved. Still answer 200 so the
      // acquirer stops retrying; nothing new is written.
      request.log.info(
        { callbackId: callback.callbackId, transactionId: callback.transactionId },
        "acquirer callback redelivery ignored",
      );
    }
    reply.code(200).send({ received: true });
  });
}

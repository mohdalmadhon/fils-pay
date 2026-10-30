import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireRole, requireSession } from "../auth/middleware.js";
import { createMerchantWithOwner, type SignupInput } from "../onboarding/signup.js";
import { reserveSignup } from "../onboarding/signupLimits.js";
import { getBusinessProfile, updateBusinessProfile, type BusinessProfilePatch } from "../onboarding/businessProfile.js";
import { BadRequestError, ForbiddenError } from "../lib/errors.js";

interface MerchantIdParams {
  merchantId: string;
}

/**
 * Registered with prefix '/v1/merchants'. Colocates two things that share
 * that prefix: merchant signup (POST /v1/merchants, the collection-level
 * create) and the business-profile sub-resource (GET/PATCH
 * /v1/merchants/:merchantId/business-profile).
 */
export async function businessProfileRoutes(app: FastifyInstance): Promise<void> {
  // Signup is public. Emails are unique per merchant, not globally (one
  // person may own several merchants), so the limits below, the password
  // rules and the OTP-at-login (which proves the address) are what stop
  // abuse. docs/improvements/11.
  app.post<{ Body: Partial<SignupInput> }>("/", async (request, reply) => {
    const body = request.body ?? {};
    if (!body.businessProfile || !body.owner) {
      throw new BadRequestError("invalid_request", "businessProfile and owner are required");
    }
    const bp = body.businessProfile;
    const owner = body.owner;
    if (
      !bp.legalName ||
      !bp.registrationNumber ||
      !bp.businessType ||
      !bp.contactEmail ||
      !bp.contactPhone ||
      !bp.addressLine1 ||
      !bp.city ||
      !owner.email ||
      !owner.password
    ) {
      throw new BadRequestError("invalid_request", "missing required business profile or owner fields");
    }

    await reserveSignup(app.db, app.config, String(owner.email), request.ip);
    const result = await createMerchantWithOwner(app.db, app.config, body as SignupInput);
    reply.code(201).send({
      merchantId: result.merchantId,
      ownerUserId: result.ownerUserId,
      onboardingStatus: result.onboardingStatus,
    });
  });

  app.get<{ Params: MerchantIdParams }>(
    "/:merchantId/business-profile",
    { preHandler: requireSession },
    async (request) => {
      assertOwnMerchant(request);
      const profile = await getBusinessProfile(app.db, request.params.merchantId);
      return profile;
    },
  );

  app.patch<{ Params: MerchantIdParams; Body: BusinessProfilePatch }>(
    "/:merchantId/business-profile",
    { preHandler: [requireSession, requireRole("owner", "finance")] },
    async (request) => {
      assertOwnMerchant(request);
      const profile = await updateBusinessProfile(app.db, request.params.merchantId, request.body ?? {});
      return profile;
    },
  );
}

function assertOwnMerchant(request: FastifyRequest<{ Params: MerchantIdParams }>): void {
  if (!request.auth || request.auth.merchantId !== request.params.merchantId) {
    throw new ForbiddenError("forbidden");
  }
}

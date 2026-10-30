import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireRole, requireSession } from "../auth/middleware.js";
import { createMerchantWithOwner, type SignupInput } from "../onboarding/signup.js";
import { reserveSignup } from "../onboarding/signupLimits.js";
import { getBusinessProfile, updateBusinessProfile, type BusinessProfilePatch } from "../onboarding/businessProfile.js";
import { normalizeEmail, validateBusinessProfileFields } from "../onboarding/profileValidation.js";
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
    if (typeof body.businessProfile !== "object" || typeof body.owner !== "object") {
      throw new BadRequestError("invalid_request", "businessProfile and owner must be objects");
    }
    // Validate everything first. The signup slot is only reserved for a
    // request that could succeed, so a typo doesn't use up the quota.
    const businessProfile = validateBusinessProfileFields(body.businessProfile as unknown as Record<string, unknown>, {
      partial: false,
    }) as unknown as SignupInput["businessProfile"];
    const owner = body.owner;
    if (!owner.password) {
      throw new BadRequestError("invalid_request", "missing required business profile or owner fields");
    }
    const ownerEmail = normalizeEmail(owner.email, "owner.email");

    // 12+ characters (length beats composition rules), and at most 256 so a
    // huge body can't make argon2 hash megabytes. It accepted anything,
    // including one character. docs/improvements/11.
    if (typeof owner.password !== "string" || owner.password.length < 12 || owner.password.length > 256) {
      throw new BadRequestError("weak_password", "the password must be 12 to 256 characters");
    }
    const input: SignupInput = { businessProfile, owner: { email: ownerEmail, password: owner.password } };
    await reserveSignup(app.db, app.config, ownerEmail, request.ip);
    const result = await createMerchantWithOwner(app.db, app.config, input);
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

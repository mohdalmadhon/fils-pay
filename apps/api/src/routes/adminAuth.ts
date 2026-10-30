import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyPassword } from "../adminAuth/passwords.js";
import { issueAdminChallenge } from "../adminAuth/otp.js";
import { attemptOtp, consumeOtpChallenge } from "../auth/otp.js";
import { sendAdminOtpCode } from "../adminAuth/notifier.js";
import { adminAccountKey, assertUnderLoginLimit, recordAuthFailure, releaseLoginAttempt, reserveLoginAttempt } from "../auth/throttle.js";
import { requireAdminSession } from "../adminAuth/middleware.js";
import {
  createPendingAdminSession,
  lookupPendingAdminSession,
  promoteAdminSession,
  revokeAdminSession,
  type AdminRole,
} from "../adminAuth/sessions.js";
import { withTransaction } from "../db/withTransaction.js";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { BadRequestError, GoneError, TooManyRequestsError, UnauthorizedError } from "../lib/errors.js";

/**
 * A pre-computed argon2id hash of a fixed, never-used dummy password, at the
 * same cost parameters this app defaults to. Verified against on every login
 * attempt for an email that doesn't resolve to an active admin, so a failed
 * lookup and a failed password check take comparable time.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$/yKuaUqm4SW+pPt2oGNj4A$j5oxu/MdJJP86dClo0LJ0wsekKwkSbr1yA0uZSZgQcc";

interface LoginBody {
  email?: string;
  password?: string;
}

interface OtpVerifyBody {
  code?: string;
}

/** status 'disabled' blocks login and kills existing sessions (requireAdminSession re-reads it). */
interface AdminUserRow {
  id: string;
  email: string;
  role: AdminRole;
  password_hash: string;
}

/**
 * Registered with prefix '/v1/admin/auth'. Structurally identical to the
 * merchant login (password -> OTP -> authenticated session), with one
 * simplification the schema makes possible: `admin_users.email` is globally
 * unique, so unlike merchant login there is no tenant id to disambiguate
 * with — the lookup is unambiguous by construction.
 *
 * Admin login requires OTP deliberately: this is the plane where the most
 * dangerous operations live, so it must not have a weaker login factor than
 * an ordinary merchant dashboard user.
 */
export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginBody }>("/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      throw new BadRequestError("invalid_request", "email and password are required");
    }
    // Client JSON: a non-string email crashed adminAccountKey's trim() (500).
    if (typeof email !== "string" || typeof password !== "string") {
      throw new BadRequestError("invalid_request", "email and password must be strings");
    }

    // Same throttle as merchant login, checked before the password.
    const accountKey = adminAccountKey(email);
    const attemptId = await reserveLoginAttempt(app.db, app.config, { plane: "admin", accountKey, ipAddress: request.ip });

    const userResult = await app.db.query<AdminUserRow>(
      `SELECT id, email, role, password_hash FROM admin_users WHERE email = $1 AND status = 'active'`,
      [email],
    );
    const user = userResult.rows[0];

    const passwordOk = await verifyPassword(user ? user.password_hash : DUMMY_PASSWORD_HASH, password);

    // The same generic error in every failure case (no row, disabled
    // account, or wrong password) — the response never discloses which.
    if (!user || !passwordOk) {
      // The reserved attempt stays recorded as a failure.
      throw new UnauthorizedError("invalid_credentials");
    }
    await releaseLoginAttempt(app.db, attemptId);

    const { code, expiresAt, rawToken } = await withTransaction(app.db, async (client) => {
      const challenge = await issueAdminChallenge(client, {
        adminUserId: user.id,
        ttlMinutes: app.config.adminOtpTtlMinutes,
        codeLength: app.config.adminOtpCodeLength,
        maxAttempts: app.config.adminOtpMaxAttempts,
      });
      const session = await createPendingAdminSession(client, {
        adminUserId: user.id,
        otpChallengeId: challenge.id,
        ttlMinutes: app.config.adminPendingSessionTtlMinutes,
        ipAddress: request.ip,
        userAgent: (request.headers["user-agent"] as string | undefined) ?? null,
      });
      return { code: challenge.code, expiresAt: challenge.expiresAt, rawToken: session.rawToken };
    });

    sendAdminOtpCode(request.log, app.config, { adminUserId: user.id, email: user.email }, code);

    reply.setCookie(app.config.adminCookieName, rawToken, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: app.config.cookieSecure,
      maxAge: app.config.adminPendingSessionTtlMinutes * 60,
    });

    const responseBody: Record<string, unknown> = {
      otpRequired: true,
      otpExpiresAt: expiresAt.toISOString(),
    };
    if (app.config.otpDevExpose || app.config.otpDemoDisplay) {
      responseBody.devOtpCode = code;
    }
    reply.code(200).send(responseBody);
  });

  app.post<{ Body: OtpVerifyBody }>("/otp/verify", async (request, reply) => {
    const code = request.body?.code;
    if (!code) {
      throw new BadRequestError("invalid_request", "code is required");
    }

    const rawToken = request.cookies[app.config.adminCookieName];
    if (!rawToken) {
      throw new UnauthorizedError("no_pending_session");
    }
    const pending = await lookupPendingAdminSession(app.db, rawToken);
    if (!pending || !pending.otpChallengeId) {
      throw new UnauthorizedError("no_pending_session");
    }

    // Same atomic attempt claim as merchant login (see attemptOtp). The old
    // comment here said this path read the challenge FOR UPDATE; it didn't,
    // so parallel guesses beat the attempt limit on admin logins too.
    // The account's login limit covers code guesses too (docs/defence/01).
    const who = await app.db.query<{ email: string }>(`SELECT email FROM admin_users WHERE id = $1`, [pending.adminUserId]);
    const accountKey = who.rows[0] ? adminAccountKey(who.rows[0].email) : null;
    if (accountKey) {
      await assertUnderLoginLimit(app.db, app.config, { accountKey, ipAddress: request.ip });
    }

    const attempt = await attemptOtp(app.db, "admin_otp_challenges", pending.otpChallengeId, code);
    if (attempt.outcome === "expired") {
      throw new GoneError("otp_expired");
    }
    if (attempt.outcome === "too_many_attempts") {
      await revokeAdminSession(app.db, pending.adminSessionId);
      throw new TooManyRequestsError("too_many_attempts");
    }
    if (attempt.outcome === "invalid_code") {
      if (accountKey) {
        await recordAuthFailure(app.db, app.config, {
          plane: "admin",
          kind: "otp",
          accountKey,
          ipAddress: request.ip,
        });
      }
      throw new UnauthorizedError("invalid_code");
    }

    const challengeId = pending.otpChallengeId;
    const adminUser = await withTransaction(app.db, async (client) => {
      if (!(await consumeOtpChallenge(client, "admin_otp_challenges", challengeId))) {
        throw new GoneError("otp_expired");
      }
      const promoted = await promoteAdminSession(client, pending.adminSessionId, app.config.adminSessionTtlHours);
      const result = await client.query<{ role: AdminRole }>(
        `SELECT role FROM admin_users WHERE id = $1`,
        [pending.adminUserId],
      );
      const row = result.rows[0];
      return row ? { ...row, rawToken: promoted.rawToken } : undefined;
    });
    if (!adminUser) {
      throw new Error("admin otp/verify: admin_users row disappeared mid-transaction");
    }

    // The new token (see promoteAdminSession), at the full session TTL rather
    // than the short pending window. The pending token is now dead.
    reply.setCookie(app.config.adminCookieName, adminUser.rawToken, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: app.config.cookieSecure,
      maxAge: app.config.adminSessionTtlHours * 3_600,
    });

    reply.code(200).send({
      authenticated: true,
      adminUserId: pending.adminUserId,
      role: adminUser.role,
    });
  });

  app.get("/me", { preHandler: requireAdminSession }, async (request: FastifyRequest) => {
    const auth = request.adminAuth;
    if (!auth) {
      throw new UnauthorizedError("unauthenticated");
    }
    return { adminUserId: auth.adminUserId, email: auth.email, role: auth.role };
  });

  app.post(
    "/logout",
    { preHandler: requireAdminSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.adminAuth;
      if (!auth) {
        throw new UnauthorizedError("unauthenticated");
      }
      // End this admin's live "view as merchant" grants too. A grant is a
      // separate cookie, so without this it kept working for the rest of its
      // TTL (up to 15 minutes) after logout, on whatever machine held it.
      // Each one is closed like the normal "end view-as" path does
      // (admin/impersonation.ts endImpersonation): ended_at set and an
      // impersonation_end audit row, in the same transaction.
      await withTransaction(app.db, async (client) => {
        await revokeAdminSession(client, auth.adminSessionId);
        const ended = await client.query<{ id: string; merchant_id: string }>(
          `UPDATE admin_impersonation_grants
              SET revoked_at = now(), ended_at = now()
            WHERE admin_user_id = $1 AND revoked_at IS NULL AND ended_at IS NULL AND expires_at > now()
          RETURNING id, merchant_id`,
          [auth.adminUserId],
        );
        for (const grant of ended.rows) {
          await insertAdminAuditLog(client, {
            adminUserId: auth.adminUserId,
            action: "impersonation_end",
            targetType: "merchant",
            targetId: grant.merchant_id,
            metadata: { grantId: grant.id, reason: "logout" },
          });
        }
      });
      reply.setCookie(app.config.impersonationCookieName, "", {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: app.config.cookieSecure,
        maxAge: 0,
      });
      reply.setCookie(app.config.adminCookieName, "", {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: app.config.cookieSecure,
        maxAge: 0,
      });
      reply.code(204).send();
    },
  );
}

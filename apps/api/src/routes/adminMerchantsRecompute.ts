import type { FastifyInstance } from "fastify";
import { requireAdminRole, requireAdminSession } from "../adminAuth/middleware.js";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { merchantExists, UUID_RE } from "../admin/merchants.js";
import { recomputeTransactionStatusesForMerchant } from "../admin/transactionStatusRecompute.js";
import { withTransaction } from "../db/withTransaction.js";
import { NotFoundError, UnauthorizedError } from "../lib/errors.js";

interface MerchantIdParams {
  id: string;
}

export async function adminMerchantsRecomputeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: MerchantIdParams }>(
    "/:id/transactions/recompute-statuses",
    { preHandler: [requireAdminSession, requireAdminRole("finance", "super_admin")] },
    async (request, reply) => {
      const adminAuth = request.adminAuth;
      if (!adminAuth) throw new UnauthorizedError("unauthenticated");
      if (!UUID_RE.test(request.params.id)) throw new NotFoundError("merchant_not_found");
      if (!(await merchantExists(app.db, request.params.id))) {
        throw new NotFoundError("merchant_not_found");
      }

      // This tool only re-derives transaction statuses from their amounts.
      // It used to also clear the merchant's test_mode flag ("reconcile the
      // sandbox flag") whenever it saw no open authorizations, and its count
      // of open authorizations was always 0, so every test merchant it ran on
      // was silently made live. The settlement service only skips
      // test_mode merchants, so their test transactions were then settled and
      // paid out. Making a merchant live is a decision, not a side effect of
      // tidying statuses, so nothing here touches merchant flags any more.
      // flagsUpdated stays in the response (always empty) for the console.
      const result = await withTransaction(app.db, async (client) => {
        const recompute = await recomputeTransactionStatusesForMerchant(client, request.params.id);
        const flagsUpdated: string[] = [];
        await insertAdminAuditLog(client, {
          adminUserId: adminAuth.adminUserId,
          action: "transaction_status_recompute",
          targetType: "merchant",
          targetId: request.params.id,
          metadata: {
            scanned: recompute.scanned,
            updated: recompute.updated,
            flagsUpdated,
          },
        });
        return { ...recompute, flagsUpdated };
      });

      reply.code(200).send(result);
    },
  );
}

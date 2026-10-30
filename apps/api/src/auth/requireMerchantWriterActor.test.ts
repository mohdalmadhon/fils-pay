/** A view-only impersonation grant can never be turned into a writer. Pure. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { requireMerchantWriterActor, type MerchantAuthContext } from "./requireMerchantAuth.js";

const grant = (role: MerchantAuthContext["role"]): MerchantAuthContext => ({
  merchantId: "m",
  actorType: "admin_impersonation",
  actorId: "grant-1",
  role,
  impersonatedByAdminUserId: "admin-1",
});

test("support-level impersonation is refused as a writer", () => {
  assert.throws(() => requireMerchantWriterActor(grant("support")), (e: { statusCode?: number }) => e.statusCode === 403);
  assert.throws(() => requireMerchantWriterActor(grant("finance")), (e: { statusCode?: number }) => e.statusCode === 403);
});

test("super_admin impersonation (owner role) may write", () => {
  assert.deepEqual(requireMerchantWriterActor(grant("owner")), { type: "merchant_session", id: "grant-1" });
});

test("merchant sessions and API keys are unchanged", () => {
  assert.deepEqual(
    requireMerchantWriterActor({ merchantId: "m", actorType: "merchant_session", actorId: "s", role: "support" }),
    { type: "merchant_session", id: "s" },
  );
  assert.deepEqual(
    requireMerchantWriterActor({ merchantId: "m", actorType: "merchant_api_key", actorId: "k", role: null }),
    { type: "merchant_api_key", id: "k" },
  );
});

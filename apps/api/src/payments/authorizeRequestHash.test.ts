/**
 * The idempotency fingerprint of an authorize request must not let anyone
 * recover the card number or CVV from idempotency_keys.request_hash.
 *
 * Before the fix the stored hash was an unsalted sha256 over the whole
 * request, full PAN and CVV included. With the BIN, last digits, amount and
 * reference known, the remaining search space is small enough to brute-force
 * offline. Storing CVV-derived data after authorization is also a card-rules
 * (PCI DSS) violation.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { createMerchant } from "../testing/adminFixtures.js";
import { canonicalJson } from "./idempotency.js";
import { authorizeRequestHash } from "./authorize.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("authorizeRequestHash.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  ACQUIRER_FAILURE_RATE: "0",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

test("the fingerprint ignores the CVV and all but the last four digits", () => {
  const base = { amountFils: toFils(5_000), card: CARD, reference: "r-1" };
  const h = authorizeRequestHash(base);
  assert.equal(authorizeRequestHash({ ...base, card: { ...CARD, cvv: "999" } }), h, "CVV must not be in the hash");
  assert.equal(authorizeRequestHash({ ...base, card: { ...CARD, pan: "4111111111114242" } }), h, "only last4 is in the hash");
  assert.notEqual(authorizeRequestHash({ ...base, card: { ...CARD, pan: "4242424242424241" } }), h, "last4 differs");
  assert.notEqual(authorizeRequestHash({ ...base, amountFils: toFils(5_001) }), h);
  assert.notEqual(authorizeRequestHash({ ...base, card: { ...CARD, expiryYear: 2031 } }), h);
});

test("the stored request_hash is not a hash of the full card", async () => {
  const { merchantId, ownerUserId } = await createMerchant(pool, "card-hash");
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const key = await issueApiKey(pool, config, { merchantId, createdBy: ownerUserId, label: "card-hash" });
  const idem = randomUUID();
  const send = (card: typeof CARD) =>
    app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: { authorization: `Bearer ${key.rawKey}`, "idempotency-key": idem },
      payload: { amountFils: 5_000, card, reference: "r-1" },
    });

  const first = await send(CARD);
  assert.equal(first.statusCode, 201, first.body);

  const row = await pool.query<{ request_hash: string }>(
    `SELECT request_hash FROM idempotency_keys WHERE merchant_id = $1 AND key = $2`,
    [merchantId, idem],
  );
  const stored = row.rows[0]!.request_hash;
  // The old fingerprint, computed directly (hashRequest now refuses card data).
  const oldStyle = createHash("sha256").update(canonicalJson({ amountFils: 5_000, card: CARD, reference: "r-1" })).digest("hex");
  assert.notEqual(stored, oldStyle, "full PAN + CVV hash stored");

  // Idempotency still works: same request replays, a different card is refused.
  const replay = await send(CARD);
  assert.equal(replay.statusCode, 201);
  assert.deepEqual(replay.json(), first.json());
  const other = await send({ ...CARD, pan: "5555555555554444" });
  assert.equal(other.statusCode, 422, other.body);
});

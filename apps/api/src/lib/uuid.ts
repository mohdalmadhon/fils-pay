const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID in its one canonical spelling (lower-case, hyphenated), or null.
 *  Postgres also accepts upper case, braces and no hyphens for the same
 *  value; normalising first keeps comparisons, budgets and SQL inputs
 *  consistent, and keeps non-UUIDs out of queries (a 400, not a 500). */
export function canonicalUuid(raw: unknown): string | null {
  return typeof raw === "string" && CANONICAL_UUID.test(raw) ? raw.toLowerCase() : null;
}

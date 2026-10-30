import { canonicalUuid } from "./uuid.js";

/** A list cursor: Postgres's own text rendering of `created_at`, and the row id. */
export interface DecodedKeysetCursor {
  createdAt: string;
  id: string;
}

/**
 * Postgres's text rendering of a timestamptz, e.g.
 * `2026-10-30 20:17:17.123456+03` (a `T` separator and `+03:00` also pass).
 */
const PG_TIMESTAMPTZ_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;

function isPgTimestamptzText(value: string): boolean {
  const m = PG_TIMESTAMPTZ_RE.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Decodes a base64url `createdAt|id` cursor. Returns null for anything that
 * isn't one (not a string, no separator, a timestamp Postgres would refuse,
 * an id that isn't a UUID), so a bad cursor restarts at page one instead of
 * failing a `::timestamptz` or `::uuid` cast with a 500.
 */
export function decodeKeysetCursor(cursor: unknown): DecodedKeysetCursor | null {
  if (typeof cursor !== "string" || cursor === "") return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const separatorIndex = decoded.indexOf("|");
  if (separatorIndex === -1) return null;
  const createdAt = decoded.slice(0, separatorIndex);
  const id = canonicalUuid(decoded.slice(separatorIndex + 1));
  if (!id || !isPgTimestamptzText(createdAt)) return null;
  return { createdAt, id };
}

/** Encode from Postgres's own text rendering of `created_at`, never from
 *  `Date.toISOString()`, which drops the microseconds the keyset needs. */
export function encodeKeysetCursor(createdAtText: string, id: string): string {
  return Buffer.from(`${createdAtText}|${id}`, "utf8").toString("base64url");
}

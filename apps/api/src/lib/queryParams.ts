import { BadRequestError } from "./errors.js";

/**
 * `?limit=` as an integer, or undefined when absent; each route
 * still clamps it to its own range (0 and negatives become 1). Anything
 * else is a 400. Number.parseInt("abc") is NaN, and Math.max/Math.min pass NaN
 * through, so the list queries used to send LIMIT NaN to Postgres: a 500.
 */
export function parseLimitParam(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!/^-?\d{1,6}$/.test(raw)) {
    throw new BadRequestError("invalid_limit", "limit must be a whole number");
  }
  return Number(raw);
}

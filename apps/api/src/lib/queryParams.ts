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

/**
 * `?from=` / `?to=` given as an instant (ISO 8601). undefined when absent;
 * anything that is not one string with a real date is a 400. `new
 * Date("garbage")` is an Invalid Date, which reached Postgres as
 * "0NaN-NaN-..." and came back as a 500. docs/bugs/010.
 */
export function parseInstantParam(raw: unknown, name: string): Date | undefined {
  if (raw === undefined || raw === "") return undefined;
  const parsed = typeof raw === "string" ? new Date(raw) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError("invalid_date", `${name} must be an ISO 8601 date or date-time`);
  }
  return parsed;
}

/**
 * A business date, YYYY-MM-DD, that exists on the calendar. "2026-02-30"
 * is refused: JavaScript would roll it over to 2 March, but Postgres
 * rejects it (a 500). docs/bugs/010.
 */
export function parseBusinessDateParam(raw: unknown, name: string): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestError("invalid_date", `${name} must be a date as YYYY-MM-DD`);
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new BadRequestError("invalid_date", `${name} is not a real calendar date`);
  }
  return raw;
}

/**
 * True only for a `YYYY-MM-DD` string naming a day that exists. A regex plus
 * `Date.parse` is not enough: `Date.parse("2026-02-30")` is a number (JS rolls
 * it over to 2 March), but Postgres refuses `'2026-02-30'::date` with an
 * error, which used to surface as a 500.
 */
export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

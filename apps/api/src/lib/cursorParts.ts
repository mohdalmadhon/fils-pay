/**
 * Checks for the parts of a keyset page cursor, so a tampered cursor
 * restarts from the first page instead of reaching SQL (where a bad value
 * fails the ::timestamptz / ::date cast: a 500). Date.parse is not enough:
 * it accepts "2026-02-30" and rolls it over to 2 March. docs/bugs/011.
 */

/** YYYY-MM-DD that exists on the calendar. */
export function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** A timestamp as Postgres prints `timestamptz::text` (or ISO 8601), with
 *  a real calendar date and a real time of day. */
export function isTimestampText(text: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/.exec(text);
  if (!m) return false;
  return isCalendarDate(m[1]!) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 60;
}

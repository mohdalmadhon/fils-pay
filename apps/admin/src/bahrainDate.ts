/**
 * Business dates in Asia/Bahrain, which is UTC+3 all year (no daylight
 * saving). Works the same in any browser time zone: shift the instant by
 * three hours, then read the UTC calendar date.
 */
const BAHRAIN_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's Bahrain date as YYYY-MM-DD. */
export function bahrainToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BAHRAIN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Yesterday's Bahrain date as YYYY-MM-DD. */
export function bahrainYesterday(now: Date = new Date()): string {
  return new Date(now.getTime() + BAHRAIN_OFFSET_MS - DAY_MS).toISOString().slice(0, 10);
}

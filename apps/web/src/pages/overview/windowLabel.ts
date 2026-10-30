/**
 * Words for the date window the overview asked for. The label used to count
 * the days that had data ("in the last 3 days" when only three days had
 * captures), which says nothing about the window. These follow the analytics
 * API's own rules (apps/api/src/routes/analytics.ts parseDateRange): dates
 * are Bahrain business dates, `to` is exclusive, and a blank `from` means
 * 30 days before today, a blank `to` means "through today".
 */

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date in Asia/Bahrain (UTC+3). */
export function bahrainToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** e.g. "in the last 30 days and today", "from 2026-09-01 to 2026-09-30". */
export function windowLabel(from: string, to: string, now: Date = new Date()): string {
  if (!from && !to) return "in the last 30 days and today";
  const today = bahrainToday(now);
  const start = from || addDays(today, -30);
  if (!to) return `since ${start}`;
  const lastDay = addDays(to, -1);
  if (lastDay === start) return `on ${start}`;
  return `from ${start} to ${lastDay}`;
}

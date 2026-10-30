/** How long ago, in plain words: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function relativeAge(asOf: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - asOf.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * "Data as of 30 Oct 2026, 14:05 (5 min ago)". The badge used to show only
 * the time, so data from yesterday at 14:05 looked like data from today.
 * `locale` and `timeZone` default to the browser's; tests pin them.
 */
export function stalenessText(
  readModelAsOf: string,
  now: Date = new Date(),
  options: { locale?: string; timeZone?: string } = {},
): string {
  const asOf = new Date(readModelAsOf);
  const when = asOf.toLocaleString(options.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: options.timeZone,
  });
  return `Data as of ${when} (${relativeAge(asOf, now)})`;
}

/** Weekly series calendar: windows run Monday 00:00 UTC to the next Monday 00:00 UTC (168 hourly epochs). */

export const WEEK = 7n * 24n * 3600n;
export const HOURS_PER_WEEK = 168n;
/** 1970-01-01 was a Thursday; Mondays are 4 days later in the weekly cycle. */
const MONDAY_OFFSET = 4n * 24n * 3600n;

/** ISO-8601 week number and year of a Monday 00:00 UTC timestamp. */
export function isoWeek(mondayTs: bigint): { year: number; week: number } {
  const d = new Date(Number(mondayTs) * 1000);
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
  return { year, week };
}

/** The next `count` Monday 00:00 UTC timestamps strictly after `now`. */
export function upcomingMondays(now: bigint, count: number): bigint[] {
  const thisMonday = ((now - MONDAY_OFFSET) / WEEK) * WEEK + MONDAY_OFFSET;
  return Array.from({ length: count }, (_, i) => thisMonday + WEEK * BigInt(i + 1));
}

// Which exchange rate a business day snapshots (spec 7.2 and 7.3).
//
// One rule for every way a day is opened (by hand, back-dated, or by a POS
// import): the rate in force at the end of that business date in the venue's
// time zone, or now if that's earlier. So today's day takes the current rate,
// a back-dated day takes the rate that applied on its own date, and a rate set
// later never reaches a day that already exists.
//
// If no rate had been set by then (a business importing history from before
// it started using the app), the earliest rate is used and the caller is told,
// so it can say so on screen.

/** Milliseconds the zone's wall clock is ahead of UTC at an instant. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The last instant of a business date (23:59:59.999 local time) in a time zone. */
export function endOfBusinessDate(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  // Two passes settle the offset even on a daylight-saving changeover day.
  let instant = wall - zoneOffsetMs(new Date(wall), timeZone);
  instant = wall - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export type RateChoice<T> = { rate: T; /** No rate was in force yet; the earliest one was used. */ fallback: boolean };

export function pickRateForDate<T extends { effectiveAt: Date; createdAt: Date }>(
  rates: T[],
  date: string,
  timeZone: string,
  now: Date = new Date(),
): RateChoice<T> | null {
  if (rates.length === 0) return null;
  const sorted = [...rates].sort(
    (a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const end = endOfBusinessDate(date, timeZone);
  const cutoff = end < now ? end : now;
  const inEffect = sorted.filter((r) => r.effectiveAt <= cutoff).at(-1);
  return inEffect ? { rate: inEffect, fallback: false } : { rate: sorted[0], fallback: true };
}

// "Policy autonomy" plan, item 3: outside an account's own business
// hours, nobody is watching to catch an automation mistake in the
// moment. Lets an API key configure a quiet-hours window (a local hour
// range, in its own timezone) where an action that would otherwise
// auto-resolve escalates for real review instead -- automation stays
// extra careful exactly when nobody could catch a mistake quickly.
//
// Deliberately narrow: only the auto-resolve step is affected. The
// deterministic gate layers (hard rules, safety scanner, spend cap) run
// exactly as they always do, quiet hours or not.

export type QuietHoursConfig = {
  /** Local hour (0-23, in `timezone`) quiet hours begin. */
  startHour: number;
  /** Local hour (0-23, in `timezone`) quiet hours end (exclusive). */
  endHour: number;
  /** IANA timezone, e.g. "America/New_York". */
  timezone: string;
};

/**
 * Pure -- the local hour (0-23) `now` falls on in the given IANA
 * timezone. Falls back to `now`'s own UTC hour if the timezone string
 * is invalid or unsupported, rather than throwing -- a bad timezone
 * string must never itself become the reason a real decision fails.
 */
export function localHourIn(now: Date, timezone: string): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(now);
    const hour = Number(formatted);
    // Some engines format midnight as "24" under hour12:false -- normalize
    // to the real 0-23 range rather than leaving an out-of-range value.
    return Number.isFinite(hour) ? hour % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

/**
 * Pure -- is `now` inside the configured quiet-hours window? Handles a
 * window that wraps past midnight (e.g. 22 -> 6) the same as one that
 * doesn't (e.g. 1 -> 5). A `null` config (nothing configured) is never
 * quiet hours. `startHour === endHour` means "quiet all day" -- the
 * least surprising reading of a caller configuring identical bounds,
 * not a zero-length window.
 */
export function isWithinQuietHours(now: Date, config: QuietHoursConfig | null): boolean {
  if (!config) return false;
  const hour = localHourIn(now, config.timezone);
  const { startHour, endHour } = config;
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export function summarizeQuietHoursEscalation(config: QuietHoursConfig): string {
  return (
    `Resolved to escalate for human review: this API key is inside its own configured quiet hours ` +
    `(${config.startHour}:00–${config.endHour}:00 ${config.timezone}) -- this would otherwise have auto-resolved, but ` +
    `automation stays more cautious during hours nobody's likely watching.`
  );
}

// Real tests for item 3's quiet-hours classification.
//
// Run with: deno test --allow-none supabase/functions/_shared/quiet-hours_test.ts
import { localHourIn, isWithinQuietHours, summarizeQuietHoursEscalation, type QuietHoursConfig } from "./quiet-hours.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- localHourIn ----

Deno.test("localHourIn: UTC noon is hour 12 in UTC", () => {
  assertEquals(localHourIn(new Date("2026-08-29T12:00:00Z"), "UTC"), 12);
});

Deno.test("localHourIn: converts into a real named timezone", () => {
  // 2026-08-29T12:00:00Z is 08:00 in America/New_York (EDT, UTC-4) in August.
  assertEquals(localHourIn(new Date("2026-08-29T12:00:00Z"), "America/New_York"), 8);
});

Deno.test("localHourIn: an invalid timezone string falls back to the UTC hour, never throws", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  assertEquals(localHourIn(now, "Not/A_Real_Zone"), now.getUTCHours());
});

// ---- isWithinQuietHours ----

const cfg = (over: Partial<QuietHoursConfig> = {}): QuietHoursConfig => ({ startHour: 22, endHour: 6, timezone: "UTC", ...over });

Deno.test("isWithinQuietHours: null config is never quiet hours", () => {
  assertFalse(isWithinQuietHours(new Date("2026-08-29T23:00:00Z"), null));
});

Deno.test("isWithinQuietHours: a same-day window (e.g. 1-5) matches inside, not outside", () => {
  const c = cfg({ startHour: 1, endHour: 5 });
  assert(isWithinQuietHours(new Date("2026-08-29T03:00:00Z"), c));
  assertFalse(isWithinQuietHours(new Date("2026-08-29T06:00:00Z"), c));
  assertFalse(isWithinQuietHours(new Date("2026-08-29T00:59:00Z"), c));
});

Deno.test("isWithinQuietHours: a midnight-wrapping window (22-6) matches late night AND early morning", () => {
  const c = cfg({ startHour: 22, endHour: 6 });
  assert(isWithinQuietHours(new Date("2026-08-29T23:00:00Z"), c), "23:00 must be inside a 22-6 window");
  assert(isWithinQuietHours(new Date("2026-08-29T02:00:00Z"), c), "02:00 must be inside a 22-6 window");
  assertFalse(isWithinQuietHours(new Date("2026-08-29T12:00:00Z"), c), "noon must be outside a 22-6 window");
});

Deno.test("isWithinQuietHours: the end hour itself is exclusive (the window has already ended)", () => {
  const c = cfg({ startHour: 22, endHour: 6 });
  assertFalse(isWithinQuietHours(new Date("2026-08-29T06:00:00Z"), c));
});

Deno.test("isWithinQuietHours: identical start and end hour means quiet all day", () => {
  const c = cfg({ startHour: 9, endHour: 9 });
  assert(isWithinQuietHours(new Date("2026-08-29T09:00:00Z"), c));
  assert(isWithinQuietHours(new Date("2026-08-29T23:00:00Z"), c));
  assert(isWithinQuietHours(new Date("2026-08-29T00:00:00Z"), c));
});

// ---- summarizeQuietHoursEscalation ----

Deno.test("summarizeQuietHoursEscalation: names the configured window and timezone", () => {
  const msg = summarizeQuietHoursEscalation(cfg({ startHour: 22, endHour: 6, timezone: "America/New_York" }));
  assert(msg.includes("22:00"));
  assert(msg.includes("6:00"));
  assert(msg.includes("America/New_York"));
  assert(msg.toLowerCase().includes("escalate"));
});

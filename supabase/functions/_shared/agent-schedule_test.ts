// Run with: deno test --allow-none supabase/functions/_shared/agent-schedule_test.ts
import { deriveCronLabel, nextRunFromCron } from "./agent-schedule.ts";

function assertEq<T>(actual: T, expected: T, msg = ""): void {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("deriveCronLabel: every-N-minutes shape", () => {
  assertEq(deriveCronLabel("*/10 * * * *"), "Every 10 minutes");
});

Deno.test("deriveCronLabel: daily-at-time shape", () => {
  assertEq(deriveCronLabel("0 8 * * *"), "Daily at 08:00 UTC");
  assertEq(deriveCronLabel("30 7 * * *"), "Daily at 07:30 UTC");
});

Deno.test("deriveCronLabel: every-N-hours shape", () => {
  assertEq(deriveCronLabel("0 */6 * * *"), "Every 6 hours");
});

Deno.test("deriveCronLabel: weekly/unrecognized shapes return null rather than a wrong label", () => {
  assertEq(deriveCronLabel("0 8 * * 1"), null);
  assertEq(deriveCronLabel("not a cron at all"), null);
});

Deno.test("nextRunFromCron: every-N-minutes advances from the given 'now'", () => {
  const now = new Date("2026-09-19T02:00:00.000Z");
  assertEq(nextRunFromCron("*/10 * * * *", now), "2026-09-19T02:10:00.000Z");
});

Deno.test("nextRunFromCron: daily-at-time rolls to tomorrow if today's slot already passed", () => {
  const now = new Date("2026-09-19T10:00:00.000Z");
  assertEq(nextRunFromCron("0 8 * * *", now), "2026-09-20T08:00:00.000Z");
});

Deno.test("nextRunFromCron: daily-at-time stays today if the slot hasn't passed yet", () => {
  const now = new Date("2026-09-19T02:00:00.000Z");
  assertEq(nextRunFromCron("0 8 * * *", now), "2026-09-19T08:00:00.000Z");
});

Deno.test("nextRunFromCron: every-N-hours advances from the given 'now'", () => {
  const now = new Date("2026-09-19T02:00:00.000Z");
  assertEq(nextRunFromCron("0 */6 * * *", now), "2026-09-19T08:00:00.000Z");
});

Deno.test("nextRunFromCron: an unrecognized shape degrades safely to +1 hour, never crashes", () => {
  const now = new Date("2026-09-19T02:00:00.000Z");
  assertEq(nextRunFromCron("0 8 * * 1", now), "2026-09-19T03:00:00.000Z");
});

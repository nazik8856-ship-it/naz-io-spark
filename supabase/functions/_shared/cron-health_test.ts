// Real tests for cron-health-check's pure classification logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/cron-health_test.ts
import { findUnhealthyJobs, jobsNeedingNewIncident, summarizeUnhealthyJob, type JobRequestOutcome } from "./cron-health.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("findUnhealthyJobs: a 200 response is healthy", () => {
  const outcomes: JobRequestOutcome[] = [{ jobName: "retention-sweep-daily", requestId: 1, statusCode: 200, timedOut: false }];
  assertEquals(findUnhealthyJobs(outcomes), []);
});

Deno.test("findUnhealthyJobs: a 401 response is unhealthy (the exact bug this closes)", () => {
  const outcomes: JobRequestOutcome[] = [{ jobName: "retention-sweep-daily", requestId: 1, statusCode: 401, timedOut: false }];
  assertEquals(findUnhealthyJobs(outcomes), [{ jobName: "retention-sweep-daily", requestId: 1, reason: "non_2xx" }]);
});

Deno.test("findUnhealthyJobs: a timed-out request is unhealthy regardless of status_code", () => {
  const outcomes: JobRequestOutcome[] = [{ jobName: "control-self-audit-weekly", requestId: 1, statusCode: null, timedOut: true }];
  assertEquals(findUnhealthyJobs(outcomes), [{ jobName: "control-self-audit-weekly", requestId: 1, reason: "timed_out" }]);
});

Deno.test("findUnhealthyJobs: a null status with no timeout flag is treated as no_response", () => {
  const outcomes: JobRequestOutcome[] = [{ jobName: "governance-backup-export-daily", requestId: 1, statusCode: null, timedOut: false }];
  assertEquals(findUnhealthyJobs(outcomes), [{ jobName: "governance-backup-export-daily", requestId: 1, reason: "no_response" }]);
});

Deno.test("findUnhealthyJobs: 2xx boundary -- 299 healthy, 300 not", () => {
  const outcomes: JobRequestOutcome[] = [
    { jobName: "a", requestId: 1, statusCode: 299, timedOut: false },
    { jobName: "b", requestId: 2, statusCode: 300, timedOut: false },
  ];
  assertEquals(findUnhealthyJobs(outcomes), [{ jobName: "b", requestId: 2, reason: "non_2xx" }]);
});

Deno.test("findUnhealthyJobs: only the latest request per job determines health", () => {
  const outcomes: JobRequestOutcome[] = [
    { jobName: "retention-sweep-daily", requestId: 1, statusCode: 401, timedOut: false },
    { jobName: "retention-sweep-daily", requestId: 2, statusCode: 200, timedOut: false },
  ];
  // The older failure (request 1) is superseded by the newer success (request 2).
  assertEquals(findUnhealthyJobs(outcomes), []);
});

Deno.test("findUnhealthyJobs: latest-per-job also applies when the newest run is the failure", () => {
  const outcomes: JobRequestOutcome[] = [
    { jobName: "retention-sweep-daily", requestId: 1, statusCode: 200, timedOut: false },
    { jobName: "retention-sweep-daily", requestId: 2, statusCode: 500, timedOut: false },
  ];
  assertEquals(findUnhealthyJobs(outcomes), [{ jobName: "retention-sweep-daily", requestId: 2, reason: "non_2xx" }]);
});

Deno.test("findUnhealthyJobs: results are sorted by job name for stable output", () => {
  const outcomes: JobRequestOutcome[] = [
    { jobName: "z-job", requestId: 1, statusCode: 500, timedOut: false },
    { jobName: "a-job", requestId: 2, statusCode: 500, timedOut: false },
  ];
  assertEquals(findUnhealthyJobs(outcomes).map((u) => u.jobName), ["a-job", "z-job"]);
});

Deno.test("jobsNeedingNewIncident: skips jobs that already have an open incident", () => {
  const unhealthy = [
    { jobName: "retention-sweep-daily", requestId: 1, reason: "non_2xx" as const },
    { jobName: "control-self-audit-weekly", requestId: 2, reason: "timed_out" as const },
  ];
  assertEquals(jobsNeedingNewIncident(unhealthy, ["retention-sweep-daily"]), [
    { jobName: "control-self-audit-weekly", requestId: 2, reason: "timed_out" },
  ]);
});

Deno.test("jobsNeedingNewIncident: empty open list means every unhealthy job needs one", () => {
  const unhealthy = [{ jobName: "x", requestId: 1, reason: "non_2xx" as const }];
  assertEquals(jobsNeedingNewIncident(unhealthy, []), unhealthy);
});

Deno.test("summarizeUnhealthyJob: produces a distinct, readable message per reason", () => {
  const timedOut = summarizeUnhealthyJob({ jobName: "j", requestId: 1, reason: "timed_out" });
  const noResp = summarizeUnhealthyJob({ jobName: "j", requestId: 1, reason: "no_response" });
  const non2xx = summarizeUnhealthyJob({ jobName: "j", requestId: 1, reason: "non_2xx" });
  assertEquals(timedOut.includes("timed out"), true);
  assertEquals(noResp.includes("no HTTP response"), true);
  assertEquals(non2xx.includes("non-success"), true);
  // All three must actually differ from each other.
  assertEquals(new Set([timedOut, noResp, non2xx]).size, 3);
});

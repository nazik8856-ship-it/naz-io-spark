// Pure classification for cron-health-check: given recent scheduled-job
// HTTP requests and their responses, decide which jobs are unhealthy and
// need an incident opened. No DB/HTTP dependency so this is fully unit
// testable — the actual DB join (scheduled_job_requests <-> net._http_response)
// happens in the edge function, which maps rows into this shape first.

export type JobRequestOutcome = {
  jobName: string;
  requestId: number;
  statusCode: number | null;
  timedOut: boolean;
};

export type UnhealthyJob = {
  jobName: string;
  requestId: number;
  reason: "non_2xx" | "timed_out" | "no_response";
};

function isHealthy(o: JobRequestOutcome): boolean {
  if (o.timedOut) return false;
  if (o.statusCode == null) return false;
  return o.statusCode >= 200 && o.statusCode < 300;
}

function reasonFor(o: JobRequestOutcome): UnhealthyJob["reason"] {
  if (o.timedOut) return "timed_out";
  if (o.statusCode == null) return "no_response";
  return "non_2xx";
}

/**
 * Classify each request outcome, then dedupe to the most recent outcome per
 * job (a job can have multiple recent runs in the lookback window — only
 * its latest result determines current health, so one still-recovering job
 * doesn't reopen an incident for an older failure that's since cleared).
 */
export function findUnhealthyJobs(outcomes: JobRequestOutcome[]): UnhealthyJob[] {
  const latestByJob = new Map<string, JobRequestOutcome>();
  for (const o of outcomes) {
    const prev = latestByJob.get(o.jobName);
    if (!prev || o.requestId > prev.requestId) latestByJob.set(o.jobName, o);
  }
  const unhealthy: UnhealthyJob[] = [];
  for (const o of latestByJob.values()) {
    if (!isHealthy(o)) unhealthy.push({ jobName: o.jobName, requestId: o.requestId, reason: reasonFor(o) });
  }
  return unhealthy.sort((a, b) => a.jobName.localeCompare(b.jobName));
}

/**
 * Which unhealthy jobs actually need a NEW incident opened — skips any job
 * that already has an unresolved platform_incidents row, so a job stuck
 * failing for hours doesn't spam a fresh incident on every health-check run.
 */
export function jobsNeedingNewIncident(unhealthy: UnhealthyJob[], openIncidentJobNames: readonly string[]): UnhealthyJob[] {
  const open = new Set(openIncidentJobNames);
  return unhealthy.filter((u) => !open.has(u.jobName));
}

export function summarizeUnhealthyJob(u: UnhealthyJob): string {
  switch (u.reason) {
    case "timed_out":
      return `Scheduled job "${u.jobName}" timed out on its last run (request ${u.requestId}).`;
    case "no_response":
      return `Scheduled job "${u.jobName}" produced no HTTP response for its last run (request ${u.requestId}) — the request may still be pending or was lost.`;
    case "non_2xx":
      return `Scheduled job "${u.jobName}" got a non-success HTTP response on its last run (request ${u.requestId}).`;
  }
}

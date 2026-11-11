// cron-health-check returned 500 on most runs because scheduled_job_requests (1.1 million rows, never purged) was scanned in full for a
// 90-minute lookback. These checks keep the fix in place: an index on created_at, a retention job that keeps each job's newest row,
// a purge nobody but the scheduler can call, and a function that logs and retries instead of failing on one slow call.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const sql = readFileSync(join(ROOT, "supabase/migrations/20261115010000_cron_health_index_and_retention.sql"), "utf8");
const fn = readFileSync(join(ROOT, "supabase/functions/cron-health-check/index.ts"), "utf8");

describe("scheduled_job_requests stays small and fast", () => {
  it("has an index that starts with created_at, for the health check's time range", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_scheduled_job_requests_created ON public\.scheduled_job_requests \(created_at DESC\)/);
  });

  it("purges only rows older than the cutoff, only for jobs that have a newer row (so a job's last run is never lost), in batches", () => {
    expect(sql).toContain("created_at < cutoff");
    expect(sql).toContain("job_name IN (SELECT job_name FROM recent_jobs)");
    expect(sql).toContain("created_at >= cutoff");
    expect(sql).toMatch(/LIMIT greatest\(_batch, 1\)/);
    expect(sql).toMatch(/_keep interval DEFAULT interval '7 days'/);
  });

  it("can be called by nobody but the database's own scheduler", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.purge_scheduled_job_requests\(interval, integer\) FROM PUBLIC, anon, authenticated, service_role/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.purge_scheduled_job_requests/);
    expect(sql).toMatch(/cron\.schedule\('scheduled-job-requests-purge-hourly', '17 \* \* \* \*'/);
  });

  it("deletes nothing else", () => {
    expect((sql.match(/DELETE FROM/g) ?? []).length).toBe(1);
    expect(sql).toContain("DELETE FROM public.scheduled_job_requests t USING doomed d");
  });
});

describe("cron-health-check", () => {
  it("logs the reason and asks the database once more before answering 500", () => {
    expect(fn).toContain("get_job_health_outcomes failed, retrying once");
    expect(fn).toContain("get_job_health_outcomes failed again");
    expect((fn.match(/admin\.rpc\("get_job_health_outcomes"/g) ?? []).length).toBe(2);
    expect(fn).toMatch(/if \(rpcErr\) \{[\s\S]{0,400}return json\(\{ error: rpcErr\.message \}, 500\);/);
  });
});

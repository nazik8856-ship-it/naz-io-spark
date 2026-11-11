-- cron-health-check returned 500 on most runs (docs: none; found 2026-11-11).
--
-- Cause: get_job_health_outcomes() reads the last 90 minutes of scheduled_job_requests, but the only index that helps starts with
-- job_name, so the range on created_at scanned the whole index. The table had grown to 1.1 million rows (155 MB) because nothing ever
-- deleted from it (80% of them from the email queue job that runs every 5 seconds). With a cold cache the query took about 9 seconds,
-- past the database call's time limit, and the function answered 500.
--
-- Fix, in two parts:
--   1. An index on created_at alone, so "the last 90 minutes" reads about 1,300 rows.
--   2. A retention job. Rows older than 7 days are deleted in batches, except that a job's newest row is always kept, so "when did this
--      job last run" still works for a job that runs rarely (a monthly one). Nothing reads rows older than the health-check window.

CREATE INDEX IF NOT EXISTS idx_scheduled_job_requests_created ON public.scheduled_job_requests (created_at DESC);

-- Deletes one batch of old rows. Returns how many were deleted (0 when nothing is left to delete). Only the database's own scheduler
-- calls it: nobody else may.
CREATE OR REPLACE FUNCTION public.purge_scheduled_job_requests(_keep interval DEFAULT interval '7 days', _batch integer DEFAULT 150000)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE cutoff timestamptz := now() - _keep; n integer;
BEGIN
  -- Only jobs that have a row newer than the cutoff are purged: a job with nothing recent keeps all of its rows (its newest one is its
  -- "last run"). Inside a purged job the newest row is recent by definition, so it is never selected.
  WITH recent_jobs AS (
    SELECT DISTINCT job_name FROM public.scheduled_job_requests WHERE created_at >= cutoff
  ), doomed AS (
    SELECT s.id FROM public.scheduled_job_requests s
    WHERE s.created_at < cutoff AND s.job_name IN (SELECT job_name FROM recent_jobs)
    ORDER BY s.created_at
    LIMIT greatest(_batch, 1)
  )
  DELETE FROM public.scheduled_job_requests t USING doomed d WHERE t.id = d.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.purge_scheduled_job_requests(interval, integer) FROM PUBLIC, anon, authenticated, service_role;

-- Hourly. The first runs clear the backlog (about 150,000 rows an hour), then each run removes a day's worth.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  PERFORM cron.schedule('scheduled-job-requests-purge-hourly', '17 * * * *', 'SELECT public.purge_scheduled_job_requests()');
END $$;

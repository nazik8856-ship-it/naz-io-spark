-- Scheduled-job health monitoring: closes the exact blind spot that hid the
-- cron-auth vault-secret mismatch -- pg_cron's own job_run_details reports
-- "succeeded" as soon as net.http_post() queues the request, regardless of
-- the actual HTTP response. This tracks each job's request_id and checks
-- the real response.

CREATE TABLE public.scheduled_job_requests (
  id bigint generated always as identity primary key,
  job_name text not null,
  request_id bigint not null,
  created_at timestamptz not null default now()
);
CREATE INDEX idx_scheduled_job_requests_job_created ON public.scheduled_job_requests (job_name, created_at desc);
GRANT ALL ON public.scheduled_job_requests TO service_role;
ALTER TABLE public.scheduled_job_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform staff can view scheduled job requests" ON public.scheduled_job_requests
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));

-- Platform-level incidents (NazAI's own operational jobs, not scoped to a
-- customer account) -- deliberately separate from the customer-scoped
-- `incidents` table, visible only to platform staff (the pre-existing
-- global admin/owner role system), same as it already gates cross-account
-- staff actions elsewhere.
CREATE TABLE public.platform_incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  summary text not null,
  detail jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
GRANT ALL ON public.platform_incidents TO service_role;
GRANT SELECT, UPDATE ON public.platform_incidents TO authenticated;
ALTER TABLE public.platform_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform staff can view platform incidents" ON public.platform_incidents
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Platform staff can resolve platform incidents" ON public.platform_incidents
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));

-- net._http_response lives in the `net` schema, not exposed to PostgREST --
-- this does the join server-side so cron-health-check can call it as a
-- normal RPC. Service-role only (the edge function's admin client).
CREATE OR REPLACE FUNCTION public.get_job_health_outcomes(_since timestamptz)
RETURNS TABLE(job_name text, request_id bigint, status_code int, timed_out boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sjr.job_name, sjr.request_id, r.status_code, r.timed_out
  FROM public.scheduled_job_requests sjr
  LEFT JOIN net._http_response r ON r.id = sjr.request_id
  WHERE sjr.created_at >= _since
  ORDER BY sjr.request_id DESC;
$$;
REVOKE ALL ON FUNCTION public.get_job_health_outcomes(timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_job_health_outcomes(timestamptz) TO service_role;

-- Re-point the 6 previously-broken cron jobs to also log their request_id.
-- Application logic is unchanged (same URL, same headers, same body) --
-- this only wraps the net.http_post() call in an INSERT so cron-health-
-- check has something to join against. Uses cron.alter_job so job history
-- and job_id are preserved rather than dropping and recreating.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'retention-sweep-daily'),
  command := $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'retention-sweep-daily', net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/retention-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'control-digest-email-daily'),
  command := $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'control-digest-email-daily', net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/control-digest-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'control-self-audit-weekly'),
  command := $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'control-self-audit-weekly', net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/control-self-audit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'control-weekly-trend-email-mondays'),
  command := $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'control-weekly-trend-email-mondays', net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/control-weekly-trend-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'approval-escalation-sweep-30min'),
  command := $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'approval-escalation-sweep-30min', net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/approval-escalation-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'governance-backup-export-daily'),
  command := $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'governance-backup-export-daily', net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/governance-backup-export',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- The health-check job itself, every 30 minutes. Not self-tracked (it
-- would need to track itself, which is circular) -- if this job stops
-- firing entirely, that's a pg_cron-level failure outside what this
-- mechanism can detect, same limitation every monitoring job has.
SELECT cron.schedule(
  'cron-health-check-every-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/cron-health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

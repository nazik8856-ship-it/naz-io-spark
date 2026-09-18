-- agent-scheduler was fully built (polls agents.next_run_at and
-- agent_runs.scheduled_for, dispatches due work to agent-runtime) but never
-- had a cron job triggering it -- every other sweep in this codebase is
-- wired via cron.schedule, this one alone was left unattached. Users could
-- pick a schedule, see a confident "next run" timestamp, and the agent would
-- simply never fire. The function's own header comment documents the
-- original intent ("Called by pg_cron every minute"), so this restores that.
SELECT cron.schedule(
  'agent-scheduler-every-minute',
  '* * * * *',
  $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'agent-scheduler-every-minute', net.http_post(
    url := 'https://ekuodpaaiugzywfcmjeo.supabase.co/functions/v1/agent-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- process-email-queue was fully built (drains auth_emails/transactional_emails,
-- handles retries/backoff/DLQ) but, unlike every other sweep in this codebase,
-- never had a cron job triggering it -- the original email-infra migration
-- documents the intent ("Creates job 'process-email-queue' with a 5-second
-- interval") as a step meant to be applied dynamically at scaffold time, but
-- that step never actually ran: cron.job has no entry for it. Until this,
-- every email send-transactional-email enqueued just sat in the queue forever.
--
-- pg_cron's native schedule syntax has no sub-minute granularity, so a 5s
-- interval is done the standard way: a once-a-minute job whose body loops
-- 12 times (60s / 5s) with pg_sleep(5) between each call. To revert:
--   SELECT cron.unschedule('process-email-queue-every-5s');
SELECT cron.schedule(
  'process-email-queue-every-5s',
  '* * * * *',
  $cron$
  DO $body$
  DECLARE
    i INT;
  BEGIN
    FOR i IN 1..12 LOOP
      INSERT INTO public.scheduled_job_requests (job_name, request_id)
      SELECT 'process-email-queue-every-5s', net.http_post(
        url := 'https://ekuodpaaiugzywfcmjeo.supabase.co/functions/v1/process-email-queue',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
        ),
        body := '{}'::jsonb
      );
      IF i < 12 THEN
        PERFORM pg_sleep(5);
      END IF;
    END LOOP;
  END;
  $body$;
  $cron$
);

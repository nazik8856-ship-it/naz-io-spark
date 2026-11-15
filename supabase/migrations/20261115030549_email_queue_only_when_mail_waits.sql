-- Quota: the email queue was the biggest user of edge-function calls. Its cron job (process-email-queue-every-5s, 20260918050000)
-- called the function 12 times a minute whether or not any mail was waiting: about 17,300 calls a day, 518,000 a month, on a Free
-- plan that includes 500,000 calls a month for everything.
--
-- Now each of the 12 ticks first asks the database whether any message is ready to send, and only then calls the function.
-- With an empty queue that is zero calls (the ticks stay inside the database); when mail waits, delivery is as quick as before
-- (every 5 seconds), because the next tick still finds it. A message that is waiting out its retry delay is not "ready" until the
-- delay is over, and nothing is called while the provider has asked us to wait (email_send_state.retry_after_until).
--
-- The job keeps its name, so the health check (cron-health-check) still follows its requests. It only judges requests that were
-- made, so a quiet queue is not a failure. To revert: re-run 20260918050000_process_email_queue_cron.sql.

CREATE OR REPLACE FUNCTION public.email_queue_has_ready()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pgmq
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.email_send_state WHERE retry_after_until IS NOT NULL AND retry_after_until > now()) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM pgmq.q_auth_emails WHERE vt <= now())
      OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails WHERE vt <= now());
EXCEPTION WHEN undefined_table THEN
  -- A queue that does not exist yet: let the function run, it creates it and reports what is wrong.
  RETURN true;
END;
$$;

-- Only the scheduler (the database owner) asks. Nobody who signs in, and nobody who does not, can call it.
REVOKE ALL ON FUNCTION public.email_queue_has_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_has_ready() TO service_role;

SELECT cron.schedule(
  'process-email-queue-every-5s',
  '* * * * *',
  $cron$
  DO $body$
  DECLARE
    i INT;
  BEGIN
    FOR i IN 1..12 LOOP
      IF public.email_queue_has_ready() THEN
        INSERT INTO public.scheduled_job_requests (job_name, request_id)
        SELECT 'process-email-queue-every-5s', net.http_post(
          url := 'https://ekuodpaaiugzywfcmjeo.supabase.co/functions/v1/process-email-queue',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
          ),
          body := '{}'::jsonb
        );
      END IF;
      IF i < 12 THEN
        PERFORM pg_sleep(5);
      END IF;
    END LOOP;
  END;
  $body$;
  $cron$
);

-- Quota: 20261115030549 email_queue_has_ready() and the cron job that uses it. An empty queue makes no edge-function call;
-- a waiting message makes one per tick; a message waiting out its retry delay, or a provider cool-down, makes none.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

-- stand-ins for what the live project has: the queues, the HTTP call, the scheduler
CREATE SCHEMA IF NOT EXISTS pgmq;
CREATE TABLE IF NOT EXISTS pgmq.q_auth_emails (msg_id bigserial PRIMARY KEY, vt timestamptz NOT NULL DEFAULT now(), message jsonb);
CREATE TABLE IF NOT EXISTS pgmq.q_transactional_emails (msg_id bigserial PRIMARY KEY, vt timestamptz NOT NULL DEFAULT now(), message jsonb);
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net.calls (n bigserial PRIMARY KEY);
CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}') RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls DEFAULT VALUES RETURNING n $$;
DELETE FROM vault.secrets WHERE name = 'email_queue_service_role_key';
INSERT INTO vault.secrets (name, secret) VALUES ('email_queue_service_role_key', 'test-key');
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job VALUES (job_name, schedule, command) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING 1::bigint $$;
CREATE TABLE IF NOT EXISTS public.scheduled_job_requests (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_name text NOT NULL, request_id bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.email_send_state (id int PRIMARY KEY DEFAULT 1, retry_after_until timestamptz);
INSERT INTO public.email_send_state (id) VALUES (1) ON CONFLICT DO NOTHING;
UPDATE public.email_send_state SET retry_after_until = NULL;

\ir ../../migrations/20261115030549_email_queue_only_when_mail_waits.sql
\ir ../../migrations/20261115030549_email_queue_only_when_mail_waits.sql

-- the job: same name and schedule, the 12 ticks stay (a sleep of 0 here so the test does not wait a minute)
SELECT pg_temp.check((SELECT count(*) FROM cron.job WHERE jobname = 'process-email-queue-every-5s') = 1 AND (SELECT schedule FROM cron.job WHERE jobname = 'process-email-queue-every-5s') = '* * * * *', 'one job, still every minute, still under its old name');
SELECT pg_temp.check((SELECT command FROM cron.job WHERE jobname = 'process-email-queue-every-5s') LIKE '%FOR i IN 1..12 LOOP%', 'still 12 ticks a minute');
-- cron.job.command is "DO $body$ ... $body$;": run it as the DO statement it is
CREATE OR REPLACE FUNCTION pg_temp.minute() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE cmd text; before bigint;
BEGIN
  SELECT regexp_replace(command, 'pg_sleep\(5\)', 'pg_sleep(0)', 'g') INTO cmd FROM cron.job WHERE jobname = 'process-email-queue-every-5s';
  SELECT count(*) INTO before FROM net.calls;
  EXECUTE cmd;
  RETURN (SELECT count(*) FROM net.calls) - before;
END $$;

-- 1. an empty queue: no call at all
DELETE FROM pgmq.q_auth_emails; DELETE FROM pgmq.q_transactional_emails;
SELECT pg_temp.check(NOT public.email_queue_has_ready(), 'an empty queue has nothing ready');
SELECT pg_temp.check(pg_temp.minute() = 0, 'an empty queue makes no edge-function call in a whole minute');

-- 2. one waiting message: a call on every tick, so delivery stays quick
INSERT INTO pgmq.q_transactional_emails (message) VALUES ('{"to":"a@b.c"}');
SELECT pg_temp.check(public.email_queue_has_ready(), 'a waiting message is ready');
SELECT pg_temp.check(pg_temp.minute() = 12, 'a waiting message makes one call per tick (12 a minute), as before');
DELETE FROM pgmq.q_transactional_emails;
INSERT INTO pgmq.q_auth_emails (message) VALUES ('{"to":"a@b.c"}');
SELECT pg_temp.check(public.email_queue_has_ready(), 'the sign-in queue counts too');

-- 3. a message waiting out its retry delay is not ready yet
UPDATE pgmq.q_auth_emails SET vt = now() + interval '10 minutes';
SELECT pg_temp.check(NOT public.email_queue_has_ready(), 'a message held back until later is not ready');
SELECT pg_temp.check(pg_temp.minute() = 0, 'nothing is called for a held-back message');
UPDATE pgmq.q_auth_emails SET vt = now() - interval '1 second';
SELECT pg_temp.check(public.email_queue_has_ready(), 'it is ready again once the delay is over');

-- 4. the provider asked us to wait: nothing is called, even with mail waiting
UPDATE public.email_send_state SET retry_after_until = now() + interval '5 minutes';
SELECT pg_temp.check(NOT public.email_queue_has_ready(), 'nothing is ready while the provider cool-down lasts');
UPDATE public.email_send_state SET retry_after_until = now() - interval '1 minute';
SELECT pg_temp.check(public.email_queue_has_ready(), 'ready again after the cool-down');
UPDATE public.email_send_state SET retry_after_until = NULL;

-- 5. a queue that does not exist yet: let the function run (it creates the queue)
ALTER TABLE pgmq.q_auth_emails RENAME TO q_auth_emails_gone;
SELECT pg_temp.check(public.email_queue_has_ready(), 'a missing queue is left to the function to report');
ALTER TABLE pgmq.q_auth_emails_gone RENAME TO q_auth_emails;

-- 6. the requests that are made are still recorded for the health check
SELECT pg_temp.check((SELECT count(*) FROM public.scheduled_job_requests WHERE job_name = 'process-email-queue-every-5s') >= 12, 'each call is still written to scheduled_job_requests');

-- 7. who may ask
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.email_queue_has_ready()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.email_queue_has_ready()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.email_queue_has_ready()', 'EXECUTE'), 'only the server can ask');
SELECT 'email_queue_idle_test: all checks passed' AS result;

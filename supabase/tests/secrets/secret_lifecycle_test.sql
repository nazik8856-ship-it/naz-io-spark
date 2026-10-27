-- Secrets handling, front 3: 20261031010000 keeps a stored secret exactly as long as something uses it. Checks the one-off
-- cleanup of removed tools (a key another tool still uses stays), tool removal, disconnect, webhook rotation, account deletion,
-- the orphan sweep (NazAI's own secrets and fresh ones are never taken) and that the event log is server-only.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

-- The live shapes this migration relies on: every secret-holding table belongs to a user and goes with them (ON DELETE CASCADE),
-- an agents table, the incident table's columns, and pg_cron's schedule().
TRUNCATE public.agent_integrations, public.webhooks, public.api_keys CASCADE;
TRUNCATE vault.secrets;
ALTER TABLE public.external_tools ADD COLUMN IF NOT EXISTS user_id uuid, ADD COLUMN IF NOT EXISTS credentials_secret_id uuid, ADD COLUMN IF NOT EXISTS removed_at timestamptz;
DELETE FROM public.external_tools;
CREATE TABLE IF NOT EXISTS public.agents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, webhook_secret_id uuid);
ALTER TABLE public.platform_incidents ADD COLUMN IF NOT EXISTS summary text, ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.agent_integrations ADD FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.webhooks ADD FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.api_keys ADD FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.external_tools ADD FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.agents ADD FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job VALUES (job_name, schedule, command) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING 1::bigint $$;

-- Before the migration: removed tools still holding keys, one of them a key a live tool also uses (as on the live database).
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2') ON CONFLICT DO NOTHING;
INSERT INTO vault.secrets (id, name, description, secret) VALUES
  ('10000000-0000-0000-0000-000000000001', 'outer-control-tool-shared', 'agent_integrations credentials', '{"token":"t-shared"}'),
  ('10000000-0000-0000-0000-000000000002', 'outer-control-livetest', 'agent_integrations credentials', '{"token":"t-lonely"}'),
  ('10000000-0000-0000-0000-0000000000aa', 'decision_signing_secret', 'HMAC key for agent_decisions signatures', 'k1'),
  ('10000000-0000-0000-0000-0000000000ab', 'email_queue_service_role_key', 'Service role key used by pg_cron jobs to call scheduled edge functions', 'k2');
INSERT INTO public.external_tools (id, user_id, name, credentials_secret_id, removed_at) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'Bot2 (live)', '10000000-0000-0000-0000-000000000001', NULL),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', 'old test', '10000000-0000-0000-0000-000000000001', now()),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000f1', 'LIVETEST a', '10000000-0000-0000-0000-000000000002', now()),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000f1', 'LIVETEST b', '10000000-0000-0000-0000-000000000002', now());

\ir ../../migrations/20261031010000_secret_lifecycle.sql

-- 1. The one-off cleanup: removed tools let go; the key only they used is gone; the key the live tool uses stays.
SELECT pg_temp.check((SELECT count(*) FROM public.external_tools WHERE removed_at IS NOT NULL AND credentials_secret_id IS NOT NULL) = 0, 'removed tools hold no key');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'outer-control-livetest'), 'a key only removed tools used is deleted');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'outer-control-tool-shared'), 'a key a live tool still uses stays');
SELECT pg_temp.check((SELECT credentials_secret_id FROM public.external_tools WHERE name = 'Bot2 (live)') = '10000000-0000-0000-0000-000000000001', 'the live tool keeps its key');

-- 2. Removing the last tool that uses a key deletes the key.
UPDATE public.external_tools SET removed_at = now(), credentials_secret_id = NULL WHERE name = 'Bot2 (live)';
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'outer-control-tool-shared'), 'removing the last user of a key deletes it');

-- 3. Disconnecting (the row is deleted) deletes the integration's tokens; replacing a webhook secret deletes the old one.
INSERT INTO vault.secrets (id, name, description, secret) VALUES
  ('10000000-0000-0000-0000-000000000003', 'gmail-f1', 'agent_integrations credentials', '{"refresh_token":"r"}'),
  ('10000000-0000-0000-0000-000000000004', 'webhook-old', 'agent_integrations credentials', '{"secret":"a"}'),
  ('10000000-0000-0000-0000-000000000005', 'webhook-new', 'agent_integrations credentials', '{"secret":"b"}');
INSERT INTO public.agent_integrations (user_id, provider, credentials_secret_id) VALUES ('00000000-0000-0000-0000-0000000000f1', 'Gmail', '10000000-0000-0000-0000-000000000003');
DELETE FROM public.agent_integrations WHERE provider = 'Gmail';
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'gmail-f1'), 'disconnect deletes the stored tokens');
INSERT INTO public.webhooks (id, user_id, url, secret, secret_id) VALUES ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'https://h.test', '', '10000000-0000-0000-0000-000000000004');
UPDATE public.webhooks SET secret_id = '10000000-0000-0000-0000-000000000005' WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'webhook-old') AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'webhook-new'), 'a replaced webhook secret is deleted, the new one kept');

-- 4. Deleting an account deletes every secret its rows held, and nothing of anyone else's.
INSERT INTO vault.secrets (id, name, description, secret) VALUES
  ('10000000-0000-0000-0000-000000000011', 'f1-integration', 'agent_integrations credentials', 'x'),
  ('10000000-0000-0000-0000-000000000012', 'f1-tool', 'agent_integrations credentials', 'x'),
  ('10000000-0000-0000-0000-000000000013', 'f1-webhook-previous', 'webhook previous signing secret', 'x'),
  ('10000000-0000-0000-0000-000000000014', 'f1-callback', 'API key callback secret', 'x'),
  ('10000000-0000-0000-0000-000000000015', 'f1-agent-webhook', 'agents.webhook_secret', 'x'),
  ('10000000-0000-0000-0000-000000000021', 'f2-integration', 'agent_integrations credentials', 'x');
INSERT INTO public.agent_integrations (user_id, provider, credentials_secret_id) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'Slack', '10000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-0000000000f2', 'Slack', '10000000-0000-0000-0000-000000000021');
INSERT INTO public.external_tools (user_id, name, credentials_secret_id) VALUES ('00000000-0000-0000-0000-0000000000f1', 'ChatGPT', '10000000-0000-0000-0000-000000000012');
UPDATE public.webhooks SET previous_secret_id = '10000000-0000-0000-0000-000000000013' WHERE id = '30000000-0000-0000-0000-000000000001';
INSERT INTO public.api_keys (user_id, name, key_hash, callback_secret_id) VALUES ('00000000-0000-0000-0000-0000000000f1', 'k', 'h', '10000000-0000-0000-0000-000000000014');
INSERT INTO public.agents (user_id, webhook_secret_id) VALUES ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-000000000015');
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000f1';
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'f1-%' OR name = 'webhook-new'), 'every secret of the deleted account is gone');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'f2-integration'), 'another account''s secret is untouched');

-- 5. The sweep: old customer secrets nothing uses are deleted; NazAI's own secrets, fresh ones and used ones stay. It is recorded,
--    and the first finding opens one platform incident.
INSERT INTO vault.secrets (name, description, secret, created_at) VALUES
  ('orphan-integration', 'agent_integrations credentials', 'x', now() - interval '2 days'),
  ('orphan-callback', 'API key callback secret', 'x', now() - interval '2 days'),
  ('fresh-integration', 'agent_integrations credentials', 'x', now() - interval '5 minutes'),
  ('someone-elses-system-secret', 'something NazAI did not create', 'x', now() - interval '2 days');
SELECT pg_temp.check(public.sweep_orphan_vault_secrets() = 2, 'the sweep deletes the two old orphans');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'orphan-%'), 'orphans gone');
SELECT pg_temp.check((SELECT count(*) FROM vault.secrets WHERE name IN ('decision_signing_secret', 'email_queue_service_role_key', 'fresh-integration', 'someone-elses-system-secret', 'f2-integration')) = 5, 'system, fresh, unknown and used secrets kept');
SELECT pg_temp.check((SELECT outcome || ' / ' || detail FROM public.secret_events WHERE kind = 'orphan_sweep' ORDER BY created_at DESC LIMIT 1) = '2 deleted / orphan-callback, orphan-integration', 'the run is recorded with what it deleted');
SELECT pg_temp.check((SELECT count(*) FROM public.platform_incidents WHERE kind = 'orphan_vault_secrets' AND resolved_at IS NULL) = 1, 'an incident is opened');
INSERT INTO vault.secrets (name, description, secret, created_at) VALUES ('orphan-2', 'webhook signing secret', 'x', now() - interval '2 days');
SELECT pg_temp.check(public.sweep_orphan_vault_secrets() = 1, 'a later orphan is deleted too');
SELECT pg_temp.check((SELECT count(*) FROM public.platform_incidents WHERE kind = 'orphan_vault_secrets') = 1, 'while one is open, no second incident');
SELECT pg_temp.check(public.sweep_orphan_vault_secrets() = 0, 'a clean run deletes nothing');
SELECT pg_temp.check((SELECT count(*) FROM public.secret_events WHERE kind = 'orphan_sweep' AND outcome = '0 deleted') = 1, 'and is recorded as 0 deleted');
SELECT pg_temp.check((SELECT schedule FROM cron.job WHERE jobname = 'secret-orphan-sweep-weekly') = '17 3 * * 1', 'the sweep runs weekly');

-- 6. The event log and the sweep are server-only; event details are scrubbed.
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'public.secret_events', 'SELECT') AND NOT has_table_privilege('anon', 'public.secret_events', 'SELECT'), 'no browser reads the event log');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.sweep_orphan_vault_secrets()', 'EXECUTE'), 'no browser runs the sweep');
INSERT INTO public.secret_events (kind, outcome, detail) VALUES ('provider_revocation', 'failed', 'The provider answered HTTP 400: {"error":"bad token xoxb-1234567890-abcdefghij"}');
SELECT pg_temp.check((SELECT detail FROM public.secret_events WHERE kind = 'provider_revocation') = 'The provider answered HTTP 400: {"error":"bad token [REDACTED:secrets]"}', 'a provider answer echoing the token is scrubbed');
\echo 'secret_lifecycle_test: all checks passed'

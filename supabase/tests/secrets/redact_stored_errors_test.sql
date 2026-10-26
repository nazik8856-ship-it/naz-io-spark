-- Secrets handling, front 2: 20261030040000 scrubs stored error messages. Checks that the SQL scrubber gives exactly the text the
-- TypeScript one gives (cases generated from src/lib/redact-secrets.ts), that the trigger scrubs on insert and update, and that
-- messages already stored are scrubbed by the migration itself.
\set ON_ERROR_STOP 1
RESET ROLE;
-- The tables the triggers attach to that the baseline does not have (only the columns that matter here).
CREATE TABLE IF NOT EXISTS public.action_reversals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), error text);
CREATE TABLE IF NOT EXISTS public.email_send_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), error_message text);
CREATE TABLE IF NOT EXISTS public.external_tools (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, last_error text);
CREATE TABLE IF NOT EXISTS public.imported_projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sync_error text);
CREATE TABLE IF NOT EXISTS public.integration_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), error text);
CREATE TABLE IF NOT EXISTS public.outer_control_evaluations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_summary text);
CREATE TABLE IF NOT EXISTS public.outer_control_session_steps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), error text, reply_text text);
CREATE TABLE IF NOT EXISTS public.outer_control_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stop_reason text);
CREATE TABLE IF NOT EXISTS public.outer_control_workflows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stop_reason text);
CREATE TABLE IF NOT EXISTS public.pending_approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_error text, execution_summary text);
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), error text);
-- Messages stored before the migration (on a clean slate, whatever ran before).
TRUNCATE public.agent_integrations;
INSERT INTO public.external_tools (name, last_error) VALUES ('Old', 'The tool rejected the credentials: Bearer abcdefghijklmnop123');
INSERT INTO public.agent_integrations (user_id, provider, last_error) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Notion', 'Notion refused secret_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6');

\ir ../../migrations/20261030040000_redact_stored_errors.sql

CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

-- 1. Same text as the TypeScript scrubber, case by case. (Fake keys are split so the file never holds a whole key-shaped string.)
CREATE TEMP TABLE cases (input text, expected text);
INSERT INTO cases VALUES
  ('calling the tool with sk-ant-api03-Ab1_Ab1_Ab1_Ab1_Ab1_Ab1_Ab1_Ab1_ now', 'calling the tool with [REDACTED:secrets] now'),
  ('OpenAI said: invalid key sk-proj-Xy9-Xy9-Xy9-Xy9-Xy9-Xy9-Xy9-Xy9-', 'OpenAI said: invalid key [REDACTED:secrets]'),
  ('stripe sk_live_' || '4eC39HqLyjWDarjtT1zdp7dc refused', 'stripe [REDACTED:secrets] refused'),
  ('github_pat_' || '11ABCDEFG011ABCDEFG011ABCDEFG0 expired', '[REDACTED:secrets] expired'),
  ('classic ghp_' || 'a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5', 'classic [REDACTED:secrets]'),
  ('aws AKIA' || 'IOSFODNN7EXAMPLE denied', 'aws [REDACTED:secrets] denied'),
  ('slack xoxb-' || '1234567890-abcdefghij revoked', 'slack [REDACTED:secrets] revoked'),
  ('google AIza' || 'SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY quota', 'google [REDACTED:secrets] quota'),
  ('token ya29.a0AfH6SMBx7f9L2kqZ3a0AfH6SMBx7f9L2kqZ3 expired', 'token [REDACTED:secrets] expired'),
  ('notion secret_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6 unauthorized', 'notion [REDACTED:secrets] unauthorized'),
  ('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz rejected', 'jwt [REDACTED:secrets] rejected'),
  ('Authorization: Bearer abcdefghijklmnop123', 'Authorization: [REDACTED:secrets]'),
  ('got header Bearer abcdefghijklmnop123 back', 'got header Bearer [REDACTED:secrets] back'),
  ('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz', 'Authorization: Bearer [REDACTED:secrets]'),
  ('{"access_token":"tok_live_123456789","expires_in":3600}', '{"access_token":"[REDACTED:secrets]","expires_in":3600}'),
  ('client_secret=s3cr3tvalue&grant_type=refresh_token', 'client_secret=[REDACTED:secrets]&grant_type=refresh_token'),
  ('GET https://api.example.com/cb?code=4/0AY0e-g7&state=xyz&access_token=abc123def', 'GET https://api.example.com/cb?code=[REDACTED:secrets]&state=xyz&access_token=[REDACTED:secrets]'),
  ('password: hunter2024!', 'password: [REDACTED:secrets]'),
  ('x-api-key: sk-ant-api03-Ab1_Ab1_Ab1_Ab1_Ab1_Ab1_Ab1_Ab1_', 'x-api-key: [REDACTED:secrets]'),
  ('The tool answered HTTP 503 after 30 seconds.', 'The tool answered HTTP 503 after 30 seconds.'),
  ('tokens_used: 1200, secret_id: 9b2f0c1e-1111-2222-3333-444455556666', 'tokens_used: 1200, secret_id: 9b2f0c1e-1111-2222-3333-444455556666'),
  ('Use the risk-assessment-framework for skeleton keys and tokens.', 'Use the risk-assessment-framework for skeleton keys and tokens.'),
  ('token: [REDACTED:secrets]', 'token: [REDACTED:secrets]'),
  ('https://example.com/page?state=abc&lang=en', 'https://example.com/page?state=abc&lang=en'),
  ('Notion content append failed: API token is invalid.', 'Notion content append failed: API token is invalid.'),
  ('Google token refresh failed: invalid_grant', 'Google token refresh failed: invalid_grant')
;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT * FROM cases LOOP
    IF public.redact_secrets(c.input) IS DISTINCT FROM c.expected THEN
      RAISE EXCEPTION 'FAILED: SQL and TypeScript scrubbers differ for: %  SQL gave: %  expected: %', c.input, public.redact_secrets(c.input), c.expected;
    END IF;
  END LOOP;
END $$;
SELECT pg_temp.check(public.redact_secrets(NULL) IS NULL AND public.redact_secrets('') = '', 'empty and null pass through');

-- 2. Already stored messages were scrubbed by the migration.
SELECT pg_temp.check((SELECT last_error FROM public.external_tools WHERE name = 'Old') = 'The tool rejected the credentials: Bearer [REDACTED:secrets]', 'stored tool error scrubbed');
SELECT pg_temp.check((SELECT last_error FROM public.agent_integrations WHERE provider = 'Notion') = 'Notion refused [REDACTED:secrets]', 'stored integration error scrubbed');

-- 3. New writes are scrubbed on insert and on update, in every covered column; other columns are left alone.
INSERT INTO public.outer_control_session_steps (error, reply_text) VALUES ('HTTP 401 with key sk-ant-api03-Ab1_Ab1_Ab1_Ab1_Ab1_Ab1_Ab1_Ab1_', 'kept as written');
SELECT pg_temp.check((SELECT error = 'HTTP 401 with key [REDACTED:secrets]' AND reply_text = 'kept as written' FROM public.outer_control_session_steps), 'step error scrubbed on insert, other column untouched');
INSERT INTO public.pending_approvals (execution_error, execution_summary) VALUES ('failed: token=abc123def456', 'ok');
UPDATE public.pending_approvals SET execution_summary = 'posted with Authorization: Bearer abcdefghijklmn';
SELECT pg_temp.check((SELECT execution_error = 'failed: token=[REDACTED:secrets]' AND execution_summary = 'posted with Authorization: [REDACTED:secrets]' FROM public.pending_approvals), 'approval columns scrubbed on insert and update');
INSERT INTO public.webhook_deliveries (error) VALUES ('blocked: https://hooks.test/x?sig=deadbeef&id=1');
SELECT pg_temp.check((SELECT error FROM public.webhook_deliveries) = 'blocked: https://hooks.test/x?sig=[REDACTED:secrets]&id=1', 'delivery error scrubbed');
INSERT INTO public.outer_control_sessions (stop_reason) VALUES ('The tool answered HTTP 503.');
SELECT pg_temp.check((SELECT stop_reason FROM public.outer_control_sessions) = 'The tool answered HTTP 503.', 'an ordinary message is stored unchanged');
SELECT pg_temp.check((SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%_redact_errors') = 12, 'twelve tables carry the trigger');
\echo 'redact_stored_errors_test: all checks passed'

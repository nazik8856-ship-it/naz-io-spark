-- Data encryption, front 5: 20261104010000 encrypts the last content columns, registers the deliberate exemptions, reports any
-- uncovered content column, and keeps a platform incident open while something is left in the clear or uncovered.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

-- The tables this migration touches, reduced to the columns it uses, as they are live (the Outer Control test drops its own).
DROP TABLE IF EXISTS public.outer_control_evaluations, public.outer_control_sessions, public.outer_control_session_steps, public.outer_control_workflows CASCADE;
CREATE TABLE public.outer_control_evaluations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, verdict text, input_excerpt text, input_excerpt_enc text,
  execution_summary text, matches jsonb NOT NULL DEFAULT '[]', shadow_matches jsonb NOT NULL DEFAULT '[]');
CREATE TABLE public.outer_control_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text, objective text, objective_enc text, handoff jsonb);
CREATE TABLE public.outer_control_session_steps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid, error text, decision jsonb);
CREATE TABLE public.outer_control_workflows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text, done_criteria jsonb NOT NULL DEFAULT '[]',
  criteria_state jsonb NOT NULL DEFAULT '[]');
ALTER TABLE public.api_response_cache ADD COLUMN IF NOT EXISTS sources jsonb;
CREATE TABLE IF NOT EXISTS public.platform_incidents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, summary text NOT NULL,
  detail jsonb, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid, resolution_note text);
ALTER TABLE public.platform_incidents ADD COLUMN IF NOT EXISTS detail jsonb, ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz, ADD COLUMN IF NOT EXISTS resolution_note text;
INSERT INTO public.outer_control_evaluations (id, input_excerpt_enc, matches) VALUES ('70000000-0000-0000-0000-000000000001', 'v2:k:iv:i', '[{"name": "sql", "sample": "drop table"}]');

\ir ../../migrations/20261104010000_encryption_front5.sql
\ir ../../migrations/20261104010000_encryption_front5.sql

SELECT pg_temp.check((SELECT count(*) FROM public.encrypted_columns WHERE (table_name, column_name) IN (
  ('outer_control_evaluations', 'execution_summary'), ('outer_control_evaluations', 'matches'), ('outer_control_evaluations', 'shadow_matches'),
  ('outer_control_sessions', 'handoff'), ('outer_control_session_steps', 'decision'), ('outer_control_workflows', 'done_criteria'),
  ('outer_control_workflows', 'criteria_state'), ('api_response_cache', 'sources'))) = 8, 'all 8 columns listed for the report');
SELECT pg_temp.check((SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (
  ('outer_control_evaluations', 'execution_summary_enc'), ('outer_control_evaluations', 'matches_enc'), ('outer_control_evaluations', 'shadow_matches_enc'),
  ('outer_control_sessions', 'handoff_enc'), ('outer_control_session_steps', 'decision_enc'), ('outer_control_workflows', 'done_criteria_enc'),
  ('outer_control_workflows', 'criteria_state_enc'), ('api_response_cache', 'sources_enc'))) = 8, 'all 8 encrypted twins');
SELECT pg_temp.check((SELECT bool_and(is_nullable = 'YES' AND column_default IS NULL) FROM information_schema.columns WHERE table_schema = 'public'
  AND (table_name, column_name) IN (('outer_control_evaluations', 'matches'), ('outer_control_evaluations', 'shadow_matches'),
  ('outer_control_workflows', 'done_criteria'), ('outer_control_workflows', 'criteria_state'))), 'no "[]" default left to write in the clear');

-- The earlier columns keep their safety net, and the new ones have it too: a plain write clears only its own encrypted twin.
UPDATE public.outer_control_evaluations SET matches = NULL, matches_enc = 'v2:k:iv:m' WHERE id = '70000000-0000-0000-0000-000000000001';
UPDATE public.outer_control_evaluations SET matches = '[]' WHERE id = '70000000-0000-0000-0000-000000000001';
SELECT pg_temp.check((SELECT matches_enc IS NULL AND input_excerpt_enc = 'v2:k:iv:i' FROM public.outer_control_evaluations WHERE id = '70000000-0000-0000-0000-000000000001'),
  'evaluations: a plain write wins over an older encrypted value, other twins untouched');
INSERT INTO public.outer_control_session_steps (decision, decision_enc) VALUES ('{"why": "plain"}', 'v2:k:iv:stale');
SELECT pg_temp.check((SELECT decision_enc IS NULL FROM public.outer_control_session_steps WHERE decision IS NOT NULL), 'steps: on insert too');

-- Coverage: a new content column that is neither encrypted nor exempt is reported, by name; an exemption with a reason clears it.
ALTER TABLE public.outer_control_sessions ADD COLUMN reviewer_note text;
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.encryption_coverage_report() WHERE table_name = 'outer_control_sessions' AND column_name = 'reviewer_note'),
  'an uncovered content column is reported');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.encryption_coverage_report() WHERE column_name IN ('status', 'handoff', 'handoff_enc', 'matches', 'kind')),
  'encrypted, twin and exempt columns are not reported');
INSERT INTO public.encryption_exempt_columns VALUES ('outer_control_sessions', 'reviewer_note', 'test: a note written by the system');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.encryption_coverage_report() WHERE column_name = 'reviewer_note'), 'an exemption clears it');
SELECT pg_temp.check((SELECT count(*) FROM public.encryption_exempt_columns WHERE length(reason) < 10) = 0, 'every exemption has a reason');

-- The weekly check: an incident while plain values are left (the evaluation above), one only, updated on the next run.
SELECT public.encryption_weekly_check();
SELECT public.encryption_weekly_check();
SELECT pg_temp.check((SELECT count(*) FROM public.platform_incidents WHERE kind = 'encryption_check' AND resolved_at IS NULL) = 1, 'one open incident, not one per run');
SELECT pg_temp.check((SELECT detail -> 'plain' @> '[{"table": "outer_control_evaluations", "column": "matches"}]' FROM public.platform_incidents WHERE kind = 'encryption_check'),
  'the incident names the column with plain values');
-- Once everything is encrypted and covered, it closes.
BEGIN;
DELETE FROM public.encrypted_columns;
SELECT public.encryption_weekly_check();
SELECT pg_temp.check((SELECT resolved_at IS NOT NULL FROM public.platform_incidents WHERE kind = 'encryption_check'), 'closed once nothing is left');
ROLLBACK;

SELECT pg_temp.check((SELECT schedule FROM cron.job WHERE jobname = 'encryption-weekly-check') = '43 3 * * 1', 'the check runs every Monday');

-- Only the server may run the report and the check.
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.encryption_coverage_report()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.encryption_weekly_check()', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.encryption_exempt_columns', 'SELECT'), 'server only');

SELECT 'encrypt_front5_test: all checks passed';

-- Data encryption, front 3: 20261103010000 adds the encrypted twins, lets an emptied column be null, makes a plain write win over an
-- older encrypted value, keeps the completed guards for plain and encrypted results, and counts encrypted requests in tool usage.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.fails(stmt text, expect text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM ILIKE '%' || expect || '%'; END $$;

-- The live tables, reduced to the columns this migration touches (and the completed guards as they were). An earlier test leaves
-- smaller versions of some of them behind.
DROP VIEW IF EXISTS public.outer_control_tool_usage;
DROP TABLE IF EXISTS public.outer_control_sessions, public.outer_control_session_steps, public.outer_control_evaluations, public.outer_control_workflows, public.outer_control_memory, public.outer_control_completion_checks CASCADE;
DROP FUNCTION IF EXISTS public.guard_outer_control_completed(), public.guard_outer_control_task_completed() CASCADE;
CREATE TABLE public.outer_control_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, tool_id uuid, status text NOT NULL DEFAULT 'running',
  objective text NOT NULL, context text, correction text, history jsonb NOT NULL DEFAULT '[]', next_input text, final_output text, pending_question text,
  pending_answer text, final_artifact jsonb, completion jsonb);
CREATE TABLE public.outer_control_session_steps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid, user_id uuid, request jsonb, reply_text text,
  note text, error text, http_status int, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.outer_control_evaluations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, input_excerpt text NOT NULL, output_text text, summary text, next_step text, changes jsonb NOT NULL DEFAULT '[]');
CREATE TABLE public.outer_control_workflows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text NOT NULL DEFAULT 'running', objective text NOT NULL, context text, summary text, final_output text, final_artifact jsonb, goal_pool jsonb NOT NULL DEFAULT '[]');
CREATE TABLE public.outer_control_memory (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, summary text NOT NULL, data jsonb);
CREATE TABLE public.outer_control_completion_checks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, summary text NOT NULL);
CREATE FUNCTION public.guard_outer_control_completed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION public.guard_outer_control_task_completed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER outer_control_completed_guard BEFORE UPDATE ON public.outer_control_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_outer_control_completed();
CREATE TRIGGER outer_control_task_completed_guard BEFORE UPDATE ON public.outer_control_workflows FOR EACH ROW EXECUTE FUNCTION public.guard_outer_control_task_completed();
CREATE VIEW public.outer_control_tool_usage WITH (security_invoker = true) AS SELECT s.user_id, s.tool_id, count(*) AS requests_30d, count(*) AS failed_30d, count(*) AS requests_today, max(st.created_at) AS last_request_at
  FROM public.outer_control_session_steps st JOIN public.outer_control_sessions s ON s.id = st.session_id WHERE st.request IS NOT NULL GROUP BY 1, 2;

\ir ../../migrations/20261102010000_encryption_report.sql
\ir ../../migrations/20261103010000_encrypt_outer_control.sql
\ir ../../migrations/20261103010000_encrypt_outer_control.sql

SELECT pg_temp.check((SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'outer_control_%' AND column_name LIKE '%\_enc') = 26, 'all 26 encrypted twins');
SELECT pg_temp.check((SELECT count(*) FROM public.encrypted_columns WHERE table_name LIKE 'outer_control_%') = 26, 'all 26 listed for the report');
SELECT pg_temp.check((SELECT bool_and(is_nullable = 'YES') FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN
  (('outer_control_sessions', 'objective'), ('outer_control_sessions', 'history'), ('outer_control_evaluations', 'input_excerpt'), ('outer_control_evaluations', 'changes'),
   ('outer_control_workflows', 'objective'), ('outer_control_workflows', 'goal_pool'), ('outer_control_memory', 'summary'), ('outer_control_completion_checks', 'summary'))),
  'emptied columns may be null');

-- The way the server writes: only the twin.
INSERT INTO public.outer_control_sessions (id, objective, objective_enc, history, history_enc) VALUES ('10000000-0000-0000-0000-000000000001', NULL, 'v2:k:iv:obj', NULL, 'v2:k:iv:hist');
SELECT pg_temp.check((SELECT objective IS NULL AND objective_enc = 'v2:k:iv:obj' AND history IS NULL FROM public.outer_control_sessions WHERE id = '10000000-0000-0000-0000-000000000001'), 'an encrypted write is kept as written');
-- A plain write (a path that does not encrypt) wins: the older encrypted value is cleared, the other twins are untouched.
UPDATE public.outer_control_sessions SET objective = 'newer plain text' WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.check((SELECT objective = 'newer plain text' AND objective_enc IS NULL AND history_enc = 'v2:k:iv:hist' FROM public.outer_control_sessions WHERE id = '10000000-0000-0000-0000-000000000001'), 'a plain write clears only its own twin');
INSERT INTO public.outer_control_memory (summary, summary_enc) VALUES ('plain', 'v2:k:iv:stale');
SELECT pg_temp.check((SELECT summary_enc IS NULL FROM public.outer_control_memory), 'on insert too');
SELECT pg_temp.check((SELECT objective_enc IS NULL FROM public.outer_control_sessions WHERE id = '10000000-0000-0000-0000-000000000001'), 'still cleared');

-- Completed guards.
INSERT INTO public.outer_control_sessions (id, objective_enc, status) VALUES ('10000000-0000-0000-0000-000000000002', 'v2:k:iv:o', 'running');
SELECT pg_temp.check(pg_temp.fails($$UPDATE public.outer_control_sessions SET status = 'completed', final_output_enc = 'v2:k:iv:f' WHERE id = '10000000-0000-0000-0000-000000000002'$$, 'passing completion checklist'), 'no checklist: refused');
SELECT pg_temp.check(pg_temp.fails($$UPDATE public.outer_control_sessions SET status = 'completed', final_output_enc = 'v2:k:iv:f', completion = '{"passed": true, "outcome": "completed", "output_sha256": "abc"}' WHERE id = '10000000-0000-0000-0000-000000000002'$$, 'matching final artifact'), 'encrypted result without its artifact: refused');
UPDATE public.outer_control_sessions SET status = 'completed', final_output_enc = 'v2:k:iv:f', final_artifact_enc = 'v2:k:iv:a', completion = '{"passed": true, "outcome": "completed", "output_sha256": "abc"}' WHERE id = '10000000-0000-0000-0000-000000000002';
SELECT pg_temp.check((SELECT status = 'completed' FROM public.outer_control_sessions WHERE id = '10000000-0000-0000-0000-000000000002'), 'encrypted result, artifact and passing checklist: completes');
INSERT INTO public.outer_control_sessions (id, objective, status) VALUES ('10000000-0000-0000-0000-000000000003', 'plain', 'running');
SELECT pg_temp.check(pg_temp.fails($$UPDATE public.outer_control_sessions SET status = 'completed', final_output = 'out', final_artifact = '{"kind": "session", "final_output": "different", "output_sha256": "abc", "human_text": "t"}', completion = '{"passed": true, "outcome": "completed", "output_sha256": "abc"}' WHERE id = '10000000-0000-0000-0000-000000000003'$$, 'matching final artifact'), 'a plain result is still checked against its artifact');
INSERT INTO public.outer_control_workflows (id, objective_enc) VALUES ('20000000-0000-0000-0000-000000000001', 'v2:k:iv:o');
SELECT pg_temp.check(pg_temp.fails($$UPDATE public.outer_control_workflows SET status = 'completed', final_output_enc = 'v2:k:iv:f' WHERE id = '20000000-0000-0000-0000-000000000001'$$, 'matching final artifact'), 'a Task without its encrypted artifact: refused');
UPDATE public.outer_control_workflows SET status = 'completed', final_output_enc = 'v2:k:iv:f', final_artifact_enc = 'v2:k:iv:a' WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT pg_temp.check(pg_temp.fails($$UPDATE public.outer_control_workflows SET status = 'running' WHERE id = '20000000-0000-0000-0000-000000000001'; UPDATE public.outer_control_workflows SET status = 'completed', final_output_enc = NULL, final_output = '' WHERE id = '20000000-0000-0000-0000-000000000001'$$, 'without a final result'), 'a Task with neither result: refused');

-- Tool usage counts encrypted requests.
INSERT INTO public.outer_control_session_steps (session_id, request_enc) VALUES ('10000000-0000-0000-0000-000000000002', 'v2:k:iv:r');
INSERT INTO public.outer_control_session_steps (session_id, request) VALUES ('10000000-0000-0000-0000-000000000002', '{"a": 1}');
INSERT INTO public.outer_control_session_steps (session_id) VALUES ('10000000-0000-0000-0000-000000000002');
SELECT pg_temp.check((SELECT requests_30d = 2 FROM public.outer_control_tool_usage), 'encrypted and plain requests are counted, empty steps are not');

-- The report sees the new columns.
SELECT pg_temp.check((SELECT plain_rows = 2 AND encrypted_rows = 1 FROM public.encryption_report() WHERE table_name = 'outer_control_sessions' AND column_name = 'objective'), 'the report counts plain (2 rows written in the clear) and encrypted values');

-- Front 4: form submissions and integration snapshots, the same way.
DROP TABLE IF EXISTS public.website_form_submissions, public.integration_snapshots CASCADE;
CREATE TABLE public.website_form_submissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, fields jsonb NOT NULL DEFAULT '{}', submitter_ip text);
CREATE TABLE public.integration_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, data jsonb NOT NULL DEFAULT '{}');
\ir ../../migrations/20261103020000_encrypt_visitor_and_integration_data.sql
\ir ../../migrations/20261103020000_encrypt_visitor_and_integration_data.sql
INSERT INTO public.website_form_submissions (fields, fields_enc, submitter_ip, submitter_ip_enc) VALUES (NULL, 'v2:k:iv:f', NULL, 'v2:k:iv:ip');
INSERT INTO public.integration_snapshots (data, data_enc) VALUES (NULL, 'v2:k:iv:d');
SELECT pg_temp.check((SELECT fields IS NULL AND submitter_ip IS NULL AND fields_enc IS NOT NULL FROM public.website_form_submissions), 'a visitor''s form is stored only encrypted');
UPDATE public.integration_snapshots SET data = '{"plain": true}';
SELECT pg_temp.check((SELECT data_enc IS NULL FROM public.integration_snapshots), 'a plain write wins here too');
SELECT pg_temp.check((SELECT count(*) = 3 FROM public.encrypted_columns WHERE table_name IN ('website_form_submissions', 'integration_snapshots')), 'listed for the report');
DROP TABLE public.website_form_submissions, public.integration_snapshots;
DELETE FROM public.encrypted_columns WHERE table_name IN ('website_form_submissions', 'integration_snapshots');

DROP VIEW public.outer_control_tool_usage;
DROP TABLE public.outer_control_sessions, public.outer_control_session_steps, public.outer_control_evaluations, public.outer_control_workflows, public.outer_control_memory, public.outer_control_completion_checks;
DELETE FROM public.encrypted_columns WHERE table_name LIKE 'outer_control_%';
\echo 'encrypt_outer_control_test: all checks passed'

-- Data encryption, front 4: 20261103030000 (agent runs and events), 20261103040000 (Generator requests, knowledge base, /respond
-- data) and 20261103050000 (approvals) add the encrypted twins, let the emptied columns be null, keep the payload's flags in plain
-- columns, and give the code _v2 database functions that return the encrypted values.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

-- The live tables, reduced to the columns these migrations touch. An earlier test may leave smaller versions behind.
DROP TABLE IF EXISTS public.agent_runs, public.agent_events, public.missions, public.knowledge_base_entries, public.api_key_context_entries,
  public.api_response_cache, public.api_response_generations, public.api_key_response_rules, public.pending_approvals, public.agent_decisions CASCADE;
CREATE TABLE public.agent_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, instruction text NOT NULL, summary text, outcome jsonb);
CREATE TABLE public.agent_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, user_id uuid, kind text, payload jsonb NOT NULL DEFAULT '{}',
  reasoning text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.missions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, directive text NOT NULL, status text);
CREATE TABLE public.knowledge_base_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, entry_text text NOT NULL);
CREATE TABLE public.api_key_context_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), api_key_id uuid, entry_text text NOT NULL,
  embedding text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.api_response_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), api_key_id uuid, message text NOT NULL, answer text NOT NULL);
CREATE TABLE public.api_response_generations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), api_key_id uuid, message text NOT NULL,
  grounding_check_intervened boolean, resolved_at timestamptz, is_test boolean DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.api_key_response_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), api_key_id uuid, enabled boolean, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.agent_decisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, action_type text, provider text, description text, params jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.pending_approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, decision_id uuid, action_type text, provider text,
  description text NOT NULL, comment text, execution_summary text, params jsonb, created_at timestamptz NOT NULL DEFAULT now());
-- The two functions 030000 edits, with the expressions it changes exactly as they are written live.
CREATE OR REPLACE FUNCTION public.get_business_context(_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.agent_events WHERE user_id = _user_id AND (payload->>'ok')::boolean IS TRUE;
$$;
CREATE OR REPLACE FUNCTION public.delete_expired_agent_events(_user_id uuid, _before timestamp with time zone) RETURNS integer LANGUAGE sql AS $$
  WITH e AS (DELETE FROM public.agent_events e WHERE e.user_id = _user_id AND e.created_at < _before AND e.kind = 'question'
    AND NOT EXISTS (SELECT 1 FROM public.agent_events a WHERE (a.payload ->> 'ref') = e.id::text) RETURNING 1)
  SELECT count(*)::int FROM e;
$$;

-- Events written before the migration: their flags are copied into the plain columns.
INSERT INTO public.agent_events (id, user_id, kind, payload) VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'action', '{"ok": true, "ref": "q-1", "original_event_id": "e-0"}'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2', 'action', '{"ok": "yes"}');

\ir ../../migrations/20261103030000_encrypt_agent_runs_and_events.sql
\ir ../../migrations/20261103040000_encrypt_missions_kb_api_data.sql
\ir ../../migrations/20261103050000_encrypt_pending_approvals.sql
-- Each can run again.
\ir ../../migrations/20261103030000_encrypt_agent_runs_and_events.sql
\ir ../../migrations/20261103040000_encrypt_missions_kb_api_data.sql
\ir ../../migrations/20261103050000_encrypt_pending_approvals.sql

SELECT pg_temp.check((SELECT count(*) FROM public.encrypted_columns WHERE table_name IN ('agent_runs', 'agent_events', 'missions', 'knowledge_base_entries',
  'api_key_context_entries', 'api_response_cache', 'api_response_generations', 'pending_approvals')) = 14, 'all 14 columns listed for the report');
SELECT pg_temp.check((SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('instruction_enc', 'summary_enc', 'outcome_enc',
  'payload_enc', 'reasoning_enc', 'directive_enc', 'entry_text_enc', 'message_enc', 'answer_enc', 'description_enc', 'comment_enc', 'execution_summary_enc')
  AND table_name IN ('agent_runs', 'agent_events', 'missions', 'knowledge_base_entries', 'api_key_context_entries', 'api_response_cache', 'api_response_generations', 'pending_approvals')) = 14,
  'all 14 encrypted twins');
SELECT pg_temp.check((SELECT bool_and(is_nullable = 'YES') FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN
  (('agent_runs', 'instruction'), ('agent_events', 'payload'), ('missions', 'directive'), ('knowledge_base_entries', 'entry_text'), ('api_key_context_entries', 'entry_text'),
   ('api_response_cache', 'message'), ('api_response_cache', 'answer'), ('api_response_generations', 'message'), ('pending_approvals', 'description'))),
  'emptied columns may be null');

-- Flags of existing events; a value that is not a boolean is not guessed.
SELECT pg_temp.check((SELECT payload_ok AND payload_ref = 'q-1' AND payload_original_event_id = 'e-0' FROM public.agent_events WHERE id = '30000000-0000-0000-0000-000000000001'), 'existing flags copied');
SELECT pg_temp.check((SELECT payload_ok IS NULL FROM public.agent_events WHERE id = '30000000-0000-0000-0000-000000000002'), 'a non-boolean ok is left empty');

-- The business context counts successful actions from the flag (encrypted events) and from the payload (plain events).
INSERT INTO public.agent_events (user_id, kind, payload, payload_enc, payload_ok) VALUES ('00000000-0000-0000-0000-0000000000a1', 'action', NULL, 'v2:k:iv:p', true);
SELECT pg_temp.check(public.get_business_context('00000000-0000-0000-0000-0000000000a1') = 2, 'encrypted and plain successful actions counted');

-- A question answered by an encrypted event (its ref in payload_ref) is kept; an unanswered one is deleted.
INSERT INTO public.agent_events (id, user_id, kind, created_at) VALUES
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'question', now() - interval '40 days'),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'question', now() - interval '40 days');
INSERT INTO public.agent_events (user_id, kind, payload, payload_enc, payload_ref) VALUES ('00000000-0000-0000-0000-0000000000a1', 'answer', NULL, 'v2:k:iv:a', '30000000-0000-0000-0000-000000000003');
SELECT pg_temp.check(public.delete_expired_agent_events('00000000-0000-0000-0000-0000000000a1', now() - interval '30 days') = 1, 'only the unanswered question deleted');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.agent_events WHERE id = '30000000-0000-0000-0000-000000000003'), 'the answered question kept');

-- A plain write wins over an older encrypted value, here too.
INSERT INTO public.pending_approvals (id, user_id, description, description_enc, comment_enc) VALUES ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', NULL, 'v2:k:iv:d', 'v2:k:iv:c');
UPDATE public.pending_approvals SET comment = coalesce(nullif(left(coalesce(NULL::text, ''), 800), ''), comment) WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT pg_temp.check((SELECT comment_enc = 'v2:k:iv:c' AND description_enc = 'v2:k:iv:d' FROM public.pending_approvals WHERE id = '40000000-0000-0000-0000-000000000001'),
  'a sign-off without a comment keeps the encrypted comment');
UPDATE public.pending_approvals SET comment = 'typed in the clear' WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT pg_temp.check((SELECT comment_enc IS NULL AND description_enc = 'v2:k:iv:d' FROM public.pending_approvals WHERE id = '40000000-0000-0000-0000-000000000001'), 'a plain comment clears only its own twin');
INSERT INTO public.missions (directive, directive_enc) VALUES ('plain', 'v2:k:iv:stale');
SELECT pg_temp.check((SELECT directive_enc IS NULL FROM public.missions), 'missions: on insert too');

-- Policy replay: approvals come back with their own row id and the encrypted description; decisions with neither.
INSERT INTO public.agent_decisions (id, user_id, action_type, description, params) VALUES ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'send_email', 'plain decision', '{}');
UPDATE public.pending_approvals SET decision_id = '50000000-0000-0000-0000-000000000002', action_type = 'delete_record', params = '{}' WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT pg_temp.check((SELECT count(*) = 2
  AND bool_and(CASE real_source WHEN 'approval' THEN id = '50000000-0000-0000-0000-000000000002' AND approval_row_id = '40000000-0000-0000-0000-000000000001' AND description_enc = 'v2:k:iv:d'
                                ELSE approval_row_id IS NULL AND description_enc IS NULL AND description = 'plain decision' END)
  FROM public.get_replayable_real_decisions_v2('00000000-0000-0000-0000-0000000000a1')), 'replay rows carry what the server needs to decrypt');

-- Content gaps: the candidate's encrypted question comes back with its id.
INSERT INTO public.api_response_generations (id, api_key_id, message, message_enc, grounding_check_intervened, created_at) VALUES
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', NULL, 'v2:k:iv:m', true, now() - interval '1 day');
INSERT INTO public.api_key_response_rules (api_key_id, enabled) VALUES ('00000000-0000-0000-0000-0000000000b1', true);
SELECT pg_temp.check((SELECT id = '60000000-0000-0000-0000-000000000001' AND message IS NULL AND message_enc = 'v2:k:iv:m' FROM public.list_resolvable_gap_candidates_v2(10)), 'gap candidates carry the encrypted question');

-- Only the server may call the _v2 functions.
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.get_replayable_real_decisions_v2(uuid, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.list_resolvable_gap_candidates_v2(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.list_resolvable_gap_candidates_v2(integer)', 'EXECUTE'), 'server only');

SELECT 'encrypt_front4_test: all checks passed';

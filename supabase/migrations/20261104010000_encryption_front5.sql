-- Data encryption, front 5: the last content columns, a register of the columns that are deliberately not encrypted, and a
-- check that nothing new slips through.
--
-- 1. Eight more columns are stored encrypted by the edge functions (DATA_KEY, _shared/encrypted-db.ts). They held copies of
--    user content: the matched text a rule quotes (outer_control_evaluations.matches / shadow_matches, "sample"), what an action
--    reported (execution_summary), the draft handed to a person (outer_control_sessions.handoff), a step's decision record
--    (outer_control_session_steps.decision), a Task's goals (outer_control_workflows.done_criteria / criteria_state) and the
--    knowledge excerpts behind a cached answer (api_response_cache.sources).
-- 2. encryption_exempt_columns lists every other text or JSON column of a table that holds encrypted content, with the reason it
--    stays readable to the database (a status, an id, rule data the gate reads, ...). encryption_coverage_report() lists the
--    columns that are neither encrypted nor exempt: a new column must be one or the other.
-- 3. encryption_weekly_check() opens a platform incident when a listed column has plain values left or a column is uncovered,
--    and closes it once both are clear. It runs every Monday.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('outer_control_evaluations', 'execution_summary'), ('outer_control_evaluations', 'matches'), ('outer_control_evaluations', 'shadow_matches'),
    ('outer_control_sessions', 'handoff'), ('outer_control_session_steps', 'decision'),
    ('outer_control_workflows', 'done_criteria'), ('outer_control_workflows', 'criteria_state'), ('api_response_cache', 'sources')
  ) AS v(t, c) LOOP
    IF to_regclass(format('public.%I', r.t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text', r.t, r.c || '_enc');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    -- The server writes the encrypted twin and leaves this column empty; a default would put "[]" back in the clear.
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP DEFAULT', r.t, r.c);
    INSERT INTO public.encrypted_columns (table_name, column_name, note)
    VALUES (r.t, r.c, 'Encrypted with DATA_KEY (encrypted-db.ts).')
    ON CONFLICT (table_name, column_name) DO NOTHING;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS outer_control_evaluations_plain_wins ON public.outer_control_evaluations;
CREATE TRIGGER outer_control_evaluations_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_evaluations FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('input_excerpt', 'output_text', 'summary', 'next_step', 'changes', 'execution_summary', 'matches', 'shadow_matches');
DROP TRIGGER IF EXISTS outer_control_sessions_plain_wins ON public.outer_control_sessions;
CREATE TRIGGER outer_control_sessions_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_sessions FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('objective', 'context', 'correction', 'history', 'next_input', 'final_output', 'pending_question', 'pending_answer', 'final_artifact', 'handoff');
DROP TRIGGER IF EXISTS outer_control_session_steps_plain_wins ON public.outer_control_session_steps;
CREATE TRIGGER outer_control_session_steps_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_session_steps FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('request', 'reply_text', 'note', 'decision');
DROP TRIGGER IF EXISTS outer_control_workflows_plain_wins ON public.outer_control_workflows;
CREATE TRIGGER outer_control_workflows_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_workflows FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('objective', 'context', 'summary', 'final_output', 'final_artifact', 'goal_pool', 'done_criteria', 'criteria_state');
DROP TRIGGER IF EXISTS api_response_cache_plain_wins ON public.api_response_cache;
CREATE TRIGGER api_response_cache_plain_wins BEFORE INSERT OR UPDATE ON public.api_response_cache FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('message', 'answer', 'sources');

-- The cached-answer search also returns the encrypted sources (the server decrypts them). Its result type changes, so it is
-- dropped and created again in the same transaction.
DO $do$
BEGIN
  IF to_regtype('extensions.vector') IS NULL THEN RETURN; END IF;
  EXECUTE 'DROP FUNCTION IF EXISTS public.search_response_cache_v2(uuid, extensions.vector, integer, integer)';
  EXECUTE $f$
    CREATE FUNCTION public.search_response_cache_v2(_api_key_id uuid, _embedding extensions.vector, _policy_version integer, _limit integer DEFAULT 3)
    RETURNS TABLE(id uuid, answer text, answer_enc text, sources jsonb, sources_enc text, confidence text, similarity double precision)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $b$
    BEGIN
      IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not authorized'; END IF;
      RETURN QUERY
      SELECT c.id, c.answer, c.answer_enc, c.sources, c.sources_enc, c.confidence, (1 - (c.embedding <=> _embedding))::float AS similarity
      FROM public.api_response_cache c
      WHERE c.api_key_id = _api_key_id AND c.embedding IS NOT NULL AND c.expires_at > now() AND c.policy_version = _policy_version
      ORDER BY c.embedding <=> _embedding
      LIMIT GREATEST(1, LEAST(_limit, 20));
    END $b$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.search_response_cache_v2(uuid, extensions.vector, integer, integer) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.search_response_cache_v2(uuid, extensions.vector, integer, integer) TO service_role';
END $do$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. The columns that stay readable to the database, and why.
CREATE TABLE IF NOT EXISTS public.encryption_exempt_columns (
  table_name text NOT NULL,
  column_name text NOT NULL,
  reason text NOT NULL CHECK (length(reason) >= 10),
  PRIMARY KEY (table_name, column_name)
);
ALTER TABLE public.encryption_exempt_columns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.encryption_exempt_columns FROM anon, authenticated;

INSERT INTO public.encryption_exempt_columns (table_name, column_name, reason)
SELECT t, c, r FROM (VALUES
  ('agent_events', 'kind', 'status or type value set by the system'),
  ('agent_events', 'confidence', 'status or type value set by the system'),
  ('agent_events', 'payload_ref', 'id, hash or reference, no content'),
  ('agent_events', 'payload_original_event_id', 'id, hash or reference, no content'),
  ('agent_runs', 'trigger', 'status or type value set by the system'),
  ('agent_runs', 'status', 'status or type value set by the system'),
  ('api_response_cache', 'message_hash', 'keyed fingerprint (DATA_KEY), no content'),
  ('api_response_cache', 'confidence', 'status or type value set by the system'),
  ('imported_projects', 'name', 'project name shown and sorted in lists; the project content is encrypted (PROJECTS_KEY)'),
  ('imported_projects', 'source_mode', 'status or type value set by the system'),
  ('imported_projects', 'source_kind', 'status or type value set by the system'),
  ('imported_projects', 'source_ref', 'where the project was imported from (link or path), used to refresh it'),
  ('imported_projects', 'source_label', 'name of the import source shown in the list'),
  ('imported_projects', 'content_type', 'status or type value set by the system'),
  ('imported_projects', 'files', 'file names and sizes of an import, not their content'),
  ('imported_projects', 'content_sha256', 'keyed fingerprint (DATA_KEY), no content'),
  ('imported_projects', 'last_check', 'system-written result of the last refresh check'),
  ('imported_projects', 'sync_error', 'error text, scrubbed of secrets before it is stored'),
  ('integration_snapshots', 'provider', 'name of an action, provider, model or rule'),
  ('integration_snapshots', 'kind', 'status or type value set by the system'),
  ('integration_snapshots', 'error', 'error text, scrubbed of secrets before it is stored'),
  ('knowledge_base_entries', 'action_type_pattern', 'rule data the gate matches against actions'),
  ('knowledge_base_entries', 'provider', 'name of an action, provider, model or rule'),
  ('missions', 'attachment_urls', 'links to files the user attached (public asset links)'),
  ('missions', 'status', 'status or type value set by the system'),
  ('outer_control_completion_checks', 'outcome', 'status or type value set by the system'),
  ('outer_control_completion_checks', 'criteria', 'system-written checklist results (labels and pass/fail), no user content'),
  ('outer_control_completion_checks', 'output_sha256', 'published result fingerprint (SHA-256), shown to the customer by design'),
  ('outer_control_evaluations', 'source_model', 'name of an action, provider, model or rule'),
  ('outer_control_evaluations', 'content_kind', 'status or type value set by the system'),
  ('outer_control_evaluations', 'verdict', 'status or type value set by the system'),
  ('outer_control_evaluations', 'action_type', 'name of an action, provider, model or rule'),
  ('outer_control_evaluations', 'action_provider', 'name of an action, provider, model or rule'),
  ('outer_control_evaluations', 'action_params', 'action parameters: the same data as agent_decisions.params, which the signed decision trail verifies in the database'),
  ('outer_control_evaluations', 'corrected_params', 'action parameters: the same data as agent_decisions.modified_params, which the signed decision trail verifies in the database'),
  ('outer_control_evaluations', 'execution_ref', 'id, hash or reference, no content'),
  ('outer_control_evaluations', 'execution_url', 'link to the result in the connected tool'),
  ('outer_control_evaluations', 'external_id', 'id, hash or reference, no content'),
  ('outer_control_evaluations', 'content_hash', 'keyed fingerprint (DATA_KEY), no content'),
  ('outer_control_memory', 'kind', 'status or type value set by the system'),
  ('outer_control_memory', 'rule_names', 'name of an action, provider, model or rule'),
  ('outer_control_session_steps', 'tool_status', 'status or type value set by the system'),
  ('outer_control_session_steps', 'error', 'error text, scrubbed of secrets before it is stored'),
  ('outer_control_session_steps', 'verdict', 'status or type value set by the system'),
  ('outer_control_session_steps', 'next_action', 'status or type value set by the system'),
  ('outer_control_sessions', 'status', 'status or type value set by the system'),
  ('outer_control_sessions', 'stop_reason', 'system-written reason a session stopped'),
  ('outer_control_sessions', 'pending_kind', 'status or type value set by the system'),
  ('outer_control_sessions', 'depends_on', 'id, hash or reference, no content'),
  ('outer_control_sessions', 'on_failure', 'status or type value set by the system'),
  ('outer_control_sessions', 'condition', 'branching rule the engine evaluates (operator and leg number)'),
  ('outer_control_sessions', 'request_mods', 'constraints the engine adds to a request, generated from the account rules'),
  ('outer_control_sessions', 'completion', 'system-written checklist result and published fingerprint'),
  ('outer_control_sessions', 'handoff_mode', 'status or type value set by the system'),
  ('outer_control_workflows', 'status', 'status or type value set by the system'),
  ('outer_control_workflows', 'kind', 'status or type value set by the system'),
  ('outer_control_workflows', 'origin', 'where a Task came from (ids and type), no content'),
  ('outer_control_workflows', 'stop_reason', 'system-written reason a Task stopped'),
  ('outer_control_workflows', 'mode', 'status or type value set by the system'),
  ('outer_control_workflows', 'blocked_reason', 'system-written reason a Task is blocked'),
  ('pending_approvals', 'action_type', 'name of an action, provider, model or rule'),
  ('pending_approvals', 'provider', 'name of an action, provider, model or rule'),
  ('pending_approvals', 'params', 'action parameters: the same data as agent_decisions.params, which the signed decision trail verifies in the database'),
  ('pending_approvals', 'reason', 'system-written gate explanation'),
  ('pending_approvals', 'risk_tier', 'status or type value set by the system'),
  ('pending_approvals', 'origin', 'status or type value set by the system'),
  ('pending_approvals', 'approver_role', 'status or type value set by the system'),
  ('pending_approvals', 'approvals', 'who signed off and when (ids and votes), read by record_approval_signoff'),
  ('pending_approvals', 'status', 'status or type value set by the system'),
  ('pending_approvals', 'reason_code', 'status or type value set by the system'),
  ('pending_approvals', 'plan_id', 'id, hash or reference, no content'),
  ('pending_approvals', 'execution_error', 'error text, scrubbed of secrets before it is stored'),
  ('website_form_submissions', 'page_slug', 'id, hash or reference, no content'),
  ('website_form_submissions', 'section_kind', 'status or type value set by the system')
) AS v(t, c, r)
ON CONFLICT (table_name, column_name) DO UPDATE SET reason = EXCLUDED.reason;

/** The text and JSON columns of every table that holds encrypted content which are neither encrypted nor exempt. */
CREATE OR REPLACE FUNCTION public.encryption_coverage_report()
RETURNS TABLE(table_name text, column_name text, data_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.table_name::text, c.column_name::text, c.data_type::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name IN (SELECT e.table_name FROM public.encrypted_columns e)
    AND (c.data_type IN ('text', 'jsonb', 'json', 'character varying') OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))
    AND c.column_name NOT LIKE '%\_enc'
    AND NOT EXISTS (SELECT 1 FROM public.encrypted_columns e WHERE e.table_name = c.table_name AND e.column_name = c.column_name)
    AND NOT EXISTS (SELECT 1 FROM public.encryption_exempt_columns x WHERE x.table_name = c.table_name AND x.column_name = c.column_name)
  ORDER BY 1, 2;
$$;
REVOKE ALL ON FUNCTION public.encryption_coverage_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encryption_coverage_report() TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. The weekly check: an open platform incident while anything is left in the clear or uncovered; closed once both are clear.
CREATE OR REPLACE FUNCTION public.encryption_weekly_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE plain jsonb; uncovered jsonb; open_id uuid; result jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'plain_rows', plain_rows)), '[]')
    INTO plain FROM public.encryption_report() WHERE plain_rows > 0;
  SELECT coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'type', data_type)), '[]')
    INTO uncovered FROM public.encryption_coverage_report();
  result := jsonb_build_object('plain', plain, 'uncovered', uncovered, 'checked_at', now());
  SELECT id INTO open_id FROM public.platform_incidents WHERE kind = 'encryption_check' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF jsonb_array_length(plain) > 0 OR jsonb_array_length(uncovered) > 0 THEN
    IF open_id IS NULL THEN
      INSERT INTO public.platform_incidents (kind, summary, detail) VALUES ('encryption_check',
        format('Data encryption check: %s column(s) with plain values left, %s content column(s) neither encrypted nor exempt. '
          || 'Plain values are converted by outer-control-session-sweep within minutes; an uncovered column needs an _enc twin or an entry in encryption_exempt_columns (docs/data-encryption.md).',
          jsonb_array_length(plain), jsonb_array_length(uncovered)), result);
    ELSE
      UPDATE public.platform_incidents SET detail = result WHERE id = open_id;
    END IF;
  ELSIF open_id IS NOT NULL THEN
    UPDATE public.platform_incidents SET resolved_at = now(), resolution_note = 'All listed columns encrypted and every content column covered.' WHERE id = open_id;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.encryption_weekly_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encryption_weekly_check() TO service_role;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  -- A named job is replaced in place when it already exists.
  PERFORM cron.schedule('encryption-weekly-check', '43 3 * * 1', 'SELECT public.encryption_weekly_check()');
END $$;

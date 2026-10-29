-- Data encryption, front 3: Outer Control content is stored encrypted by the edge functions (DATA_KEY, _shared/encrypted-db.ts).
-- For each column below an encrypted twin "<col>_enc" is added; the server writes the twin and leaves "<col>" empty (null), reads
-- prefer the twin, and the session sweep converts existing rows. docs/data-encryption.md describes the pattern.
--
-- What the database itself read from these columns, and how it changes:
--   * the completed guards checked the final result's text; for an encrypted result they check that the encrypted result and
--     artifact are there and that the completion checklist passed (the server builds and verifies the artifact before saving it);
--   * outer_control_tool_usage counted requests by "request IS NOT NULL"; it now counts an encrypted request too.
-- Nothing else in SQL reads them (functions, views, triggers and policies were checked).

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('outer_control_sessions', 'objective'), ('outer_control_sessions', 'context'), ('outer_control_sessions', 'correction'),
    ('outer_control_sessions', 'history'), ('outer_control_sessions', 'next_input'), ('outer_control_sessions', 'final_output'),
    ('outer_control_sessions', 'pending_question'), ('outer_control_sessions', 'pending_answer'), ('outer_control_sessions', 'final_artifact'),
    ('outer_control_session_steps', 'request'), ('outer_control_session_steps', 'reply_text'), ('outer_control_session_steps', 'note'),
    ('outer_control_evaluations', 'input_excerpt'), ('outer_control_evaluations', 'output_text'), ('outer_control_evaluations', 'summary'),
    ('outer_control_evaluations', 'next_step'), ('outer_control_evaluations', 'changes'),
    ('outer_control_workflows', 'objective'), ('outer_control_workflows', 'context'), ('outer_control_workflows', 'summary'),
    ('outer_control_workflows', 'final_output'), ('outer_control_workflows', 'final_artifact'), ('outer_control_workflows', 'goal_pool'),
    ('outer_control_memory', 'summary'), ('outer_control_memory', 'data'),
    ('outer_control_completion_checks', 'summary')
  ) AS v(t, c) LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text', r.t, r.c || '_enc');
    -- An emptied column holds null, so the ones that could not be null now can.
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    INSERT INTO public.encrypted_columns (table_name, column_name, note)
    VALUES (r.t, r.c, 'Outer Control content; encrypted with DATA_KEY (encrypted-db.ts).')
    ON CONFLICT (table_name, column_name) DO NOTHING;
  END LOOP;
END $$;

-- A safety net: a write that puts plain text into one of these columns (any path that does not encrypt) clears the encrypted
-- twin, so the newer plain value is what is read, never an older encrypted one. The sweep encrypts it again shortly after.
CREATE OR REPLACE FUNCTION public.field_encryption_plain_wins()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE col text; j jsonb := to_jsonb(NEW); changed boolean := false;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF j ? col AND jsonb_typeof(j -> col) <> 'null' AND (j ->> (col || '_enc')) IS NOT NULL THEN
      j := jsonb_set(j, ARRAY[col || '_enc'], 'null'::jsonb);
      changed := true;
    END IF;
  END LOOP;
  IF changed THEN NEW := jsonb_populate_record(NEW, j); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS outer_control_sessions_plain_wins ON public.outer_control_sessions;
CREATE TRIGGER outer_control_sessions_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_sessions FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('objective', 'context', 'correction', 'history', 'next_input', 'final_output', 'pending_question', 'pending_answer', 'final_artifact');
DROP TRIGGER IF EXISTS outer_control_session_steps_plain_wins ON public.outer_control_session_steps;
CREATE TRIGGER outer_control_session_steps_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_session_steps FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('request', 'reply_text', 'note');
DROP TRIGGER IF EXISTS outer_control_evaluations_plain_wins ON public.outer_control_evaluations;
CREATE TRIGGER outer_control_evaluations_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_evaluations FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('input_excerpt', 'output_text', 'summary', 'next_step', 'changes');
DROP TRIGGER IF EXISTS outer_control_workflows_plain_wins ON public.outer_control_workflows;
CREATE TRIGGER outer_control_workflows_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_workflows FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('objective', 'context', 'summary', 'final_output', 'final_artifact', 'goal_pool');
DROP TRIGGER IF EXISTS outer_control_memory_plain_wins ON public.outer_control_memory;
CREATE TRIGGER outer_control_memory_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_memory FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('summary', 'data');
DROP TRIGGER IF EXISTS outer_control_completion_checks_plain_wins ON public.outer_control_completion_checks;
CREATE TRIGGER outer_control_completion_checks_plain_wins BEFORE INSERT OR UPDATE ON public.outer_control_completion_checks FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('summary');

-- The completed guards: unchanged for a plain result; for an encrypted one, the result, its artifact and (sessions) a passing
-- checklist with the result's fingerprint must all be there.
CREATE OR REPLACE FUNCTION public.guard_outer_control_completed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    IF NEW.completion IS NULL
       OR COALESCE((NEW.completion ->> 'passed')::boolean, false) IS NOT TRUE
       OR NEW.completion ->> 'outcome' IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'outer_control: a session cannot be completed without a passing completion checklist'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.final_output_enc IS NOT NULL THEN
      IF NEW.final_artifact_enc IS NULL OR NEW.completion ->> 'output_sha256' IS NULL THEN
        RAISE EXCEPTION 'outer_control: a session cannot be completed without a matching final artifact'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.final_output IS NULL OR btrim(NEW.final_output) = '' THEN
      RAISE EXCEPTION 'outer_control: a session cannot be completed without a final result'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.final_artifact IS NULL
       OR NEW.final_artifact ->> 'kind' IS DISTINCT FROM 'session'
       OR NEW.final_artifact ->> 'final_output' IS DISTINCT FROM NEW.final_output
       OR NEW.final_artifact ->> 'output_sha256' IS DISTINCT FROM NEW.completion ->> 'output_sha256'
       OR jsonb_typeof(NEW.final_artifact -> 'human_text') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'outer_control: a session cannot be completed without a matching final artifact'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_outer_control_task_completed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    IF NEW.final_output_enc IS NOT NULL THEN
      IF NEW.final_artifact_enc IS NULL THEN
        RAISE EXCEPTION 'outer_control: a task cannot be completed without a matching final artifact'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.final_output IS NULL OR btrim(NEW.final_output) = '' THEN
      RAISE EXCEPTION 'outer_control: a task cannot be completed without a final result'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.final_artifact IS NULL
       OR NEW.final_artifact ->> 'kind' IS DISTINCT FROM 'task'
       OR NEW.final_artifact ->> 'final_output' IS DISTINCT FROM NEW.final_output
       OR COALESCE((NEW.final_artifact -> 'proof' ->> 'all_checklists_passed')::boolean, false) IS NOT TRUE
       OR jsonb_typeof(NEW.final_artifact -> 'human_text') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'outer_control: a task cannot be completed without a matching final artifact'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE VIEW public.outer_control_tool_usage WITH (security_invoker = true) AS
 SELECT s.user_id,
    s.tool_id,
    count(*) FILTER (WHERE (st.created_at >= (now() - '30 days'::interval))) AS requests_30d,
    count(*) FILTER (WHERE ((st.created_at >= (now() - '30 days'::interval)) AND ((st.error IS NOT NULL) OR (COALESCE(st.http_status, 200) >= 400)))) AS failed_30d,
    count(*) FILTER (WHERE (st.created_at >= date_trunc('day'::text, now()))) AS requests_today,
    max(st.created_at) AS last_request_at
   FROM (public.outer_control_session_steps st
     JOIN public.outer_control_sessions s ON ((s.id = st.session_id)))
  WHERE (st.request IS NOT NULL OR st.request_enc IS NOT NULL)
  GROUP BY s.user_id, s.tool_id;

-- Outer Control: a Task is "completed" only when the steps behind it really finished (docs/outer-control-completion.md).
-- The Task guard could not read the encrypted final artifact, so for encrypted rows it only checked that some result and some
-- artifact existed. It now also looks at the steps: none may still be open, and at least one must have finished with a passing
-- completion check. Only the move INTO 'completed' is checked; Tasks already completed are untouched.
CREATE OR REPLACE FUNCTION public.guard_outer_control_task_completed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    IF EXISTS (SELECT 1 FROM public.outer_control_sessions s WHERE s.workflow_id = NEW.id AND s.status IN ('queued', 'running', 'awaiting_human')) THEN
      RAISE EXCEPTION 'outer_control: a task cannot be completed while a step is still open'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.outer_control_sessions s
                    WHERE s.workflow_id = NEW.id AND s.status = 'completed'
                      AND COALESCE((s.completion ->> 'passed')::boolean, false) IS TRUE) THEN
      RAISE EXCEPTION 'outer_control: a task cannot be completed without a step that finished with a passing completion check'
        USING ERRCODE = 'check_violation';
    END IF;
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
END $function$;

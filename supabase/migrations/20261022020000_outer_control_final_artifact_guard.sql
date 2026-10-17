-- Outer Control: the database refuses "completed" without a valid final artifact.
--
-- Applied AFTER the code that writes the artifact is deployed (older code would be refused). Only the move INTO
-- 'completed' is checked; rows that were already completed are left as they are (the app shows them as not accepted).

CREATE OR REPLACE FUNCTION public.guard_outer_control_completed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    IF NEW.completion IS NULL
       OR COALESCE((NEW.completion ->> 'passed')::boolean, false) IS NOT TRUE
       OR NEW.completion ->> 'outcome' IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'outer_control: a session cannot be completed without a passing completion checklist'
        USING ERRCODE = 'check_violation';
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
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_outer_control_task_completed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
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
END;
$$;

CREATE OR REPLACE TRIGGER outer_control_task_completed_guard
  BEFORE UPDATE ON public.outer_control_workflows
  FOR EACH ROW EXECUTE FUNCTION public.guard_outer_control_task_completed();

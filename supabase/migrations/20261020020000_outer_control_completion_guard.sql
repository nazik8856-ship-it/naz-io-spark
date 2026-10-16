-- Outer Control: the database refuses "completed" without a passing completion checklist.
--
-- Applied AFTER the session code that writes the checklist is deployed. Only the move INTO 'completed' is
-- checked; sessions that were already completed are untouched.

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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outer_control_completed_guard ON public.outer_control_sessions;
CREATE TRIGGER outer_control_completed_guard
  BEFORE UPDATE ON public.outer_control_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_outer_control_completed();

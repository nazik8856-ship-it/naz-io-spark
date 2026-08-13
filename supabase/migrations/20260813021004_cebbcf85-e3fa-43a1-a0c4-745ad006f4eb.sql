
CREATE OR REPLACE FUNCTION public.guard_decision_human_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.human_response IS NOT NULL THEN
    RAISE EXCEPTION 'A human response has already been recorded for this decision';
  END IF;
  IF NEW.human_response IS NULL THEN
    RAISE EXCEPTION 'Only a human response can be recorded on a decision';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.agent_id, NEW.agent_run_id, NEW.decision, NEW.reasoning,
      NEW.alternatives_considered, NEW.confidence_score, NEW.created_at, NEW.source,
      NEW.escalated, NEW.signature, NEW.policy_version, NEW.override_of, NEW.step_index, NEW.org_id)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.agent_id, OLD.agent_run_id, OLD.decision, OLD.reasoning,
      OLD.alternatives_considered, OLD.confidence_score, OLD.created_at, OLD.source,
      OLD.escalated, OLD.signature, OLD.policy_version, OLD.override_of, OLD.step_index, OLD.org_id) THEN
    RAISE EXCEPTION 'Decision records are append-only; only human_response may be recorded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_decision_human_response ON public.agent_decisions;
CREATE TRIGGER guard_decision_human_response
BEFORE UPDATE ON public.agent_decisions
FOR EACH ROW EXECUTE FUNCTION public.guard_decision_human_response();

GRANT UPDATE (human_response) ON public.agent_decisions TO authenticated;

DROP POLICY IF EXISTS "Users can record a human response on their decisions" ON public.agent_decisions;
CREATE POLICY "Users can record a human response on their decisions"
ON public.agent_decisions FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND human_response IS NULL)
WITH CHECK (auth.uid() = user_id AND human_response IS NOT NULL);

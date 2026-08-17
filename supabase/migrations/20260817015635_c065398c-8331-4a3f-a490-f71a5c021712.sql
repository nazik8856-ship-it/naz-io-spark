-- Guard: clients may not directly mutate quorum-bearing fields.
CREATE OR REPLACE FUNCTION public.guard_pending_approval_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.approval_signoff', true), '') = '1'
     OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.approvals IS DISTINCT FROM OLD.approvals
     OR NEW.required_approvals IS DISTINCT FROM OLD.required_approvals
     OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
     OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN
    RAISE EXCEPTION 'Approvals must be recorded through record_approval_signoff()';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_pending_approval_update_trg ON public.pending_approvals;
CREATE TRIGGER guard_pending_approval_update_trg
BEFORE UPDATE ON public.pending_approvals
FOR EACH ROW EXECUTE FUNCTION public.guard_pending_approval_update();

-- Records one distinct human sign-off (or a rejection) and only flips the row to
-- approved once the required number of DISTINCT approvers is reached.
CREATE OR REPLACE FUNCTION public.record_approval_signoff(
  _approval_id uuid,
  _vote text,
  _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.pending_approvals;
  uid uuid := auth.uid();
  prior jsonb;
  distinct_count int;
  needed int;
  new_status text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _vote NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'vote must be approve or reject'; END IF;

  SELECT * INTO r FROM public.pending_approvals WHERE id = _approval_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Approval not found'; END IF;
  IF r.user_id IS DISTINCT FROM uid AND NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'owner') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('status', r.status, 'approvals', jsonb_array_length(r.approvals),
      'required', r.required_approvals, 'already_resolved', true);
  END IF;

  needed := greatest(1, coalesce(r.required_approvals, 1));

  IF _vote = 'reject' THEN
    prior := r.approvals;
    new_status := 'rejected';
    distinct_count := (SELECT count(DISTINCT e->>'by') FROM jsonb_array_elements(prior) e);
  ELSE
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.approvals) e WHERE e->>'by' = uid::text) THEN
      RAISE EXCEPTION 'You have already signed off on this action';
    END IF;
    prior := r.approvals || jsonb_build_array(jsonb_build_object('by', uid::text, 'at', now()));
    distinct_count := (SELECT count(DISTINCT e->>'by') FROM jsonb_array_elements(prior) e);
    new_status := CASE WHEN distinct_count >= needed THEN 'approved' ELSE 'pending' END;
  END IF;

  PERFORM set_config('app.approval_signoff', '1', true);
  UPDATE public.pending_approvals
     SET approvals = prior,
         status = new_status,
         comment = coalesce(nullif(left(coalesce(_comment, ''), 800), ''), comment),
         resolved_by = CASE WHEN new_status = 'pending' THEN NULL ELSE uid END,
         resolved_at = CASE WHEN new_status = 'pending' THEN NULL ELSE now() END
   WHERE id = _approval_id;
  PERFORM set_config('app.approval_signoff', '0', true);

  RETURN jsonb_build_object(
    'status', new_status,
    'approvals', distinct_count,
    'required', needed,
    'remaining', greatest(0, needed - distinct_count),
    'quorum_met', new_status = 'approved'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_approval_signoff(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_approval_signoff(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_approval_signoff(uuid, text, text) TO service_role;
-- "Knowledge & autonomy" plan, item 2: capture a structured reason
-- every time a human resolves an escalated decision, instead of only
-- ever a free-text comment nobody can aggregate. This is the raw
-- material item 3 uses to detect a real, recurring gap in what NazAI
-- knows and draft a knowledge-base entry (item 1) from it.
--
-- Confirmed: pending_approvals.comment (record_approval_signoff, first
-- defined 20260817015635...sql, redefined 20260819080000...sql) is the
-- only human-authored text captured on resolution today -- free text,
-- no taxonomy. Deliberately optional on every resolution (approve OR
-- reject), not just reject -- a human might record why they approved
-- despite a flagged risk just as usefully as why they rejected.
ALTER TABLE public.pending_approvals
  ADD COLUMN IF NOT EXISTS reason_code text
    CHECK (reason_code IS NULL OR reason_code IN (
      'missing_context', 'policy_too_strict', 'policy_too_loose',
      'model_misjudged_risk', 'precedent_outdated', 'one_off_exception', 'other'
    ));

-- Extends record_approval_signoff (the one real write path onto
-- pending_approvals.status/comment a human resolution goes through,
-- src/pages/ControlApprovals.tsx's own record_approval_signoff RPC
-- call) with an optional _reason_code parameter, stored the exact same
-- "only overwrite on a real resolution, never on a partial quorum
-- sign-off" way _comment already is. Scoped deliberately to this one
-- RPC, not agent-approval's separate per-agent agent_events queue --
-- that's a different, older guardrail queue unrelated to the Control
-- API escalation path this whole plan is about.
CREATE OR REPLACE FUNCTION public.record_approval_signoff(_approval_id uuid, _vote text, _comment text DEFAULT NULL::text, _reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF _reason_code IS NOT NULL AND _reason_code NOT IN (
    'missing_context', 'policy_too_strict', 'policy_too_loose',
    'model_misjudged_risk', 'precedent_outdated', 'one_off_exception', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid reason_code';
  END IF;

  SELECT * INTO r FROM public.pending_approvals WHERE id = _approval_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Approval not found'; END IF;
  IF r.user_id IS DISTINCT FROM uid
     AND NOT public.has_role(uid, 'admin')
     AND NOT public.has_role(uid, 'owner')
     AND NOT public.is_account_member(r.user_id, 'approver') THEN
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
         reason_code = CASE WHEN new_status <> 'pending' THEN coalesce(_reason_code, reason_code) ELSE reason_code END,
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
$function$;

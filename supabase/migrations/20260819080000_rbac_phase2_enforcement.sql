-- RBAC Phase 2: wire account_members roles into real enforcement.
-- Phase 1 (account_members table, invite/accept flow, team page) only ever
-- created memberships — nothing checked them. This phase adds a single
-- reusable helper and extends the two places that currently gate real
-- actions (approval sign-off, kill switch), plus grants team members read
-- access to the account owner's governance data via ADDITIVE SELECT
-- policies (Postgres OR's multiple permissive policies for the same
-- command together, so the existing owner-only policies are untouched).

-- Role hierarchy: owner > approver > viewer. _min_role is the minimum
-- role required; NULL means "any active membership qualifies".
CREATE OR REPLACE FUNCTION public.is_account_member(_account_owner_id uuid, _min_role text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE account_owner_id = _account_owner_id
      AND member_id = auth.uid()
      AND status = 'active'
      AND (
        _min_role IS NULL
        OR (_min_role = 'viewer')
        OR (_min_role = 'approver' AND role IN ('approver', 'owner'))
        OR (_min_role = 'owner' AND role = 'owner')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, text) TO authenticated;

-- 1. Approval sign-off: an active team member with role approver/owner can
-- now co-sign the account owner's pending approvals, same as the existing
-- global admin/owner staff roles already could.
CREATE OR REPLACE FUNCTION public.record_approval_signoff(_approval_id uuid, _vote text, _comment text DEFAULT NULL::text)
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

-- 2. Kill switch: an active team member with role owner can now flip the
-- account's kill switch, same as the existing global "owner" staff role.
CREATE OR REPLACE FUNCTION public.guard_kill_switch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.kill_switch is distinct from old.kill_switch
     and auth.role() <> 'service_role'
     and not public.has_role(auth.uid(), 'owner')
     and not public.is_account_member(old.id, 'owner') then
    raise exception 'not authorized to change kill switch';
  end if;
  return new;
end;
$function$;

-- 3. Read access: active team members (any role) can see the account
-- owner's governance data. Additive SELECT policies alongside the
-- existing owner-only ones -- Postgres OR's same-command policies
-- together, so nothing already granted is narrowed.
CREATE POLICY "Team members can view owner's pending approvals" ON public.pending_approvals
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team members can view owner's agent decisions" ON public.agent_decisions
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team members can view owner's incidents" ON public.incidents
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team members can view owner's agent events" ON public.agent_events
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team members can view owner's agents" ON public.agents
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team members can view owner's hard rules" ON public.hard_rules
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team members can view owner's safety rules" ON public.safety_rules
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team members can view owner's policy versions" ON public.policy_versions
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

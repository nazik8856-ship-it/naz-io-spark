-- Wave 5, session 3: approval delegation, OOO auto-reassignment, and a
-- real escalation-chain timeline.
--
-- Deliberate scope: `assigned_to` is a ROUTING field only -- it does NOT
-- change who is AUTHORIZED to sign off on an approval. Authorization stays
-- exactly what record_approval_signoff already enforces (the account
-- owner, or an active approver/owner team member) -- reassignment just
-- changes whose queue an approval shows up in and who gets nudged, it
-- never narrows or widens who can actually act on it. This keeps the
-- change additive to the human workflow without touching the
-- authorization logic in the safety-critical sign-off path.
ALTER TABLE public.pending_approvals
  ADD COLUMN assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Out-of-office: settable by the account owner for their own team members
-- (same "Owners manage their own team" RLS policy already covers these new
-- columns, no policy change needed). Scoped out for this pass: the account
-- owner's own OOO status -- they're the account, not a member of it, and
-- adding a symmetric mechanism for them roughly doubles this schema for
-- comparatively low value today. A real, separate future item if needed.
ALTER TABLE public.account_members
  ADD COLUMN ooo_until timestamptz,
  ADD COLUMN ooo_fallback_member_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Escalation chain visibility: today a pending approval only ever has a
-- single escalated_at flag, no history. This table gives each approval a
-- real, ordered timeline: who it was (re)assigned to and when, and when it
-- was escalated -- "created" and "resolved" are already fully described by
-- pending_approvals' own created_at/resolved_at/status/resolved_by, so
-- they're read directly from there, not duplicated here.
CREATE TABLE public.pending_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES public.pending_approvals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- account owner, for RLS scoping (same pattern as config_changes)
  event_type text NOT NULL CHECK (event_type IN ('assigned', 'escalated')),
  actor_id uuid, -- who did it; null for the automated escalation sweep
  target_id uuid, -- who it was (re)assigned to, for 'assigned' events; null for 'escalated'
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pending_approval_events_approval ON public.pending_approval_events (approval_id, created_at);

GRANT SELECT ON public.pending_approval_events TO authenticated;
GRANT ALL ON public.pending_approval_events TO service_role;

ALTER TABLE public.pending_approval_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account owner and team can view approval events"
ON public.pending_approval_events FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_account_member(user_id));

-- Reassign a pending approval. Same authorization tier as
-- record_approval_signoff's co-sign check (account owner, global admin/
-- owner staff role, or an active approver/owner team member) -- delegation
-- is a peer operation to signing off, not a separate, looser privilege.
CREATE OR REPLACE FUNCTION public.reassign_pending_approval(_approval_id uuid, _assigned_to uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.pending_approvals;
  uid uuid := auth.uid();
  v_target uuid := _assigned_to;
  v_ooo_until timestamptz;
  v_fallback uuid;
  v_original uuid;
  v_redirected boolean := false;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO r FROM public.pending_approvals WHERE id = _approval_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Approval not found'; END IF;
  IF r.user_id IS DISTINCT FROM uid
     AND NOT public.has_role(uid, 'admin')
     AND NOT public.has_role(uid, 'owner')
     AND NOT public.is_account_member(r.user_id, 'approver') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending approvals can be reassigned';
  END IF;

  IF v_target IS NOT NULL THEN
    IF v_target <> r.user_id AND NOT EXISTS (
      SELECT 1 FROM public.account_members
      WHERE account_owner_id = r.user_id AND member_id = v_target AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Assignee must be the account owner or an active team member';
    END IF;

    -- Auto-redirect to a fallback if the target is currently out of office
    -- (never applies to the account owner -- they have no account_members
    -- row for their own account).
    IF v_target <> r.user_id THEN
      SELECT ooo_until, ooo_fallback_member_id INTO v_ooo_until, v_fallback
      FROM public.account_members
      WHERE account_owner_id = r.user_id AND member_id = v_target AND status = 'active';

      IF v_ooo_until IS NOT NULL AND v_ooo_until > now() AND v_fallback IS NOT NULL THEN
        v_original := v_target;
        v_target := v_fallback;
        v_redirected := true;
        -- The fallback itself must also be a valid assignee -- if not,
        -- give up on the redirect and keep the original assignment rather
        -- than silently routing to nobody.
        IF v_target <> r.user_id AND NOT EXISTS (
          SELECT 1 FROM public.account_members
          WHERE account_owner_id = r.user_id AND member_id = v_target AND status = 'active'
        ) THEN
          v_target := v_original;
          v_redirected := false;
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.pending_approvals SET assigned_to = v_target WHERE id = _approval_id;

  INSERT INTO public.pending_approval_events (approval_id, user_id, event_type, actor_id, target_id, note)
  VALUES (_approval_id, r.user_id, 'assigned', uid, v_target,
    CASE WHEN v_redirected THEN 'Auto-redirected: the original assignee is out of office' ELSE NULL END);

  RETURN jsonb_build_object('assigned_to', v_target, 'redirected', v_redirected);
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_pending_approval(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reassign_pending_approval(uuid, uuid) TO authenticated;

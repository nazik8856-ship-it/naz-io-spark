-- Dual control on policy changes themselves: today any account owner (or
-- team owner) can unilaterally flip a hard rule from shadow to live, with
-- no second check -- a real gap once a hard rule going live is a
-- meaningfully consequential action. Opt-in per account
-- (profiles.require_dual_control_for_policy). When on, promoting a hard
-- rule creates a request instead of applying immediately; a SECOND
-- owner-tier person must approve it before it actually takes effect.
--
-- Deliberately a SEPARATE, purpose-built mechanism, not a repurposing of
-- pending_approvals: that table's documented, tested authorization tier
-- is "any active approver-or-owner team member can co-sign" (ControlTeam.tsx:
-- "Approvers can also co-sign pending approvals") -- appropriate for
-- routine action approvals, but weaker than what "dual control on policy
-- changes" should mean. Reusing it as-is would silently let a mere
-- approver-tier member confirm a change meant to require a second OWNER.
--
-- Scoped to exactly ONE change_type this pass: promoting a hard rule from
-- shadow to live (shadow_mode: true -> false) -- the clearest, highest-
-- value case. Extending to safety-rule-enabling, spend-cap changes, or
-- strictness changes is the same pattern, not yet wired up.
ALTER TABLE public.profiles
  ADD COLUMN require_dual_control_for_policy boolean NOT NULL DEFAULT false;

CREATE TABLE public.policy_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('promote_hard_rule')),
  row_id uuid NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rejected', 'executed')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_policy_change_requests_user_status ON public.policy_change_requests (user_id, status, created_at DESC);

GRANT SELECT ON public.policy_change_requests TO authenticated;
GRANT ALL ON public.policy_change_requests TO service_role;

ALTER TABLE public.policy_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account owner and team can view policy change requests"
ON public.policy_change_requests FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_account_member(user_id));

-- Settings change log: audit the toggle itself.
CREATE TRIGGER log_profiles_dual_control_changes
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.require_dual_control_for_policy IS DISTINCT FROM NEW.require_dual_control_for_policy)
  EXECUTE FUNCTION public.log_config_change();

-- Request: creatable by whoever can already promote a hard rule directly
-- (the account owner, or an owner-tier team member) -- dual control adds
-- a second confirmation, it doesn't loosen who can initiate a change.
CREATE OR REPLACE FUNCTION public.request_policy_change(_change_type text, _row_id uuid, _description text DEFAULT '')
RETURNS public.policy_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  v_owner_id uuid;
  created public.policy_change_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _change_type <> 'promote_hard_rule' THEN RAISE EXCEPTION 'Unsupported change_type'; END IF;

  SELECT user_id INTO v_owner_id FROM public.hard_rules WHERE id = _row_id;
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
  IF v_owner_id <> uid AND NOT public.is_account_member(v_owner_id, 'owner') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.policy_change_requests (user_id, requested_by, change_type, row_id, description)
  VALUES (v_owner_id, uid, _change_type, _row_id, _description)
  RETURNING * INTO created;
  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.request_policy_change(text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_policy_change(text, uuid, text) TO authenticated;

-- Approve + execute atomically: only a DIFFERENT owner-tier person than
-- the requester can approve -- the requester approving their own request
-- would defeat the entire point of a second confirmation.
CREATE OR REPLACE FUNCTION public.approve_policy_change(_request_id uuid)
RETURNS public.policy_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  r public.policy_change_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO r FROM public.policy_change_requests WHERE id = _request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.user_id <> uid AND NOT public.is_account_member(r.user_id, 'owner') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF r.requested_by = uid THEN
    RAISE EXCEPTION 'A second, different owner must approve this -- you cannot approve your own request';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %', r.status;
  END IF;

  IF r.change_type = 'promote_hard_rule' THEN
    UPDATE public.hard_rules SET shadow_mode = false, promoted_at = now() WHERE id = r.row_id;
  END IF;

  UPDATE public.policy_change_requests
     SET status = 'executed', approved_by = uid, approved_at = now()
   WHERE id = _request_id
   RETURNING * INTO r;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_policy_change(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_policy_change(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_policy_change(_request_id uuid)
RETURNS public.policy_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  r public.policy_change_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO r FROM public.policy_change_requests WHERE id = _request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.user_id <> uid AND NOT public.is_account_member(r.user_id, 'owner') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %', r.status;
  END IF;

  UPDATE public.policy_change_requests
     SET status = 'rejected', approved_by = uid, approved_at = now()
   WHERE id = _request_id
   RETURNING * INTO r;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_policy_change(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reject_policy_change(uuid) TO authenticated;

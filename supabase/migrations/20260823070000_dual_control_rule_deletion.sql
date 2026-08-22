-- 2026-08-23 plan item 9: extend dual control to rule deletion.
-- HardRulesPanel.tsx::remove() and ControlSafetyRules.tsx::remove() both
-- do an unconditional .delete() today, unlike their own promote()
-- functions, which already branch on dualControl. No soft-delete column
-- is needed: policy_change_requests.row_id isn't an FK, so the row can be
-- snapshotted into new_value at REQUEST time (it still exists then) and
-- deleted for real only once a second owner approves it -- identical
-- shape to promote_hard_rule/promote_safety_rule's own row lookup.
ALTER TABLE public.policy_change_requests DROP CONSTRAINT IF EXISTS policy_change_requests_change_type_check;
ALTER TABLE public.policy_change_requests
  ADD CONSTRAINT policy_change_requests_change_type_check CHECK (
    change_type IN (
      'promote_hard_rule', 'promote_safety_rule', 'raise_spend_cap', 'change_strictness',
      'delete_hard_rule', 'delete_safety_rule'
    )
  );

CREATE OR REPLACE FUNCTION public.request_policy_change(
  _change_type text,
  _row_id uuid DEFAULT NULL,
  _description text DEFAULT '',
  _target_user_id uuid DEFAULT NULL,
  _agent_id uuid DEFAULT NULL,
  _new_value jsonb DEFAULT NULL
)
RETURNS public.policy_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  v_owner_id uuid;
  v_snapshot jsonb;
  created public.policy_change_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _change_type NOT IN (
    'promote_hard_rule', 'promote_safety_rule', 'raise_spend_cap', 'change_strictness',
    'delete_hard_rule', 'delete_safety_rule'
  ) THEN
    RAISE EXCEPTION 'Unsupported change_type';
  END IF;

  IF _change_type = 'promote_hard_rule' THEN
    SELECT user_id INTO v_owner_id FROM public.hard_rules WHERE id = _row_id;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
  ELSIF _change_type = 'promote_safety_rule' THEN
    SELECT user_id INTO v_owner_id FROM public.safety_rules WHERE id = _row_id;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
  ELSIF _change_type = 'raise_spend_cap' THEN
    IF _target_user_id IS NULL THEN RAISE EXCEPTION 'target_user_id required'; END IF;
    IF _new_value IS NULL OR (_new_value->>'daily_cap_usd') IS NULL THEN RAISE EXCEPTION 'new_value.daily_cap_usd required'; END IF;
    v_owner_id := _target_user_id;
  ELSIF _change_type = 'change_strictness' THEN
    IF _target_user_id IS NULL THEN RAISE EXCEPTION 'target_user_id required'; END IF;
    IF _new_value IS NULL OR (_new_value->>'strictness') NOT IN ('loose', 'balanced', 'strict') THEN
      RAISE EXCEPTION 'new_value.strictness must be loose, balanced, or strict';
    END IF;
    v_owner_id := _target_user_id;
  ELSIF _change_type = 'delete_hard_rule' THEN
    SELECT user_id, to_jsonb(t) INTO v_owner_id, v_snapshot FROM public.hard_rules t WHERE id = _row_id;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
    -- Snapshotted server-side, at request time, while the row still
    -- exists -- ignores any client-supplied _new_value so the record of
    -- what's being deleted can't be spoofed.
    _new_value := v_snapshot;
  ELSIF _change_type = 'delete_safety_rule' THEN
    SELECT user_id, to_jsonb(t) INTO v_owner_id, v_snapshot FROM public.safety_rules t WHERE id = _row_id;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
    _new_value := v_snapshot;
  END IF;

  -- Same authorization as before: creatable by whoever can already make
  -- this change directly (the account owner, or an owner-tier team
  -- member) -- dual control adds a second confirmation, it doesn't
  -- loosen who can initiate a change.
  IF v_owner_id <> uid AND NOT public.is_account_member(v_owner_id, 'owner') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.policy_change_requests (user_id, requested_by, change_type, row_id, agent_id, new_value, description)
  VALUES (v_owner_id, uid, _change_type, _row_id, _agent_id, _new_value, _description)
  RETURNING * INTO created;
  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.request_policy_change(text, uuid, text, uuid, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_policy_change(text, uuid, text, uuid, uuid, jsonb) TO authenticated;

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
  ELSIF r.change_type = 'promote_safety_rule' THEN
    UPDATE public.safety_rules SET shadow_mode = false, promoted_at = now() WHERE id = r.row_id;
  ELSIF r.change_type = 'raise_spend_cap' THEN
    IF r.agent_id IS NULL THEN
      INSERT INTO public.ai_spend_caps (user_id, daily_cap_usd)
      VALUES (r.user_id, (r.new_value->>'daily_cap_usd')::numeric)
      ON CONFLICT (user_id) WHERE agent_id IS NULL
      DO UPDATE SET daily_cap_usd = EXCLUDED.daily_cap_usd;
    ELSE
      INSERT INTO public.ai_spend_caps (user_id, agent_id, daily_cap_usd)
      VALUES (r.user_id, r.agent_id, (r.new_value->>'daily_cap_usd')::numeric)
      ON CONFLICT (user_id, agent_id) WHERE agent_id IS NOT NULL
      DO UPDATE SET daily_cap_usd = EXCLUDED.daily_cap_usd;
    END IF;
  ELSIF r.change_type = 'change_strictness' THEN
    IF r.agent_id IS NULL THEN
      UPDATE public.profiles SET control_strictness = (r.new_value->>'strictness') WHERE id = r.user_id;
    ELSE
      INSERT INTO public.agent_strictness_overrides (agent_id, user_id, strictness)
      VALUES (r.agent_id, r.user_id, (r.new_value->>'strictness'))
      ON CONFLICT (agent_id) DO UPDATE SET strictness = EXCLUDED.strictness, updated_at = now();
    END IF;
  ELSIF r.change_type = 'delete_hard_rule' THEN
    DELETE FROM public.hard_rules WHERE id = r.row_id;
  ELSIF r.change_type = 'delete_safety_rule' THEN
    DELETE FROM public.safety_rules WHERE id = r.row_id;
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

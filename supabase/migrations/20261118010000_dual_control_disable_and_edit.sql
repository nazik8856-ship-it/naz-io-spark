-- Dual control covered promoting and deleting a rule, but not switching it off or editing what it matches and does: either one
-- weakens a rule as much as deleting it, without a second owner. On an account with require_dual_control_for_policy, a person can
-- now only request those changes (disable_* / edit_* change types); a second, different owner's approval applies them.
-- Switching a rule ON, shadow and promotion handling (the existing guards) and the service role are unchanged.

ALTER TABLE public.policy_change_requests DROP CONSTRAINT IF EXISTS policy_change_requests_change_type_check;
ALTER TABLE public.policy_change_requests ADD CONSTRAINT policy_change_requests_change_type_check CHECK (change_type = ANY (ARRAY[
  'promote_hard_rule', 'promote_safety_rule', 'raise_spend_cap', 'change_strictness', 'delete_hard_rule', 'delete_safety_rule',
  'disable_hard_rule', 'disable_safety_rule', 'edit_hard_rule', 'edit_safety_rule'
]));

-- The columns that decide what a rule matches and what it does; an edit request may change only these.
CREATE OR REPLACE FUNCTION public.rule_edit_columns(_table text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _table
    WHEN 'hard_rules' THEN ARRAY['rule_text', 'action_type_pattern', 'effect', 'provider', 'required_approvals', 'agent_id', 'api_key_id']
    WHEN 'safety_rules' THEN ARRAY['name', 'pattern', 'severity', 'redact', 'category', 'agent_id', 'api_key_id']
    ELSE ARRAY[]::text[]
  END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_rule_weakening()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  col text;
BEGIN
  -- No signed-in caller (the service role, or a direct database session such as a migration) passes, as the existing guards do.
  IF coalesce(auth.role(), 'service_role') = 'service_role'
     OR coalesce(current_setting('app.approval_signoff', true), '') = '1'
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.require_dual_control_for_policy) THEN
    RETURN NEW;
  END IF;
  IF OLD.enabled IS DISTINCT FROM false AND NEW.enabled = false THEN
    RAISE EXCEPTION 'This account requires a second owner''s approval before a rule is switched off -- request the change instead.'
      USING ERRCODE = '42501';
  END IF;
  FOREACH col IN ARRAY public.rule_edit_columns(TG_TABLE_NAME) LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'This account requires a second owner''s approval before a rule is edited -- request the change instead.'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_hard_rule_weakening_trg ON public.hard_rules;
CREATE TRIGGER guard_hard_rule_weakening_trg BEFORE UPDATE ON public.hard_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_rule_weakening();
DROP TRIGGER IF EXISTS guard_safety_rule_weakening_trg ON public.safety_rules;
CREATE TRIGGER guard_safety_rule_weakening_trg BEFORE UPDATE ON public.safety_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_rule_weakening();

CREATE OR REPLACE FUNCTION public.request_policy_change(_change_type text, _row_id uuid DEFAULT NULL::uuid, _description text DEFAULT ''::text, _target_user_id uuid DEFAULT NULL::uuid, _agent_id uuid DEFAULT NULL::uuid, _new_value jsonb DEFAULT NULL::jsonb)
 RETURNS policy_change_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_owner_id uuid;
  v_snapshot jsonb;
  v_patch jsonb;
  created public.policy_change_requests;
BEGIN
  IF NOT public.session_mfa_ok() THEN RAISE EXCEPTION 'two-step sign-in required' USING ERRCODE = '42501'; END IF;
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _change_type NOT IN (
    'promote_hard_rule', 'promote_safety_rule', 'raise_spend_cap', 'change_strictness',
    'delete_hard_rule', 'delete_safety_rule', 'disable_hard_rule', 'disable_safety_rule', 'edit_hard_rule', 'edit_safety_rule'
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
  ELSIF _change_type IN ('delete_hard_rule', 'disable_hard_rule') THEN
    SELECT user_id, to_jsonb(t) INTO v_owner_id, v_snapshot FROM public.hard_rules t WHERE id = _row_id;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
    _new_value := v_snapshot;
  ELSIF _change_type IN ('delete_safety_rule', 'disable_safety_rule') THEN
    SELECT user_id, to_jsonb(t) INTO v_owner_id, v_snapshot FROM public.safety_rules t WHERE id = _row_id;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
    _new_value := v_snapshot;
  ELSIF _change_type IN ('edit_hard_rule', 'edit_safety_rule') THEN
    IF _change_type = 'edit_hard_rule' THEN
      SELECT user_id INTO v_owner_id FROM public.hard_rules WHERE id = _row_id;
    ELSE
      SELECT user_id INTO v_owner_id FROM public.safety_rules WHERE id = _row_id;
    END IF;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
    IF _new_value IS NULL OR jsonb_typeof(_new_value) <> 'object' THEN RAISE EXCEPTION 'new_value must be the changed fields'; END IF;
    -- Only the columns an edit may change are kept; anything else in the request is dropped, never applied.
    SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) INTO v_patch
      FROM jsonb_each(_new_value) AS e(k, v)
     WHERE k = ANY (public.rule_edit_columns(CASE WHEN _change_type = 'edit_hard_rule' THEN 'hard_rules' ELSE 'safety_rules' END));
    IF v_patch = '{}'::jsonb THEN RAISE EXCEPTION 'Nothing to change'; END IF;
    _new_value := v_patch;
  END IF;

  IF v_owner_id <> uid AND NOT public.is_account_member(v_owner_id, 'owner') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.policy_change_requests (user_id, requested_by, change_type, row_id, agent_id, new_value, description)
  VALUES (v_owner_id, uid, _change_type, _row_id, _agent_id, _new_value, _description)
  RETURNING * INTO created;
  RETURN created;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_policy_change(_request_id uuid)
 RETURNS policy_change_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  r public.policy_change_requests;
  v jsonb;
BEGIN
  IF NOT public.session_mfa_ok() THEN RAISE EXCEPTION 'two-step sign-in required' USING ERRCODE = '42501'; END IF;
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

  PERFORM set_config('app.approval_signoff', '1', true);
  v := r.new_value;

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
  ELSIF r.change_type = 'disable_hard_rule' THEN
    UPDATE public.hard_rules SET enabled = false WHERE id = r.row_id;
  ELSIF r.change_type = 'disable_safety_rule' THEN
    UPDATE public.safety_rules SET enabled = false WHERE id = r.row_id;
  ELSIF r.change_type = 'edit_hard_rule' THEN
    UPDATE public.hard_rules SET
      rule_text = CASE WHEN v ? 'rule_text' THEN v->>'rule_text' ELSE rule_text END,
      action_type_pattern = CASE WHEN v ? 'action_type_pattern' THEN v->>'action_type_pattern' ELSE action_type_pattern END,
      effect = CASE WHEN v ? 'effect' THEN v->>'effect' ELSE effect END,
      provider = CASE WHEN v ? 'provider' THEN v->>'provider' ELSE provider END,
      required_approvals = CASE WHEN v ? 'required_approvals' THEN (v->>'required_approvals')::int ELSE required_approvals END,
      agent_id = CASE WHEN v ? 'agent_id' THEN (v->>'agent_id')::uuid ELSE agent_id END,
      api_key_id = CASE WHEN v ? 'api_key_id' THEN (v->>'api_key_id')::uuid ELSE api_key_id END
    WHERE id = r.row_id;
  ELSIF r.change_type = 'edit_safety_rule' THEN
    UPDATE public.safety_rules SET
      name = CASE WHEN v ? 'name' THEN v->>'name' ELSE name END,
      pattern = CASE WHEN v ? 'pattern' THEN v->>'pattern' ELSE pattern END,
      severity = CASE WHEN v ? 'severity' THEN v->>'severity' ELSE severity END,
      redact = CASE WHEN v ? 'redact' THEN (v->>'redact')::boolean ELSE redact END,
      category = CASE WHEN v ? 'category' THEN v->>'category' ELSE category END,
      agent_id = CASE WHEN v ? 'agent_id' THEN (v->>'agent_id')::uuid ELSE agent_id END,
      api_key_id = CASE WHEN v ? 'api_key_id' THEN (v->>'api_key_id')::uuid ELSE api_key_id END
    WHERE id = r.row_id;
  END IF;

  PERFORM set_config('app.approval_signoff', '0', true);

  UPDATE public.policy_change_requests
     SET status = 'executed', approved_by = uid, approved_at = now()
   WHERE id = _request_id
   RETURNING * INTO r;
  RETURN r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_rule_weakening() FROM PUBLIC, anon, authenticated;

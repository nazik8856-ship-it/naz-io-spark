-- Inner Control Day 3 (#171): rules in plain words for the whole account. A meaning rule with no project ("Never promise a
-- delivery date") applies to every reply NazAI checks for the account. Until now only the projects function (service role)
-- wrote meaning rules, and only for one project. The Inner page now adds, edits, switches off and deletes the account-wide
-- ones directly, like hard and safety rules, with the same protections:
--   * who may write: the owner, or a team owner with the rules (policy) permission, as for hard_rules and safety_rules. Only
--     account-wide rows (project_id null); a project's rules stay written by the projects function.
--   * shadow mode: a new rule can start watched and logged only (shadow_mode), and promoted later (promoted_at).
--   * dual control: on an account that requires a second owner, switching off, editing, deleting and promoting a meaning rule
--     are requests (promote/delete/disable/edit_meaning_rule), applied when a second, different owner approves.
--   * at most 10 account-wide meaning rules (MAX_MEANING_RULES in meaning-judge.ts), as for a project.
--   * every change is logged (config_changes), like the other rules.
-- Existing rows keep working as they did: shadow_mode defaults to false.

ALTER TABLE public.meaning_rules ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false;
ALTER TABLE public.meaning_rules ADD COLUMN IF NOT EXISTS promoted_at timestamptz;
ALTER TABLE public.meaning_rules ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS meaning_rules_updated_at ON public.meaning_rules;
CREATE TRIGGER meaning_rules_updated_at BEFORE UPDATE ON public.meaning_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---- who may write (account-wide rows only)
DROP POLICY IF EXISTS "Owners manage their account meaning rules (insert)" ON public.meaning_rules;
CREATE POLICY "Owners manage their account meaning rules (insert)" ON public.meaning_rules FOR INSERT
  WITH CHECK (project_id IS NULL AND (auth.uid() = user_id OR can_access(user_id, 'owner', 'policy')));
DROP POLICY IF EXISTS "Owners manage their account meaning rules (update)" ON public.meaning_rules;
CREATE POLICY "Owners manage their account meaning rules (update)" ON public.meaning_rules FOR UPDATE
  USING (project_id IS NULL AND (auth.uid() = user_id OR can_access(user_id, 'owner', 'policy')))
  WITH CHECK (project_id IS NULL AND (auth.uid() = user_id OR can_access(user_id, 'owner', 'policy')));
DROP POLICY IF EXISTS "Owners manage their account meaning rules (delete)" ON public.meaning_rules;
CREATE POLICY "Owners manage their account meaning rules (delete)" ON public.meaning_rules FOR DELETE
  USING (project_id IS NULL AND (auth.uid() = user_id OR can_access(user_id, 'owner', 'policy')));
GRANT INSERT, UPDATE, DELETE ON TABLE public.meaning_rules TO authenticated;

-- ---- at most 10 account-wide rules (a project's are capped by the projects function)
CREATE OR REPLACE FUNCTION public.cap_account_meaning_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.project_id IS NULL AND (SELECT count(*) FROM public.meaning_rules m WHERE m.user_id = NEW.user_id AND m.project_id IS NULL) >= 10 THEN
    RAISE EXCEPTION 'An account can have at most 10 rules in plain words. Delete or edit one first.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS cap_account_meaning_rules_trg ON public.meaning_rules;
CREATE TRIGGER cap_account_meaning_rules_trg BEFORE INSERT ON public.meaning_rules
  FOR EACH ROW EXECUTE FUNCTION public.cap_account_meaning_rules();

-- ---- dual control: the same guards as hard and safety rules
CREATE OR REPLACE FUNCTION public.rule_edit_columns(_table text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _table
    WHEN 'hard_rules' THEN ARRAY['rule_text', 'action_type_pattern', 'effect', 'provider', 'required_approvals', 'agent_id', 'api_key_id']
    WHEN 'safety_rules' THEN ARRAY['name', 'pattern', 'severity', 'redact', 'category', 'agent_id', 'api_key_id']
    WHEN 'meaning_rules' THEN ARRAY['name', 'description', 'action']
    ELSE ARRAY[]::text[]
  END;
$function$;

DROP TRIGGER IF EXISTS guard_meaning_rule_weakening_trg ON public.meaning_rules;
CREATE TRIGGER guard_meaning_rule_weakening_trg BEFORE UPDATE ON public.meaning_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_rule_weakening();

CREATE OR REPLACE FUNCTION public.guard_meaning_rule_promotion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.shadow_mode IS DISTINCT FROM OLD.shadow_mode OR NEW.promoted_at IS DISTINCT FROM OLD.promoted_at)
     AND coalesce(auth.role(), 'service_role') <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1'
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.require_dual_control_for_policy) THEN
    RAISE EXCEPTION 'This account requires a second owner''s approval before a rule goes live -- request the change instead.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS guard_meaning_rule_promotion_trg ON public.meaning_rules;
CREATE TRIGGER guard_meaning_rule_promotion_trg BEFORE UPDATE ON public.meaning_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_meaning_rule_promotion();

CREATE OR REPLACE FUNCTION public.guard_meaning_rule_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), 'service_role') <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1'
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id AND p.require_dual_control_for_policy) THEN
    RAISE EXCEPTION 'This account requires a second owner''s approval before a rule can be deleted -- request the change instead.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;
DROP TRIGGER IF EXISTS guard_meaning_rule_delete_trg ON public.meaning_rules;
CREATE TRIGGER guard_meaning_rule_delete_trg BEFORE DELETE ON public.meaning_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_meaning_rule_delete();

DROP TRIGGER IF EXISTS log_meaning_rules_changes ON public.meaning_rules;
CREATE TRIGGER log_meaning_rules_changes AFTER INSERT OR UPDATE OR DELETE ON public.meaning_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();

-- ---- change requests for meaning rules
ALTER TABLE public.policy_change_requests DROP CONSTRAINT IF EXISTS policy_change_requests_change_type_check;
ALTER TABLE public.policy_change_requests ADD CONSTRAINT policy_change_requests_change_type_check CHECK (change_type = ANY (ARRAY[
  'promote_hard_rule', 'promote_safety_rule', 'raise_spend_cap', 'change_strictness', 'delete_hard_rule', 'delete_safety_rule',
  'disable_hard_rule', 'disable_safety_rule', 'edit_hard_rule', 'edit_safety_rule',
  'promote_meaning_rule', 'delete_meaning_rule', 'disable_meaning_rule', 'edit_meaning_rule'
]));

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
  v_table text;
  created public.policy_change_requests;
BEGIN
  IF NOT public.session_mfa_ok() THEN RAISE EXCEPTION 'two-step sign-in required' USING ERRCODE = '42501'; END IF;
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _change_type NOT IN (
    'promote_hard_rule', 'promote_safety_rule', 'raise_spend_cap', 'change_strictness',
    'delete_hard_rule', 'delete_safety_rule', 'disable_hard_rule', 'disable_safety_rule', 'edit_hard_rule', 'edit_safety_rule',
    'promote_meaning_rule', 'delete_meaning_rule', 'disable_meaning_rule', 'edit_meaning_rule'
  ) THEN
    RAISE EXCEPTION 'Unsupported change_type';
  END IF;

  IF _change_type = 'promote_hard_rule' THEN
    SELECT user_id INTO v_owner_id FROM public.hard_rules WHERE id = _row_id;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
  ELSIF _change_type = 'promote_safety_rule' THEN
    SELECT user_id INTO v_owner_id FROM public.safety_rules WHERE id = _row_id;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
  ELSIF _change_type = 'promote_meaning_rule' THEN
    SELECT user_id INTO v_owner_id FROM public.meaning_rules WHERE id = _row_id AND project_id IS NULL;
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
  ELSIF _change_type IN ('delete_meaning_rule', 'disable_meaning_rule') THEN
    SELECT user_id, to_jsonb(t) INTO v_owner_id, v_snapshot FROM public.meaning_rules t WHERE id = _row_id AND project_id IS NULL;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
    _new_value := v_snapshot;
  ELSIF _change_type IN ('edit_hard_rule', 'edit_safety_rule', 'edit_meaning_rule') THEN
    v_table := CASE _change_type WHEN 'edit_hard_rule' THEN 'hard_rules' WHEN 'edit_safety_rule' THEN 'safety_rules' ELSE 'meaning_rules' END;
    IF v_table = 'hard_rules' THEN
      SELECT user_id INTO v_owner_id FROM public.hard_rules WHERE id = _row_id;
    ELSIF v_table = 'safety_rules' THEN
      SELECT user_id INTO v_owner_id FROM public.safety_rules WHERE id = _row_id;
    ELSE
      SELECT user_id INTO v_owner_id FROM public.meaning_rules WHERE id = _row_id AND project_id IS NULL;
    END IF;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
    IF _new_value IS NULL OR jsonb_typeof(_new_value) <> 'object' THEN RAISE EXCEPTION 'new_value must be the changed fields'; END IF;
    SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) INTO v_patch
      FROM jsonb_each(_new_value) AS e(k, v)
     WHERE k = ANY (public.rule_edit_columns(v_table));
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
  ELSIF r.change_type = 'promote_meaning_rule' THEN
    UPDATE public.meaning_rules SET shadow_mode = false, promoted_at = now() WHERE id = r.row_id AND project_id IS NULL;
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
  ELSIF r.change_type = 'delete_meaning_rule' THEN
    DELETE FROM public.meaning_rules WHERE id = r.row_id AND project_id IS NULL;
  ELSIF r.change_type = 'disable_hard_rule' THEN
    UPDATE public.hard_rules SET enabled = false WHERE id = r.row_id;
  ELSIF r.change_type = 'disable_safety_rule' THEN
    UPDATE public.safety_rules SET enabled = false WHERE id = r.row_id;
  ELSIF r.change_type = 'disable_meaning_rule' THEN
    UPDATE public.meaning_rules SET enabled = false WHERE id = r.row_id AND project_id IS NULL;
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
  ELSIF r.change_type = 'edit_meaning_rule' THEN
    UPDATE public.meaning_rules SET
      name = CASE WHEN v ? 'name' THEN v->>'name' ELSE name END,
      description = CASE WHEN v ? 'description' THEN v->>'description' ELSE description END,
      action = CASE WHEN v ? 'action' THEN v->>'action' ELSE action END
    WHERE id = r.row_id AND project_id IS NULL;
  END IF;

  PERFORM set_config('app.approval_signoff', '0', true);

  UPDATE public.policy_change_requests
     SET status = 'executed', approved_by = uid, approved_at = now()
   WHERE id = _request_id
   RETURNING * INTO r;
  RETURN r;
END;
$function$;

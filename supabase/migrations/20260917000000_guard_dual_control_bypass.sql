-- Closes a systemic gap found in tonight's follow-up audit: the dual-control
-- approval system (request_policy_change -> approve_policy_change) is real
-- and correct, but the RLS policies on the tables it writes to were never
-- tightened to actually force traffic through it. Any signed-in account
-- owner could bypass approval entirely with one direct client UPDATE on:
--   - profiles.control_strictness      (change_strictness)
--   - profiles.require_dual_control_for_policy (the dual-control system's
--     own on/off switch -- not even part of approve_policy_change, so no
--     legitimate self-service path touches it at all)
--   - ai_spend_caps.daily_cap_usd      (raise_spend_cap)
--   - hard_rules.shadow_mode/promoted_at    (promote_hard_rule)
--   - safety_rules.shadow_mode/promoted_at  (promote_safety_rule)
--
-- approve_policy_change() is SECURITY DEFINER, but that only changes which
-- Postgres role's table privileges apply -- auth.role() still reads the
-- calling client's own JWT claim ('authenticated'), never 'service_role',
-- for the whole life of that call. A guard trigger that only allowed
-- auth.role() = 'service_role' would therefore also block the legitimate
-- approval RPC itself. record_approval_signoff() already solved exactly
-- this for pending_approvals via a session-local escape-hatch GUC
-- (app.approval_signoff) set right before its own guarded write -- reusing
-- that same flag here for consistency, rather than inventing a second one.

-- 1. Let approve_policy_change raise the same escape hatch record_approval_signoff uses.
CREATE OR REPLACE FUNCTION public.approve_policy_change(_request_id uuid)
RETURNS policy_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  PERFORM set_config('app.approval_signoff', '1', true);

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

  PERFORM set_config('app.approval_signoff', '0', true);

  UPDATE public.policy_change_requests
     SET status = 'executed', approved_by = uid, approved_at = now()
   WHERE id = _request_id
   RETURNING * INTO r;
  RETURN r;
END;
$function$;

-- 2. profiles: extend the existing credits/tier guard to also cover
-- control_strictness (escape-hatched for approve_policy_change) and
-- require_dual_control_for_policy (no escape hatch -- nothing legitimate
-- writes it today; only a deliberate service-role change should ever).
CREATE OR REPLACE FUNCTION public.profiles_guard_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.credits IS DISTINCT FROM OLD.credits AND auth.role() <> 'service_role' THEN
    NEW.credits := OLD.credits;
  END IF;
  IF NEW.tier IS DISTINCT FROM OLD.tier AND auth.role() <> 'service_role' THEN
    NEW.tier := OLD.tier;
  END IF;
  IF NEW.control_strictness IS DISTINCT FROM OLD.control_strictness
     AND auth.role() <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1' THEN
    NEW.control_strictness := OLD.control_strictness;
  END IF;
  IF NEW.require_dual_control_for_policy IS DISTINCT FROM OLD.require_dual_control_for_policy
     AND auth.role() <> 'service_role' THEN
    NEW.require_dual_control_for_policy := OLD.require_dual_control_for_policy;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.profiles_guard_credits() FROM PUBLIC, anon, authenticated;

-- 3. ai_spend_caps.daily_cap_usd -- escape-hatched for approve_policy_change.
CREATE OR REPLACE FUNCTION public.guard_ai_spend_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.daily_cap_usd IS DISTINCT FROM OLD.daily_cap_usd
     AND auth.role() <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1' THEN
    NEW.daily_cap_usd := OLD.daily_cap_usd;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_ai_spend_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_ai_spend_cap_trg ON public.ai_spend_caps;
CREATE TRIGGER guard_ai_spend_cap_trg
  BEFORE UPDATE ON public.ai_spend_caps
  FOR EACH ROW EXECUTE FUNCTION public.guard_ai_spend_cap();

-- 4. hard_rules.shadow_mode/promoted_at -- escape-hatched for approve_policy_change.
CREATE OR REPLACE FUNCTION public.guard_hard_rule_promotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.shadow_mode IS DISTINCT FROM OLD.shadow_mode OR NEW.promoted_at IS DISTINCT FROM OLD.promoted_at)
     AND auth.role() <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1' THEN
    NEW.shadow_mode := OLD.shadow_mode;
    NEW.promoted_at := OLD.promoted_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_hard_rule_promotion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_hard_rule_promotion_trg ON public.hard_rules;
CREATE TRIGGER guard_hard_rule_promotion_trg
  BEFORE UPDATE ON public.hard_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_hard_rule_promotion();

-- 5. safety_rules.shadow_mode/promoted_at -- same shape as hard_rules.
CREATE OR REPLACE FUNCTION public.guard_safety_rule_promotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.shadow_mode IS DISTINCT FROM OLD.shadow_mode OR NEW.promoted_at IS DISTINCT FROM OLD.promoted_at)
     AND auth.role() <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1' THEN
    NEW.shadow_mode := OLD.shadow_mode;
    NEW.promoted_at := OLD.promoted_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_safety_rule_promotion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_safety_rule_promotion_trg ON public.safety_rules;
CREATE TRIGGER guard_safety_rule_promotion_trg
  BEFORE UPDATE ON public.safety_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_safety_rule_promotion();

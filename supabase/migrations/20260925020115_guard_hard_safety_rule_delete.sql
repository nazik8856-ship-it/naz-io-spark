-- Pillar 4 item: the 2026-09-17 dual-control hardening guarded UPDATE on
-- hard_rules.shadow_mode/promoted_at and safety_rules.shadow_mode/promoted_at
-- (promotion), but never added anything for DELETE -- even though
-- delete_hard_rule/delete_safety_rule are real change_types
-- request_policy_change/approve_policy_change already support, and both
-- HardRulesPanel.tsx's and ControlSafetyRules.tsx's own remove() functions
-- already route through request_policy_change when dual control is on.
-- Nothing at the database layer stopped a direct .delete() call from
-- bypassing that entirely -- dual control's most consequential action
-- (removing a rule outright) had no real backstop, regardless of whether
-- dual control was even turned on.
--
-- approve_policy_change() already raises the app.approval_signoff escape
-- hatch around ALL of its branches, including its two DELETE statements, so
-- the legitimate approval path is unaffected.
CREATE OR REPLACE FUNCTION public.guard_hard_rule_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1'
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id AND p.require_dual_control_for_policy) THEN
    RAISE EXCEPTION 'This account requires a second owner''s approval before a hard rule can be deleted -- request the change instead.';
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_hard_rule_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_hard_rule_delete_trg ON public.hard_rules;
CREATE TRIGGER guard_hard_rule_delete_trg
  BEFORE DELETE ON public.hard_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_hard_rule_delete();

CREATE OR REPLACE FUNCTION public.guard_safety_rule_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1'
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id AND p.require_dual_control_for_policy) THEN
    RAISE EXCEPTION 'This account requires a second owner''s approval before a safety rule can be deleted -- request the change instead.';
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_safety_rule_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_safety_rule_delete_trg ON public.safety_rules;
CREATE TRIGGER guard_safety_rule_delete_trg
  BEFORE DELETE ON public.safety_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_safety_rule_delete();

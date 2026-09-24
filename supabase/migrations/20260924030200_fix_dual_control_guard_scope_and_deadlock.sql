-- Pillar 3 top-10 item 5: two real bugs traced back to the 2026-09-17
-- dual-control hardening pass (guard_dual_control_bypass migration).
--
-- 1. BROKEN TOGGLE: profiles_guard_credits() unconditionally reverted any
-- direct write to require_dual_control_for_policy, on the stated assumption
-- that "no legitimate self-service path touches it" -- false.
-- HardRulesPanel.tsx's own toggleDualControl() has always written this
-- column directly (the field's whole design, per the original 20260821
-- migration, is a self-service on/off switch -- it can't itself require
-- dual control to change, or nothing could ever turn it on in the first
-- place). Every click succeeded with no error and silently never persisted.
--
-- 2. WRONG BLAST RADIUS: guard_ai_spend_cap(), guard_hard_rule_promotion(),
-- and guard_safety_rule_promotion(), plus profiles_guard_credits()'s own
-- control_strictness clause, all blocked a direct write UNCONDITIONALLY --
-- not only for accounts that actually have require_dual_control_for_policy
-- on. Every account with dual control OFF (the default, and by far the
-- common case) has had hard-rule promotion, spend-cap changes, safety-rule
-- promotion, and strictness changes all silently no-op through their normal
-- direct-write path since 2026-09-17 -- the exact same "succeeds with no
-- error, never persists" shape as bug 1, just on four more columns.
--
-- 3. DEADLOCK: even fixed, turning dual control on with only one owner on
-- the account means every future request_policy_change can never be
-- approved -- approve_policy_change refuses a requester approving their own
-- request, and there is no one else. Turning it on now requires at least
-- one OTHER active owner-tier team member already be on the account.

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
     AND OLD.require_dual_control_for_policy
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1' THEN
    NEW.control_strictness := OLD.control_strictness;
  END IF;
  -- This is the dual-control system's OWN on/off switch -- it must stay
  -- directly self-service, never itself gated behind dual control, or
  -- nothing could ever turn it on in the first place. Turning it ON is
  -- still guarded, just against a different failure: a second, different
  -- owner must already be on the account, or every future
  -- request_policy_change would be permanently unapprovable.
  IF NEW.require_dual_control_for_policy IS TRUE
     AND OLD.require_dual_control_for_policy IS NOT TRUE
     AND auth.role() <> 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.account_members
       WHERE account_owner_id = NEW.id AND role = 'owner' AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'Add a second owner to this account before requiring dual control -- otherwise no future policy change could ever be approved.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_ai_spend_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.daily_cap_usd IS DISTINCT FROM OLD.daily_cap_usd
     AND auth.role() <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1'
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.require_dual_control_for_policy) THEN
    NEW.daily_cap_usd := OLD.daily_cap_usd;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_hard_rule_promotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.shadow_mode IS DISTINCT FROM OLD.shadow_mode OR NEW.promoted_at IS DISTINCT FROM OLD.promoted_at)
     AND auth.role() <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1'
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.require_dual_control_for_policy) THEN
    NEW.shadow_mode := OLD.shadow_mode;
    NEW.promoted_at := OLD.promoted_at;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_safety_rule_promotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.shadow_mode IS DISTINCT FROM OLD.shadow_mode OR NEW.promoted_at IS DISTINCT FROM OLD.promoted_at)
     AND auth.role() <> 'service_role'
     AND coalesce(current_setting('app.approval_signoff', true), '') <> '1'
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.require_dual_control_for_policy) THEN
    NEW.shadow_mode := OLD.shadow_mode;
    NEW.promoted_at := OLD.promoted_at;
  END IF;
  RETURN NEW;
END;
$function$;

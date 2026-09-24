-- Found while verifying the item 5 fix above: log_profiles_dual_control_changes
-- (added by the original 20260821 policy_change_dual_control migration) reuses
-- the GENERIC log_config_change() logger, which derives its config_changes.
-- user_id from a `user_id` JSON key that the profiles table simply does not
-- have (profiles uses `id` as the account owner's own id). Every single
-- attempt to change require_dual_control_for_policy -- through the now-fixed
-- direct write OR through a future service-role change -- would hit this
-- AFTER trigger and crash with a NOT NULL violation on config_changes.user_id,
-- rolling back the entire UPDATE. The toggle would still never persist, just
-- with a loud error instead of a silent no-op.
--
-- profiles already has its own correctly-written logger for exactly this
-- shape (log_profile_config_change(), added in the same original migration,
-- for control_strictness/kill_switch) -- extending it to also cover
-- require_dual_control_for_policy and retargeting the trigger there removes
-- the broken generic-function reuse entirely, rather than patching
-- log_config_change() itself and touching every other table it still
-- correctly serves.
DROP TRIGGER IF EXISTS log_profiles_dual_control_changes ON public.profiles;

CREATE OR REPLACE FUNCTION public.log_profile_config_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.control_strictness IS DISTINCT FROM OLD.control_strictness
     OR NEW.kill_switch IS DISTINCT FROM OLD.kill_switch
     OR NEW.require_dual_control_for_policy IS DISTINCT FROM OLD.require_dual_control_for_policy THEN
    INSERT INTO public.config_changes (user_id, actor_id, table_name, row_id, action, before, after)
    VALUES (
      NEW.id, auth.uid(), 'profiles', NEW.id, 'update',
      jsonb_build_object(
        'control_strictness', OLD.control_strictness, 'kill_switch', OLD.kill_switch,
        'require_dual_control_for_policy', OLD.require_dual_control_for_policy
      ),
      jsonb_build_object(
        'control_strictness', NEW.control_strictness, 'kill_switch', NEW.kill_switch,
        'require_dual_control_for_policy', NEW.require_dual_control_for_policy
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

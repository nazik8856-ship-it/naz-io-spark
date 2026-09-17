-- policy_versions has an ALL-command RLS policy for the row owner with no
-- column restriction, but activation is meant to be gated: control-engine's
-- POST /policy/:id/activate runs a scenario replay and refuses to activate
-- a draft that regresses anything the current active policy passes. Until
-- now nothing stopped a direct client UPDATE from setting status='active'
-- on any draft directly, skipping that replay check entirely.
--
-- The one legitimate exception was ControlPolicy.tsx's rollback() doing its
-- own direct client writes to restore a previously-archived version --
-- moved server-side (control-engine's new POST /policy/rollback, same
-- migration/PR) so this guard can be a flat service-role-only check with
-- no escape-hatch GUC needed.
CREATE OR REPLACE FUNCTION public.guard_policy_version_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.activated_at IS DISTINCT FROM OLD.activated_at)
     AND auth.role() <> 'service_role' THEN
    NEW.status := OLD.status;
    NEW.activated_at := OLD.activated_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_policy_version_activation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_policy_version_activation_trg ON public.policy_versions;
CREATE TRIGGER guard_policy_version_activation_trg
  BEFORE UPDATE ON public.policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_policy_version_activation();

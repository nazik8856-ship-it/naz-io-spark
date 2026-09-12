-- Backfills a missing migration file. This function was applied live
-- (and is already in the project's remote migration history) while
-- building the "Mine"/"Resolved" incident filters and the
-- owner-name-fallback fix (ControlIncidents.tsx, ControlApprovals.tsx,
-- src/lib/actor-names.ts), but the file itself was never committed to
-- this repo -- a real reproducibility gap: a fresh environment rebuilding
-- from this repo's migrations alone would be missing the function
-- entirely, and it shipped with no reviewable record of its SECURITY
-- DEFINER body. This file documents what is already live; it does not
-- need to be reapplied.
--
-- account_members never has a row for the account owner themselves, so
-- without this, any team member viewing another account's
-- incidents/approvals saw the owner's own actions attributed to a
-- shortened uuid instead of their real name. SECURITY DEFINER to read
-- auth.users; gated by the same is_account_member('viewer') check every
-- other cross-account read in this codebase uses, so it can't be used to
-- probe an arbitrary user's email.
CREATE OR REPLACE FUNCTION public.get_account_owner_contact(_account_owner_id uuid)
RETURNS TABLE(email text, display_name text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF auth.uid() != _account_owner_id AND NOT public.is_account_member(_account_owner_id, 'viewer') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT u.email::text, COALESCE(u.raw_user_meta_data->>'full_name', u.email)::text
  FROM auth.users u
  WHERE u.id = _account_owner_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_account_owner_contact(uuid) TO authenticated;

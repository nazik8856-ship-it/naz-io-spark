-- guard_kill_switch() authorizes a kill_switch change only for the single
-- global platform owner (has_role) or an explicitly-invited account_members
-- "owner" row (is_account_member). Neither ever covers the plain, real
-- owner of the account flipping their OWN switch -- there is no
-- self-membership row auto-created in account_members for anyone, and
-- production has zero rows in that table today. Confirmed live: 6 of 7
-- real profiles rows have no path through either check, so a real account
-- owner's own attempt to toggle profiles.kill_switch for their own row
-- (auth.uid() = id) is rejected by this trigger with "not authorized to
-- change kill switch" -- the account kill switch shipped in Pillar 1 is
-- unusable by any real customer today. Add the missing, obviously-correct
-- authorization: you can always flip your own account's switch.
CREATE OR REPLACE FUNCTION public.guard_kill_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.kill_switch is distinct from old.kill_switch
     and auth.role() <> 'service_role'
     and auth.uid() <> old.id
     and not public.has_role(auth.uid(), 'owner')
     and not public.is_account_member(old.id, 'owner') then
    raise exception 'not authorized to change kill switch';
  end if;
  return new;
end;
$function$;

-- profiles.tier was added as the new server-authoritative source of truth
-- for subscription tier (see 20260916000000_profiles_tier_column.sql), but
-- "Users can update own profile info" (auth.uid() = id, no column
-- restriction) still let any authenticated user set it directly via a raw
-- PostgREST/client-SDK update -- completely bypassing purchase-credits and
-- defeating the whole point of moving tier server-side. profiles.credits
-- already has exactly this problem solved (profiles_guard_credits_trg,
-- 20260713023019) -- extend that same trigger to guard tier the same way:
-- any change not made as service_role is silently reverted.
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
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.profiles_guard_credits() FROM PUBLIC, anon, authenticated;

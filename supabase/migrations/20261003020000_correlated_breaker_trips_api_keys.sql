-- Inner/Outer Control sync: get_recent_breaker_trips (20260823040000_
-- correlated_breaker_trips.sql) only ever returned the tripping agent's
-- agent_id, joined in via agent_decisions.id = decision_id. Outer
-- Control's own breaker trips have agent_id NULL and api_key_id set
-- instead (control-api's mode="full" forward never ties an action to an
-- internal agent) -- correlated-failures.ts's findCorrelatedFailures only
-- ever counted distinct agent_id values, so multiple DIFFERENT API keys
-- independently tripping a breaker on the same provider could never
-- surface as a correlated_breaker_trip incident, only multi-agent
-- correlation was detected. Adds api_key_id to this RPC's result so the
-- edge function (cron-correlated-failures) can thread it through.
--
-- DROP + CREATE (not CREATE OR REPLACE): adding a new output column to a
-- RETURNS TABLE function changes its result-set signature, which CREATE
-- OR REPLACE FUNCTION does not allow for table-returning functions.
DROP FUNCTION IF EXISTS public.get_recent_breaker_trips(timestamptz);

CREATE FUNCTION public.get_recent_breaker_trips(_since timestamptz)
RETURNS TABLE(
  user_id uuid,
  action_type text,
  provider text,
  agent_id uuid,
  api_key_id uuid,
  decision_id uuid,
  opened_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.user_id, i.action_type, i.provider, ad.agent_id, ad.api_key_id, i.decision_id, i.opened_at
  FROM public.incidents i
  LEFT JOIN public.agent_decisions ad ON ad.id = i.decision_id
  WHERE i.kind = 'circuit_breaker_trip' AND i.opened_at >= _since
  ORDER BY i.opened_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_recent_breaker_trips(timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_breaker_trips(timestamptz) TO service_role;

-- 2026-08-23 plan item 5: cross-agent / fleet-wide correlated-failure
-- detection. Explicitly teed up once circuit breakers went per-agent
-- (2026-08-22) -- nothing today correlates a breaker trip on one agent
-- with a breaker trip on a DIFFERENT agent for the same action_type/
-- provider, which is exactly the signal that distinguishes "one agent has
-- a bad prompt" from "the Gmail API is down for everyone."
--
-- A human bypassing a block (break_glass_override, previous migration) and
-- now a multi-agent correlated breaker trip both get the same alert +
-- incident treatment as every other "something is actually wrong" signal.
ALTER TABLE public.incidents
  DROP CONSTRAINT IF EXISTS incidents_kind_check;

ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_kind_check CHECK (
    kind IN (
      'kill_switch_auto',
      'circuit_breaker_trip',
      'gate_error',
      'self_audit_regression',
      'approval_escalated',
      'confidence_miscalibrated',
      'break_glass_override',
      'correlated_breaker_trip'
    )
  );

-- circuit_breakers has no provider column, and every gate/breaker query is
-- deliberately siloed per account/agent post-2026-08-22 (correctly -- that
-- isolation is the point of per-agent scoping) -- neither is the right
-- place for this cross-cutting join. incidents already carries user_id/
-- action_type/provider/decision_id for every circuit_breaker_trip; this
-- joins in the tripping agent's id via agent_decisions.id = decision_id.
-- Service-role only (the edge function's admin client), same shape as
-- get_job_health_outcomes().
CREATE OR REPLACE FUNCTION public.get_recent_breaker_trips(_since timestamptz)
RETURNS TABLE(
  user_id uuid,
  action_type text,
  provider text,
  agent_id uuid,
  decision_id uuid,
  opened_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.user_id, i.action_type, i.provider, ad.agent_id, i.decision_id, i.opened_at
  FROM public.incidents i
  LEFT JOIN public.agent_decisions ad ON ad.id = i.decision_id
  WHERE i.kind = 'circuit_breaker_trip' AND i.opened_at >= _since
  ORDER BY i.opened_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_recent_breaker_trips(timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_breaker_trips(timestamptz) TO service_role;

-- Every 15 minutes -- frequent enough that a real multi-agent outage gets
-- caught quickly, using the same 60-minute lookback window the edge
-- function applies so a single run's trips are never double-counted across
-- two overlapping windows in a way that matters (groupsNeedingNewAlert
-- already dedupes against any still-open incident regardless).
SELECT cron.schedule(
  'cron-correlated-failures-every-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ekuodpaaiugzywfcmjeo.supabase.co/functions/v1/cron-correlated-failures',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

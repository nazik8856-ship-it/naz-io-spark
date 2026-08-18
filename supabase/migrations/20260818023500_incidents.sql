-- Incident tracking: promotes the "something actually went wrong" critical
-- alerts (an automatic kill-switch trip, a circuit-breaker trip, the gate
-- itself failing closed, a self-audit regression) from "a decision row plus
-- a Slack ping" into a real incident object with a timeline and a
-- resolution note. Deliberate human actions (kill switch on/off) and
-- routine enforcement (a hard rule blocking something as designed) are
-- NOT incidents. Writes go through the control-incidents edge function
-- (service role), so only SELECT is granted to authenticated users here.
CREATE TABLE public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('kill_switch_auto', 'circuit_breaker_trip', 'gate_error', 'self_audit_regression')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  summary text NOT NULL,
  action_type text,
  provider text,
  decision_id uuid,
  alert_id uuid REFERENCES public.critical_alerts(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidents_user_status
  ON public.incidents (user_id, status, opened_at DESC);

GRANT SELECT ON public.incidents TO authenticated;
GRANT ALL ON public.incidents TO service_role;

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own incidents"
ON public.incidents FOR SELECT TO authenticated
USING (auth.uid() = user_id);

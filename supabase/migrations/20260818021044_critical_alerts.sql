-- Durable record of every critical control-system alert (kill switch,
-- hard-rule block, circuit-breaker trip, self-audit regression, gate
-- error). Today sendCriticalAlert() only tries Slack, then falls back to
-- console.error — on a serverless edge function nobody may be watching
-- container logs, so if Slack is disconnected or a delivery fails, the
-- alert can vanish with no queryable trace it ever fired. This table is
-- written unconditionally, regardless of whether Slack delivery succeeds,
-- so there is always a durable record independent of that one channel.
CREATE TABLE public.critical_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  summary text NOT NULL,
  action_type text,
  provider text,
  decision_id uuid,
  actor text,
  delivered_via text NOT NULL CHECK (delivered_via IN ('slack', 'log')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_critical_alerts_user_created
  ON public.critical_alerts (user_id, created_at DESC);

GRANT SELECT ON public.critical_alerts TO authenticated;
GRANT ALL ON public.critical_alerts TO service_role;

ALTER TABLE public.critical_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own critical alerts"
ON public.critical_alerts FOR SELECT TO authenticated
USING (auth.uid() = user_id);

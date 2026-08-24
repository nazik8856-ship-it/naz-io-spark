-- 2026-08-25 plan item 14: wire confidence-miscalibration alerts to a real,
-- narrow corrective action.
--
-- Confirmed: confidence-miscalibration was a one-time alert + incident with
-- zero downstream effect -- explicitly flagged on 2026-08-24 as "a real
-- future item, but risky enough to design on its own." Scoped narrowly
-- here: when a bucket is flagged severely miscalibrated (real measured
-- outcomes trailing claimed confidence by more than TOLERANCE_PCT), a row
-- here widens (never narrows) that bucket's effective escalation threshold
-- in control-engine/index.ts until a human clears the flag. No automatic
-- threshold-narrowing, no silent recovery -- a human-reviewed off-switch
-- only, deliberately conservative given the risk this was flagged with.
CREATE TABLE public.confidence_bucket_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket_min integer NOT NULL,
  bucket_max integer NOT NULL,
  incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL,
  flagged_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one ACTIVE (uncleared) flag per bucket per user at a time --
-- calibrate-confidence's own check-then-insert is defense in depth, this
-- index is what actually guarantees it under concurrent weekly runs.
CREATE UNIQUE INDEX confidence_bucket_flags_active_unique
  ON public.confidence_bucket_flags (user_id, bucket_min)
  WHERE cleared_at IS NULL;

CREATE INDEX idx_confidence_bucket_flags_user_active
  ON public.confidence_bucket_flags (user_id) WHERE cleared_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.confidence_bucket_flags TO authenticated;
GRANT ALL ON public.confidence_bucket_flags TO service_role;

ALTER TABLE public.confidence_bucket_flags ENABLE ROW LEVEL SECURITY;

-- Read/clear access for the account owner. No dedicated "clear" UI exists
-- yet (No UX this round) -- a human can already clear a flag today via a
-- plain supabase-js UPDATE setting cleared_at/cleared_by, and this policy
-- is what makes that safe to build a UI for later without any more
-- backend work.
CREATE POLICY "Users manage their own confidence bucket flags"
ON public.confidence_bucket_flags FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

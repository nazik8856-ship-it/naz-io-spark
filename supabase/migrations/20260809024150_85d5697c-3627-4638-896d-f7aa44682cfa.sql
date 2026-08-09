ALTER TABLE public.hard_rules
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.hard_rule_shadow_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.hard_rules(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.agent_decisions(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  provider text,
  would_have text NOT NULL,
  actual_decision text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hard_rule_shadow_hits TO authenticated;
GRANT ALL ON public.hard_rule_shadow_hits TO service_role;

ALTER TABLE public.hard_rule_shadow_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read their shadow hits" ON public.hard_rule_shadow_hits;
CREATE POLICY "Owners read their shadow hits"
  ON public.hard_rule_shadow_hits FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS hard_rule_shadow_hits_rule_idx
  ON public.hard_rule_shadow_hits (rule_id, created_at DESC);
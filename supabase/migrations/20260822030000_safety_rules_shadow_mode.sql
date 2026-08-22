-- 2026-08-22 plan item 5: safety rules shadow-mode parity.
--
-- hard_rules got shadow_mode + hard_rule_shadow_hits on 2026-08-09 --
-- safety_rules never did, an explicitly-flagged gap ("templates only ever
-- create hard_rules, not safety_rules -- extending safety_rules with its
-- own shadow system is real future work"). Mirrors that exact shape.
ALTER TABLE public.safety_rules
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.safety_rule_shadow_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.safety_rules(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.agent_decisions(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  provider text,
  would_have text NOT NULL,
  actual_decision text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.safety_rule_shadow_hits TO authenticated;
GRANT ALL ON public.safety_rule_shadow_hits TO service_role;

ALTER TABLE public.safety_rule_shadow_hits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their safety shadow hits"
  ON public.safety_rule_shadow_hits FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX safety_rule_shadow_hits_rule_idx
  ON public.safety_rule_shadow_hits (rule_id, created_at DESC);

-- Real bug found while touching this function: build_policy_snapshot has
-- never been updated since agent-scoped hard/safety rules shipped
-- (2026-08-21) -- it silently drops agent_id from both rule arrays. Since
-- control-gate.ts reads the PINNED SNAPSHOT as its primary source (falling
-- back to live tables only when no snapshot exists), every hard/safety
-- rule evaluated through an already-created policy version's snapshot has
-- been silently treated as account-wide regardless of its real agent_id --
-- selectRulesForAgent's `r.agent_id == null` check passes for a genuinely
-- missing key exactly the same as an explicit NULL. Fixing this here
-- (same migration, since it's the same function this item needs corrected
-- to also carry shadow_mode for safety_rules) closes both gaps at once.
-- NOTE: this only affects snapshots built AFTER this function is applied
-- -- an already-active policy_versions row keeps its stale snapshot until
-- a new version is captured/activated.
--
-- Second real bug found in the same function: the spend_cap subquery had
-- no agent_id filter, so `SELECT jsonb_build_object(...) FROM
-- ai_spend_caps c WHERE c.user_id = _user_id` used as a scalar subquery
-- would throw "more than one row returned by a subquery expression" for
-- any account with even one per-agent spend cap configured (ai_spend_caps
-- stopped being one-row-per-user back on 2026-08-21). Scoped to the
-- account-wide row (agent_id IS NULL) below -- this snapshot field has
-- only ever meant the account-wide cap.
CREATE OR REPLACE FUNCTION public.build_policy_snapshot(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'hard_rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', hr.id, 'rule_text', hr.rule_text, 'action_type_pattern', hr.action_type_pattern,
        'effect', hr.effect, 'provider', hr.provider, 'enabled', hr.enabled, 'shadow_mode', hr.shadow_mode,
        'agent_id', hr.agent_id
      ) ORDER BY hr.created_at)
      FROM public.hard_rules hr WHERE hr.user_id = _user_id
    ), '[]'::jsonb),
    'safety_rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sr.id, 'name', sr.name, 'category', sr.category, 'pattern', sr.pattern,
        'severity', sr.severity, 'enabled', sr.enabled, 'shadow_mode', sr.shadow_mode,
        'agent_id', sr.agent_id
      ) ORDER BY sr.created_at)
      FROM public.safety_rules sr WHERE sr.user_id = _user_id
    ), '[]'::jsonb),
    'thresholds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_id', a.id, 'slug', a.slug, 'confidence_threshold', a.confidence_threshold,
        'autonomy', a.autonomy, 'auto_approve_low_risk', a.auto_approve_low_risk,
        'daily_run_cap', a.daily_run_cap, 'daily_action_cap', a.daily_action_cap
      ) ORDER BY a.created_at)
      FROM public.agents a WHERE a.user_id = _user_id
    ), '[]'::jsonb),
    'spend_cap', COALESCE((
      SELECT jsonb_build_object('daily_cap_usd', c.daily_cap_usd, 'enabled', c.enabled)
      FROM public.ai_spend_caps c WHERE c.user_id = _user_id AND c.agent_id IS NULL
    ), jsonb_build_object('daily_cap_usd', 5, 'enabled', true)),
    'captured_at', now()
  );
$$;

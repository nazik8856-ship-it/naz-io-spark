-- Pillar 3 top-10 item 10: quorum.ts/createPendingApproval fully support up
-- to 5 distinct sign-offs (Math.min(5, ...)), but no caller anywhere ever
-- requests more than 2 -- "require 3 approvers" was never actually reachable
-- by any account. Lets a hard rule with effect='always_require_approval'
-- configure its own quorum; control-gate.ts passes it through to
-- createPendingApproval, falling back to today's default (2 for high risk)
-- when unset so every existing rule keeps behaving exactly as before.
ALTER TABLE public.hard_rules
  ADD COLUMN IF NOT EXISTS required_approvals integer,
  ADD CONSTRAINT hard_rules_required_approvals_check
    CHECK (required_approvals IS NULL OR (required_approvals BETWEEN 1 AND 5));

-- The gate reads hard rules from the pinned policy_versions snapshot first
-- (live tables only as fallback -- see control-gate.ts's own comment on
-- this), so this column must also be captured into the snapshot or it
-- would be silently invisible to every account with an active policy
-- version, which is effectively all of them.
CREATE OR REPLACE FUNCTION public.build_policy_snapshot(_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'hard_rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', hr.id, 'rule_text', hr.rule_text, 'action_type_pattern', hr.action_type_pattern,
        'effect', hr.effect, 'provider', hr.provider, 'enabled', hr.enabled, 'shadow_mode', hr.shadow_mode,
        'agent_id', hr.agent_id, 'required_approvals', hr.required_approvals
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
$function$;

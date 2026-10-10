-- GAP 4 (Consistent Cross-Control Rule Sync, 2026-10-10): build_policy_snapshot
-- predates api_key_scoped_rules (20261005010000_api_key_scoped_rules.sql),
-- which added api_key_id to hard_rules/safety_rules so a rule could be
-- scoped to one connected external AI instead of (or in addition to) one
-- generated agent. This function was never updated to capture that column.
--
-- Confirmed live impact: matchHardRule (control-gate.ts) prefers the
-- snapshot this function builds over the live table, and runControlGate's
-- own safety-scanner step (scanAction, via its `pinnedRules` argument) does
-- the same for safety_rules once a snapshot exists -- which is the normal
-- case; the live-table fallback only ever fires on an RPC error. Both then
-- call selectRulesForEntity(rules, "api_key", apiKeyId) (rule-matching.ts)
-- to scope rules to the one connected external AI being evaluated. That
-- function's own scoping check is `r[scopeKey] == null || r[scopeKey] ===
-- entityId` -- and `undefined == null` is true in JS. With api_key_id
-- entirely absent from the snapshot's JSON shape (not even present as
-- null), every hard/safety rule read via the snapshot path satisfied that
-- check unconditionally, regardless of which api_key_id it was actually
-- scoped to in the live table. Net effect: ANY hard_rule or safety_rule
-- scoped to one specific connected external AI silently applied to EVERY
-- api key's evaluations once snapshotted (which happens on the very first
-- request for an account) -- not a timing gap, a scoping-identity bug, and
-- the opposite direction from what GAP 1 (Shared Criteria Library) and the
-- "Outer Control API keys" extension (self-heal v1-v3) intended.
--
-- The live-table fallback in matchHardRule/loadSafetyRules already selects
-- api_key_id correctly; this migration brings the snapshot path to parity
-- with it, the one place the two had actually diverged.
CREATE OR REPLACE FUNCTION public.build_policy_snapshot(_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'hard_rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', hr.id, 'rule_text', hr.rule_text, 'action_type_pattern', hr.action_type_pattern,
        'effect', hr.effect, 'provider', hr.provider, 'enabled', hr.enabled, 'shadow_mode', hr.shadow_mode,
        'agent_id', hr.agent_id, 'api_key_id', hr.api_key_id, 'required_approvals', hr.required_approvals
      ) ORDER BY hr.created_at)
      FROM public.hard_rules hr WHERE hr.user_id = _user_id
    ), '[]'::jsonb),
    'safety_rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sr.id, 'name', sr.name, 'category', sr.category, 'pattern', sr.pattern,
        'severity', sr.severity, 'enabled', sr.enabled, 'shadow_mode', sr.shadow_mode,
        'agent_id', sr.agent_id, 'api_key_id', sr.api_key_id
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

-- Every account's CURRENT active snapshot was built with the old, api_key_id-
-- blind function -- force every one of them stale right now so the very next
-- get_active_policy_version() call for each account rebuilds it with the fix,
-- instead of waiting for an unrelated hard_rules/safety_rules edit to trigger
-- the existing staleness check.
UPDATE public.policy_versions
SET snapshot = jsonb_set(snapshot, '{captured_at}', to_jsonb('epoch'::timestamptz))
WHERE status = 'active';

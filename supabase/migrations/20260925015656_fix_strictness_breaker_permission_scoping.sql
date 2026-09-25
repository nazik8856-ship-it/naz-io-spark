-- Pillar 4 item: agent_strictness_overrides and circuit_breakers were added
-- in the same "per-agent scoping" wave as hard_rules/safety_rules/
-- policy_versions/ai_spend_caps/webhooks, but were missed by the
-- 20260827040000_permission_scoped_write_policies.sql cleanup pass -- their
-- "Team owners can..." write policies still check bare is_account_member
-- (user_id, 'owner') with no permission category at all. An account owner
-- who explicitly revokes a teammate's "Policy" permission (ControlTeam.tsx)
-- reasonably expects that teammate to lose write access to policy-adjacent
-- governance -- but that teammate could still change an agent's strictness
-- level or reset its circuit breaker, since neither table's RLS ever
-- checked the permissions array. Both clearly belong under 'policy', same
-- as hard_rules/safety_rules/policy_versions.
DROP POLICY IF EXISTS "Team owners can manage owner's agent strictness overrides" ON public.agent_strictness_overrides;
CREATE POLICY "Team owners can manage owner's agent strictness overrides" ON public.agent_strictness_overrides
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner', 'policy'))
  WITH CHECK (public.is_account_member(user_id, 'owner', 'policy'));

DROP POLICY IF EXISTS "Team owners can reset owner's circuit breakers" ON public.circuit_breakers;
CREATE POLICY "Team owners can reset owner's circuit breakers" ON public.circuit_breakers
  FOR UPDATE TO authenticated
  USING (public.is_account_member(user_id, 'owner', 'policy'))
  WITH CHECK (public.is_account_member(user_id, 'owner', 'policy'));

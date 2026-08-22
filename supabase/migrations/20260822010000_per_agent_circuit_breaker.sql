-- 2026-08-22 plan item 1: per-agent circuit breaker scoping.
--
-- Circuit breakers were the one core enforcement mechanism left reading
-- account-wide-only state after hard rules, safety rules, the spend cap
-- and strictness all got real per-agent scoping this week (Wave 5 session 1
-- and the 2026-08-21 leftovers close-out). This closes that inconsistency.
--
-- Deliberately NOT an override-with-fallback design like the spend cap
-- (per-agent row falling back to the account-wide row when none is
-- configured): a breaker is inherently "have MY recent attempts failed",
-- so when agentId is known the breaker lives ENTIRELY on that agent's own
-- row -- auto-created on first attempt, same as the account-wide row
-- already is -- with zero shared state with any other agent's row or the
-- account-wide row. Only the agent-less path (chat-driven actions with no
-- agent in context) ever reads or writes the account-wide (agent_id NULL)
-- row.
ALTER TABLE public.circuit_breakers
  ADD COLUMN agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE;

-- Was UNIQUE (user_id, action_type), auto-named circuit_breakers_user_id_action_type_key
-- by Postgres for the inline table-level UNIQUE(...) in the original
-- 2026-08-09 migration -- verify against \d circuit_breakers when this is
-- actually applied, in case it was ever renamed.
ALTER TABLE public.circuit_breakers DROP CONSTRAINT circuit_breakers_user_id_action_type_key;
CREATE UNIQUE INDEX idx_circuit_breakers_account_wide ON public.circuit_breakers (user_id, action_type) WHERE agent_id IS NULL;
CREATE UNIQUE INDEX idx_circuit_breakers_per_agent ON public.circuit_breakers (user_id, agent_id, action_type) WHERE agent_id IS NOT NULL;

-- RLS gap found while touching this table: circuit_breakers never picked
-- up the team-account policies hard_rules/safety_rules/ai_spend_caps got
-- in RBAC phases 2 and 3 -- today, a team member (even an owner-tier one)
-- has NO access to an account's breakers at all, only the literal account
-- owner (auth.uid() = user_id) does. Closing that here, same three-tier
-- shape as every other per-agent policy table this week: the account
-- owner manages their own (existing policies, unchanged); any active team
-- member can view; an active owner-role team member can also reset.
CREATE POLICY "Team members can view owner's circuit breakers" ON public.circuit_breakers
  FOR SELECT TO authenticated
  USING (public.is_account_member(user_id));

CREATE POLICY "Team owners can reset owner's circuit breakers" ON public.circuit_breakers
  FOR UPDATE TO authenticated
  USING (public.is_account_member(user_id, 'owner'))
  WITH CHECK (public.is_account_member(user_id, 'owner'));

-- Settings change log (Wave 3 pattern): a manual reset is a config change
-- worth auditing, same as every other governance-config table already
-- wired to log_config_change.
CREATE TRIGGER log_circuit_breakers_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.circuit_breakers
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();

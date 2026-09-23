-- action_reversals shipped with only a strict "own rows" SELECT policy
-- (auth.uid() = user_id), unlike agent_decisions/agents/hard_rules/etc.,
-- which all also grant team members read access via is_account_member().
-- Control System pages let a user switch their "active account" to any
-- account they're a team member of (AccountSwitcher); the new
-- ControlActionReversals.tsx page queries by that active account id, so
-- without this policy a team member viewing an account they don't own
-- would see an empty "No executed actions" page instead of the real rows
-- -- indistinguishable from there genuinely being nothing to show.
CREATE POLICY "Team members can view owner's action reversals"
  ON public.action_reversals FOR SELECT TO authenticated
  USING (public.is_account_member(user_id));

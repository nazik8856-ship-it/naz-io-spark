-- Follow-up from item 1 of the "15 more items" plan (task tracked as #85):
-- capability-status/index.ts derives its account purely from the caller's
-- own JWT with no account_id parameter, and agent_integrations had zero
-- team-member RLS -- only "Users manage their own integrations"
-- (auth.uid() = user_id), same shape as the original bug this whole round
-- started from. A team member viewing a shared account always saw THEIR
-- OWN connected providers on the coverage-gaps page instead of the
-- account being viewed, with no error to flag it.
--
-- Read-only for team members, same as policy_versions' own "Team members
-- can view owner's policy versions" pattern -- no min-role required, this
-- is visibility only, not a write surface.
CREATE POLICY "Team members can view owner's integrations"
  ON public.agent_integrations FOR SELECT TO authenticated
  USING (public.is_account_member(user_id));

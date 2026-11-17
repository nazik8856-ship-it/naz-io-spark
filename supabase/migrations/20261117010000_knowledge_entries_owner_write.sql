-- The account owner can write their own knowledge entries.
--
-- The write rule on knowledge_base_entries was "a team member with the owner role and the policy permission". The owner of the
-- account is not a row in account_members, so on a real account nobody could add, change or delete an entry: not on the Knowledge
-- base page, not as a remembered answer from a Task. Not one entry was ever stored. 20261105030000_policies_use_can_access.sql left
-- the rule as it was, read as "the owner has no direct write access on purpose"; that reading was wrong, nothing depended on it.
--
-- The rule now says what every other team rule says, through the one helper: the owner of the row, or a team owner with the
-- policy permission (can_access). Team members' access is unchanged. Two-step sign-in still applies (two_step_required).
ALTER POLICY "Team owners can manage owner's knowledge base entries" ON public.knowledge_base_entries
  USING (public.can_access(user_id, 'owner', 'policy'))
  WITH CHECK (public.can_access(user_id, 'owner', 'policy'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'is_account_member\('
  ) THEN
    RAISE EXCEPTION 'a rule still calls is_account_member() directly';
  END IF;
END $$;

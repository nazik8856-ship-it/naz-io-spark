-- "15 more items" plan, item 3: policy_versions got team-member READ
-- access in Phase 2 (20260819080000_rbac_phase2_enforcement.sql:147-148)
-- but never got the matching WRITE policy in Phase 3
-- (20260820050000_rbac_phase3_write_access.sql), unlike hard_rules and
-- safety_rules which got both. ControlPolicy.tsx's rollback() does direct
-- client-side table writes (not through an edge function's service-role
-- client), so without this an owner-role team member's rollback attempt
-- was silently blocked by RLS with no matching permissive policy to allow
-- it -- the exact same shape as the two policies already on hard_rules.
CREATE POLICY "Team owners can manage owner's policy versions" ON public.policy_versions
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner'))
  WITH CHECK (public.is_account_member(user_id, 'owner'));

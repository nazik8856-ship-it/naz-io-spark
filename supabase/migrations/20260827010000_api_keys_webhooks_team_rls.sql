-- "15 more items" plan, item 2: api_keys and webhooks had zero team-member
-- RLS -- only the account owner's own `auth.uid() = user_id` policy from
-- their original migrations, unlike hard_rules/safety_rules/policy_versions
-- which already got Phase 2 (team read) and Phase 3 (owner-role team
-- write) policies. Mirrors those exact policy shapes; the original
-- owner-only policies on both tables are left untouched -- Postgres RLS
-- policies are additive (OR'd together), the same three-policy shape
-- hard_rules already has (own-row / team-read / team-owner-write).

-- api_keys: read-only for any team member. Matches the table's own
-- existing design from 20260826010000_api_keys.sql -- there is no direct
-- client write policy at all, even for the account owner; key creation
-- and revocation happen exclusively through the api-keys edge function
-- (updated alongside this migration to let an owner-role team member act
-- on the account they're viewing, verified server-side via
-- is_account_member rather than relying on RLS for those writes).
CREATE POLICY "Team members can view owner's api keys" ON public.api_keys
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

-- webhooks: read for any team member, manage (create/toggle/delete) for
-- owner-role team members only -- exact shape as hard_rules/safety_rules.
CREATE POLICY "Team members can view owner's webhooks" ON public.webhooks
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team owners can manage owner's webhooks" ON public.webhooks
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner'))
  WITH CHECK (public.is_account_member(user_id, 'owner'));

-- webhook_deliveries: read-only for team members. Without this,
-- ControlWebhooks.tsx's "recent deliveries" section would stay empty for
-- a team member even after the page is wired onto accountId below, since
-- it reads from this table too, not just `webhooks` itself.
CREATE POLICY "Team members can view owner's webhook deliveries" ON public.webhook_deliveries
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

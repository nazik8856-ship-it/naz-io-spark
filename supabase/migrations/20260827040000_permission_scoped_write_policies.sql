-- "15 more items" plan, item 5, continued: narrows the existing "Team
-- owners can manage..." policies (Phase 3, plus the two added earlier
-- this round for webhooks and policy_versions) to require the matching
-- permission category, not just the bare 'owner' role. DROP + CREATE per
-- this project's own established convention for changing an existing
-- policy/constraint's condition (mirrors how agent_decisions_source_check
-- has been extended each time a new source value was added).
--
-- Deliberately NOT touched: "Team owners can update owner's strictness"
-- on public.profiles. That policy is ROW-level (profiles has no per-column
-- RLS), so narrowing it under 'spend' would also incidentally gate any
-- OTHER column a team owner might legitimately need to update on the
-- account owner's profile row -- including, once a future item wires
-- KillSwitchPanel.tsx onto a real cross-account path, the kill switch
-- itself. Folding a switch that consequential under the 'spend' category
-- by accident is a bigger, separate decision than this item is scoped to
-- make -- left gated on plain 'owner' role for now, same as today.

-- ---- policy: hard rules, safety rules, policy versions ---------------------
DROP POLICY IF EXISTS "Team owners can manage owner's hard rules" ON public.hard_rules;
CREATE POLICY "Team owners can manage owner's hard rules" ON public.hard_rules
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner', 'policy'))
  WITH CHECK (public.is_account_member(user_id, 'owner', 'policy'));

DROP POLICY IF EXISTS "Team owners can manage owner's safety rules" ON public.safety_rules;
CREATE POLICY "Team owners can manage owner's safety rules" ON public.safety_rules
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner', 'policy'))
  WITH CHECK (public.is_account_member(user_id, 'owner', 'policy'));

DROP POLICY IF EXISTS "Team owners can manage owner's policy versions" ON public.policy_versions;
CREATE POLICY "Team owners can manage owner's policy versions" ON public.policy_versions
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner', 'policy'))
  WITH CHECK (public.is_account_member(user_id, 'owner', 'policy'));

-- ---- spend: the AI spend cap ------------------------------------------------
DROP POLICY IF EXISTS "Team owners can create owner's spend cap" ON public.ai_spend_caps;
CREATE POLICY "Team owners can create owner's spend cap" ON public.ai_spend_caps
  FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(user_id, 'owner', 'spend'));

DROP POLICY IF EXISTS "Team owners can update owner's spend cap" ON public.ai_spend_caps;
CREATE POLICY "Team owners can update owner's spend cap" ON public.ai_spend_caps
  FOR UPDATE TO authenticated
  USING (public.is_account_member(user_id, 'owner', 'spend'))
  WITH CHECK (public.is_account_member(user_id, 'owner', 'spend'));

-- ---- integrations: webhooks (api_keys writes are gated in the edge
-- function itself via resolveAccountScope, not a table RLS policy -- see
-- api-keys/index.ts) --------------------------------------------------------
DROP POLICY IF EXISTS "Team owners can manage owner's webhooks" ON public.webhooks;
CREATE POLICY "Team owners can manage owner's webhooks" ON public.webhooks
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner', 'integrations'))
  WITH CHECK (public.is_account_member(user_id, 'owner', 'integrations'));

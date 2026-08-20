-- RBAC Phase 3: extend WRITE access to team members with the 'owner' role
-- (hard rules, safety rules, spend cap, strictness), completing the gap
-- deliberately left open after Phase 2 (which only gave read access +
-- approval co-sign + kill switch). Same additive-policy discipline as
-- Phase 2: new policies alongside the existing owner-only ones, never
-- rewriting them, so nothing already granted is narrowed.
--
-- NOT extended: DELETE on ai_spend_caps (no such policy exists even for
-- the account owner today, so there's nothing to mirror).

CREATE POLICY "Team owners can manage owner's hard rules" ON public.hard_rules
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner'))
  WITH CHECK (public.is_account_member(user_id, 'owner'));

CREATE POLICY "Team owners can manage owner's safety rules" ON public.safety_rules
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner'))
  WITH CHECK (public.is_account_member(user_id, 'owner'));

CREATE POLICY "Team owners can create owner's spend cap" ON public.ai_spend_caps
  FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(user_id, 'owner'));

CREATE POLICY "Team owners can update owner's spend cap" ON public.ai_spend_caps
  FOR UPDATE TO authenticated
  USING (public.is_account_member(user_id, 'owner'))
  WITH CHECK (public.is_account_member(user_id, 'owner'));

-- profiles.control_strictness: the existing UPDATE policy is row-scoped to
-- auth.uid() = id, which blocks a team owner (different uid) from updating
-- the account owner's profile row at all, regardless of column grants. This
-- adds the row-level permission; the column-level GRANT UPDATE
-- (control_strictness) already applies broadly to `authenticated`, not
-- per-user, so it should already cover team owners once the row-level
-- check passes -- VERIFY this with a live functional test (rolled-back
-- transaction, same pattern as Phase 2) once DB access is available, same
-- as everything else in this migration.
CREATE POLICY "Team owners can update owner's strictness" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_account_member(id, 'owner'))
  WITH CHECK (public.is_account_member(id, 'owner'));

-- Read-access gaps found while wiring the account switcher: Phase 2's
-- table list didn't include profiles, ai_spend_caps, or ai_spend_daily, so
-- a team member (any role) currently can't even SELECT the account
-- owner's kill-switch/strictness state, spend cap, or today's spend --
-- meaning the panels that read them would silently render as empty/zero
-- for a team member with no indication anything was wrong. Additive SELECT
-- policies, any active role, same pattern as Phase 2.
CREATE POLICY "Team members can view owner's profile" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_account_member(id));

CREATE POLICY "Team members can view owner's spend cap" ON public.ai_spend_caps
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team members can view owner's spend usage" ON public.ai_spend_daily
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

CREATE POLICY "Team members can view owner's shadow rule hits" ON public.hard_rule_shadow_hits
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));

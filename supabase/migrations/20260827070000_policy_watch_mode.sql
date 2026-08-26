-- "15 more items" plan, item 13: let a whole DRAFT policy version
-- "watch" real live traffic for a few days before it goes live, instead
-- of only ever being checked against the 30 fixed scenarios (replayDraft)
-- or a one-time historical batch (replayRealTraffic). Distinct from the
-- existing per-RULE shadow_mode on hard_rules/safety_rules (2026-08-09 /
-- 2026-08-22), which flags one rule at a time -- this flags an entire
-- draft policy VERSION, continuously, going forward.
ALTER TABLE public.policy_versions
  ADD COLUMN IF NOT EXISTS watching boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS watching_since timestamptz;

-- One row per live decision per watching draft: what the real active gate
-- actually decided (active_outcome) next to what this draft would have
-- decided for the identical action (draft_outcome), both in the same
-- GateOutcome vocabulary policy-replay.ts already uses (pass_through /
-- require_approval / block) so the existing diffRealAction /
-- summarizeRealTrafficReplay helpers can classify and aggregate these
-- rows exactly like a real-traffic replay batch, without duplicating that
-- logic. `changed` is a denormalized fast-filter column, not a source of
-- truth -- the real regression/improvement classification is computed at
-- summary time.
CREATE TABLE IF NOT EXISTS public.policy_watch_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL REFERENCES public.policy_versions(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.agent_decisions(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  provider text,
  active_outcome text NOT NULL,
  draft_outcome text NOT NULL,
  changed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.policy_watch_observations TO authenticated;
GRANT ALL ON public.policy_watch_observations TO service_role;

ALTER TABLE public.policy_watch_observations ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users, same as hard_rule_shadow_hits /
-- safety_rule_shadow_hits -- every insert comes from the service-role
-- client inside control-gate.ts's runControlGate, never from a
-- user-authenticated request. Team members can read too, matching
-- policy_versions' own "Team members can view owner's policy versions"
-- read policy (any role, no permission gate -- this is visibility, not a
-- write).
CREATE POLICY "Owners and team members read their policy watch observations"
  ON public.policy_watch_observations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_account_member(user_id));

CREATE INDEX policy_watch_observations_version_idx
  ON public.policy_watch_observations (policy_version_id, created_at DESC);

-- Watching is rare (a handful of drafts across an account at any time) --
-- a partial index keeps the "which drafts is this account watching right
-- now" lookup, run once per live decision, cheap even at scale.
CREATE INDEX policy_versions_watching_idx
  ON public.policy_versions (user_id) WHERE watching = true;

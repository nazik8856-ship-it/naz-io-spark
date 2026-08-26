-- "Zero human review" plan, item 6: let an account test-drive a NEW
-- on_uncertain policy for an api key in shadow mode first -- see what it
-- WOULD have decided on real escalations, without it actually taking
-- effect, before trusting it with real traffic. Same idea this project
-- already applies twice: per-rule shadow_mode on hard_rules/safety_rules
-- (20260809024150_..., 20260822030000_safety_rules_shadow_mode.sql) and
-- whole-draft-policy-version watching (policy_watch_observations,
-- 20260827070000_policy_watch_mode.sql). Applied here to an api key's
-- OWN auto-resolve policy instead.
--
-- Deliberately a SEPARATE column from on_uncertain, not a "trial" flag on
-- it -- the account's REAL policy (on_uncertain, possibly still
-- 'human_review') keeps governing every actual escalation the entire
-- time a shadow value is set here; nothing about resolution behavior
-- changes until the account explicitly copies this value over to
-- on_uncertain itself.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS shadow_on_uncertain text
    CHECK (shadow_on_uncertain IS NULL OR shadow_on_uncertain IN ('human_review', 'auto_deny', 'auto_allow', 'auto_narrow', 'callback'));

-- One row per escalation where a shadow policy was configured: what that
-- policy WOULD have resolved to, computed the same instant the real
-- escalation happened (resolveSweepFallback -- the exact same pure
-- fallback logic item 5's safety-net sweep already uses, since both
-- problems are identical in shape: "what would this policy value decide,
-- with no live model output or caller system left to actually consult").
-- Deliberately does NOT also store the real/actual outcome -- that's read
-- live from pending_approvals.status (via approval_id) at summary time,
-- so a shadow observation taken before a human later resolves the real
-- row is still compared correctly without ever needing a second write
-- back to this table.
CREATE TABLE IF NOT EXISTS public.api_key_shadow_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  approval_id uuid NOT NULL REFERENCES public.pending_approvals(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  provider text,
  shadow_resolution text NOT NULL CHECK (shadow_resolution IN ('approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.api_key_shadow_observations TO authenticated;
GRANT ALL ON public.api_key_shadow_observations TO service_role;

ALTER TABLE public.api_key_shadow_observations ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users, same as policy_watch_observations --
-- every insert comes from the service-role client inside
-- createPendingApproval, never from a user-authenticated request.
CREATE POLICY "Owners and team members read their api key shadow observations"
  ON public.api_key_shadow_observations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_account_member(user_id));

CREATE INDEX api_key_shadow_observations_key_idx
  ON public.api_key_shadow_observations (api_key_id, created_at DESC);

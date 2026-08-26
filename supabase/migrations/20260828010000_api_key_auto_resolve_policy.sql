-- "Zero human review" plan, item 1: let an API key say what should happen
-- when the deterministic gate (hard rules, safety scanner) can't cleanly
-- allow or block an action outright -- today that "needs a second look"
-- outcome always creates a pending_approvals row only a NazAI-account-side
-- human can resolve (control-gate.ts:587,705,751), with no way for an
-- external company depending on this API to avoid it or even know it
-- happened.
--
-- Default 'human_review' is a NO-OP: every existing key keeps today's
-- exact behavior (a real pending_approvals row, a human resolves it)
-- until an account explicitly opts into automatic resolution.
--
-- Deliberately only two automatic values, not a confidence-floor option --
-- the deterministic layer this policy governs (hard rules, safety
-- scanner) has no numeric confidence score to compare against a floor,
-- only "this needs a second look" or not. A confidence-floor-based option
-- belongs to the AI-scored path (a later item in this same round), which
-- genuinely has a score to use.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS on_uncertain text NOT NULL DEFAULT 'human_review'
    CHECK (on_uncertain IN ('human_review', 'auto_deny', 'auto_allow'));

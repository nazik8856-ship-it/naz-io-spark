-- "Knowledge & autonomy" plan, item 4: teach the existing weekly audit-
-- integrity sweep (audit-integrity-sweep/index.ts) to also check
-- knowledge-base (item 1) health -- an entry that's gone stale (no
-- matching real decision in a long time) or unreachable (an
-- always_block hard rule already shadows its exact scope) -- the same
-- way this sweep already catches a tampered/unsigned decision record, a
-- policy-inconsistent auto-resolution, a bad precedent citation, and
-- unexplained decision flip-flopping.
ALTER TABLE public.audit_integrity_runs
  ADD COLUMN IF NOT EXISTS knowledge_base_checked integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS knowledge_base_mismatched integer NOT NULL DEFAULT 0;

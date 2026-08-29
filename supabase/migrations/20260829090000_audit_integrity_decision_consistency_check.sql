-- "Policy autonomy" plan, item 15: teach the existing weekly audit-
-- integrity sweep (audit-integrity-sweep/index.ts) to also check
-- decision consistency -- does the same kind of request get a
-- consistent verdict over time, or is there real, unexplained flip-
-- flopping -- the same way this sweep already catches a tampered/
-- unsigned decision record, a policy-inconsistent auto-resolution, and a
-- bad precedent citation.
ALTER TABLE public.audit_integrity_runs
  ADD COLUMN IF NOT EXISTS decision_consistency_checked integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decision_consistency_mismatched integer NOT NULL DEFAULT 0;

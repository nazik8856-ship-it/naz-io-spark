-- "Zero human review" plan, item 15: teach the existing weekly
-- audit-integrity sweep (audit-integrity-sweep/index.ts,
-- 20260823060000_audit_integrity_sweep.sql) to also re-evaluate every
-- auto-approved decision in range against the account's CURRENT policy
-- snapshot, catching a bug in the automation itself (something
-- auto-approved that a live policy would now block or require approval
-- for) the same way this sweep already catches a tampered/unsigned
-- decision record.
ALTER TABLE public.audit_integrity_runs
  ADD COLUMN IF NOT EXISTS auto_resolutions_checked integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_resolutions_mismatched integer NOT NULL DEFAULT 0;

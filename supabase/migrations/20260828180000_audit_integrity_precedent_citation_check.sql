-- "Real precedent memory" plan, item 15: teach the existing weekly
-- audit-integrity sweep (audit-integrity-sweep/index.ts) to also
-- re-check every real precedent citation (item 9's own
-- agent_decisions.precedent_citations) recorded in range -- did that
-- precedent genuinely exist, and did it genuinely support the verdict
-- it's attached to -- catching a bug in the real-precedent memory
-- system itself, the same way this sweep already catches a tampered/
-- unsigned decision record and a policy-inconsistent auto-resolution.
ALTER TABLE public.audit_integrity_runs
  ADD COLUMN IF NOT EXISTS precedent_citations_checked integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precedent_citations_mismatched integer NOT NULL DEFAULT 0;

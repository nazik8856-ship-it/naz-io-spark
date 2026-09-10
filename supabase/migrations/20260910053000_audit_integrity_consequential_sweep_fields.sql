-- "Sweep safety & observability" plan, item 5: audit_integrity_runs gets 2
-- more optional columns for the new consequential-sweep-justification
-- dimension, same pattern as every prior dimension this table already
-- carries (auto_resolutions_*, precedent_citations_*, decision_consistency_*,
-- knowledge_base_*).
ALTER TABLE public.audit_integrity_runs
  ADD COLUMN IF NOT EXISTS consequential_sweep_actions_checked integer,
  ADD COLUMN IF NOT EXISTS consequential_sweep_actions_unjustified integer;

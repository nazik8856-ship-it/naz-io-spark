-- "Policy autonomy" plan, item 1: a hard rule or safety rule has a
-- condition and an effect, but nowhere to record WHY it exists. Add a
-- real rationale field to both, so the reasoning behind a rule survives
-- past whoever wrote it -- surfaced in the decision reasoning/audit
-- trail when the rule actually fires, not just its mechanics.
--
-- Nullable and additive: existing rules simply have no rationale yet
-- until a human (or, from item 9 onward, an auto-drafted shadow rule)
-- sets one -- no backfill, no required-field migration.
ALTER TABLE public.hard_rules
  ADD COLUMN IF NOT EXISTS rationale text;

ALTER TABLE public.safety_rules
  ADD COLUMN IF NOT EXISTS rationale text;

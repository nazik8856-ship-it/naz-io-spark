-- "Zero human review" plan, item 3: adds "auto_narrow" as a fourth
-- on_uncertain policy value -- retry a model-suggested narrower version
-- of the action (control-engine's new structured modified_params field)
-- automatically, re-checked against the deterministic gate before ever
-- being auto-allowed, falling back to a denial rather than a blind
-- allow when the narrowed version still trips something or when there's
-- nothing structured to retry with at all.
--
-- Extends, not replaces, item 1's CHECK constraint -- same DROP-then-
-- CREATE technique this project always uses for extending a CHECK
-- constraint (agent_decisions_source_check's own history).
ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_on_uncertain_check;
ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_on_uncertain_check
  CHECK (on_uncertain IN ('human_review', 'auto_deny', 'auto_allow', 'auto_narrow'));

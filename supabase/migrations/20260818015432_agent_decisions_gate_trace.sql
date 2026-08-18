-- Persists the full gate decision trace (every layer checked, not just the
-- one that stopped the action) on the decision record itself, so a "why"
-- drill-down UI can show historical decisions' full checklists, not just
-- live ones from the current response.
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS gate_trace jsonb;

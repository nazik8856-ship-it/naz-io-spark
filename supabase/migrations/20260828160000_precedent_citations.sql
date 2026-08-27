-- "Real precedent memory" plan, item 9: "the AI decided this partly
-- because of precedent" isn't good enough for a company that needs to
-- explain its own automated decisions to ITS customers or auditors. When
-- precedent materially changed a verdict, record exactly which past
-- decisions were cited and why -- the same "never a black box" idea
-- gate-trace.ts already established for the deterministic gate layers
-- (see the agent_decisions.gate_trace column), applied here to a
-- precedent-informed override specifically.
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS precedent_citations jsonb;

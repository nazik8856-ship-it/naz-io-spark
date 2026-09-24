-- Pillar 2 top-10 item 9: a "modify" verdict's actual narrowed parameters
-- (the real structured payload the model suggested running instead --
-- fewer recipients, a smaller amount, a redacted field) were computed
-- (parsed.modified_params, extractNarrowedAction) and used internally for
-- the auto-narrow-retry re-check, but never saved anywhere -- history shows
-- the action was narrowed (the free-text `modification` summary is in
-- `reasoning`) but never what it was actually narrowed TO.
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS modified_params jsonb;

COMMENT ON COLUMN public.agent_decisions.modified_params IS
  'Only set for a "modify" verdict with a genuine, non-empty narrower params object (see extractNarrowedAction). Written once at insert time, same as every other narrative column on this append-only table.';

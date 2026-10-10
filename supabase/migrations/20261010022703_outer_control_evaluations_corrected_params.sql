-- GAP 6 (Visible Control Decision Trail, 2026-10-10): outer-control/index.ts
-- computes a real suggestedCorrection (repaired params, removed fields,
-- verified_clean, confidence) for a blocked/escalated action and returns it
-- in the live API response (`suggested_correction`), but never persisted it
-- -- the only place it existed was that one HTTP response. Unlike Inner
-- Control's agent_decisions, which stores BOTH params (before) and
-- modified_params (after) on the row itself, an Outer Control action
-- evaluation had no "after" column at all once that response was gone.
ALTER TABLE public.outer_control_evaluations
  ADD COLUMN IF NOT EXISTS corrected_params jsonb;

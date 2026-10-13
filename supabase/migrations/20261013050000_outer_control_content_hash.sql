-- Outer Control: a replayed external_id is only answered when the text is the same.
ALTER TABLE public.outer_control_evaluations
  ADD COLUMN IF NOT EXISTS content_hash text;

-- Outer Control brain: structured working memory, the decision stored per step, and the
-- one-time request tightening applied after repeated rule violations.
ALTER TABLE public.outer_control_memory ADD COLUMN data jsonb;
ALTER TABLE public.outer_control_session_steps ADD COLUMN decision jsonb;
ALTER TABLE public.outer_control_sessions
  ADD COLUMN request_mods_used integer NOT NULL DEFAULT 0,
  ADD COLUMN request_mods jsonb;

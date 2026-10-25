-- Durable Outer Control sessions. A run that is cut off (the edge function's time limit, a restart, a crash) leaves its lease
-- to run out; the session sweep (every minute) claims it again and the session carries on from its last recorded step. These
-- columns record that it happened, so the page can say so, and stop a step that is cut off again and again instead of looping.
ALTER TABLE public.outer_control_sessions
  ADD COLUMN IF NOT EXISTS interruptions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interrupted_step integer,
  ADD COLUMN IF NOT EXISTS interrupted_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resumed_at timestamptz;

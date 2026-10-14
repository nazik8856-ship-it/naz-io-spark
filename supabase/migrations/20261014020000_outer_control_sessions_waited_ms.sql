-- Time a session spends waiting for a person must not count against its time limit.
ALTER TABLE public.outer_control_sessions ADD COLUMN IF NOT EXISTS waited_ms bigint NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.outer_control_sessions.waited_ms IS 'Time spent waiting for a person; excluded from the session time limit.';

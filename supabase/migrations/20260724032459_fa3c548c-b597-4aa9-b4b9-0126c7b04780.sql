ALTER TABLE public.agent_events
  ADD COLUMN IF NOT EXISTS reasoning text,
  ADD COLUMN IF NOT EXISTS confidence text;
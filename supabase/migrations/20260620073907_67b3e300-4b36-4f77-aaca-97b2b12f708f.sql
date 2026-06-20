ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs;
ALTER TABLE public.agent_events REPLICA IDENTITY FULL;
ALTER TABLE public.agent_runs REPLICA IDENTITY FULL;
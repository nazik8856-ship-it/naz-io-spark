-- Task #51: the unified Control live feed (ControlLiveFeed.tsx) now
-- subscribes to postgres_changes INSERT on outer_control_evaluations
-- alongside agent_decisions -- but that subscription silently never fires
-- without this table in the realtime publication, exactly the gap live
-- verification caught (agent_decisions was already enabled here since
-- 20260801013342; this table, added later, never was).
ALTER TABLE public.outer_control_evaluations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.outer_control_evaluations;

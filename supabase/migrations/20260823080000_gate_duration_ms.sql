-- 2026-08-23 plan item 12: control gate observability (latency). Zero
-- timing existed anywhere -- TraceEntry has no timestamp field,
-- agent_decisions has no duration column, created_at is a single point in
-- time. Nullable: only decisions the gate itself logs (kill switch, spend
-- cap, hard rule, circuit breaker, safety scanner, anomaly detector,
-- gate_error) get a value -- the allow path's own decision row is logged
-- later by the caller after model scoring, not by the gate itself, so it
-- has nothing gate-timing-specific to attach here.
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS gate_duration_ms integer;

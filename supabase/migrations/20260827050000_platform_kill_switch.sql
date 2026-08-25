-- "15 more items" plan, item 7: a real platform-wide "pause everything"
-- emergency switch. Every kill switch in this codebase today -- including
-- the one in KillSwitchPanel.tsx literally labeled "GLOBAL KILL SWITCH" --
-- only ever flips profiles.kill_switch for the one account operating it
-- (`.eq("id", user.id)`). There is no way for a platform operator to halt
-- decision-gating across every account at once during a genuine
-- platform-wide incident (a shared LLM provider outage, a cross-tenant
-- attack). Scoped deliberately narrow, per the plan's own honesty flag: a
-- single blunt on/off blocking every NEW decision across every account
-- until an operator clears it, not a granular per-severity system.

-- Singleton-row table -- the fixed id=1 constraint is the standard
-- Postgres idiom for "exactly one row, ever," so there's no ambiguity
-- about which row control-gate.ts should read.
CREATE TABLE public.platform_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  kill_switch boolean NOT NULL DEFAULT false,
  kill_switch_reason text,
  kill_switch_updated_at timestamptz,
  kill_switch_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.platform_settings (id, kill_switch) VALUES (1, false);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Readable by any logged-in user -- a non-sensitive boolean status flag,
-- same posture as this project already takes with e.g. capability-status.
-- The real enforcement point (control-gate.ts) always reads it via the
-- service-role admin client anyway, which bypasses RLS entirely; this
-- policy is for the operator UI page reading it with the caller's own JWT.
CREATE POLICY "Any authenticated user can view the platform kill switch" ON public.platform_settings
  FOR SELECT TO authenticated USING (true);

-- Only a platform admin/owner (the same has_role() check
-- OpsPlatformIncidents.tsx already gates its own page on) may flip it.
CREATE POLICY "Platform admins can update the platform kill switch" ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));

GRANT SELECT ON public.platform_settings TO authenticated;
GRANT UPDATE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

-- New AgentDecisionSource values BEFORE anything ever logs a decision with
-- them -- this project has hit the "used before the CHECK constraint
-- knows about it" bug three times already (20260818015349, 20260823010000,
-- 20260826030000), so this migration lands ahead of the code that uses
-- 'platform_kill_switch', same discipline as every prior source addition.
--
-- While auditing this constraint's history to add that one, found a
-- fourth, PRE-EXISTING instance of the exact same bug that was never
-- caught: KillSwitchPanel.tsx has inserted `source: "kill_switch_flip"`
-- on every account-level kill-switch flip since that component existed,
-- and 'kill_switch_flip' has never once appeared in any version of this
-- constraint (checked every migration that has ever touched it). Every
-- kill-switch flip in this project's history has silently failed to log
-- an audit row. Fixed here, alongside the two genuinely new values this
-- item needs ('platform_kill_switch' for a block caused by the new
-- platform-wide switch, 'platform_kill_switch_flip' for a flip of it) --
-- same migration, since all three are the identical fix applied to the
-- identical constraint, not separate work.
ALTER TABLE public.agent_decisions
  DROP CONSTRAINT IF EXISTS agent_decisions_source_check;

ALTER TABLE public.agent_decisions
  ADD CONSTRAINT agent_decisions_source_check CHECK (
    source IN (
      'model',
      'human_override',
      'kill_switch',
      'ai_spend_cap',
      'agent_kill_switch',
      'agent_ai_spend_cap',
      'hard_rule',
      'circuit_breaker',
      'circuit_breaker_trip',
      'safety_scanner',
      'anomaly_detector',
      'gate_error',
      'external_api',
      'platform_kill_switch',
      'platform_kill_switch_flip',
      'kill_switch_flip'
    )
  );

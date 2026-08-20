-- Wave 5, session 1: per-agent policy scoping (hard rules + safety rules
-- only -- see note at the end on why spend cap / strictness are
-- deliberately NOT part of this migration).
--
-- Today every hard rule / safety rule applies identically to every agent
-- on the account. A customer running several distinct agents (a sales
-- bot, a support bot, an ops bot) has no way to say "the support bot can
-- auto-refund under $50, the ops bot must never touch billing" -- one
-- blunt policy applies to everyone. NULL agent_id (the default for every
-- existing row) keeps today's exact behavior: account-wide. A non-null
-- agent_id scopes the rule to that one agent, and takes precedence over
-- the account-wide default when both would otherwise match the same
-- action (see _shared/rule-matching.ts's selectRulesForAgent -- already
-- wired into control-gate.ts, safety-scanner.ts, and rule-simulator).

ALTER TABLE public.hard_rules
  ADD COLUMN agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE;

ALTER TABLE public.safety_rules
  ADD COLUMN agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE;

CREATE INDEX idx_hard_rules_agent ON public.hard_rules (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_safety_rules_agent ON public.safety_rules (agent_id) WHERE agent_id IS NOT NULL;

-- RLS: the existing "own hard rules" / "own safety rules" policies
-- (scoped by user_id = auth.uid()) already cover every row regardless of
-- agent_id -- an account owner manages all of their own rules, agent-
-- scoped or not, through the same policy. No RLS change needed here.
-- (RBAC Phase 2/3's team-member policies on these same tables are
-- similarly unaffected -- they're also scoped by the rule's user_id, not
-- by which agent the rule targets.)

-- Deliberately NOT included in this migration: ai_spend_caps and
-- profiles.control_strictness. Both need real product decisions, not
-- code assumptions, before they can be scoped per-agent:
--   - ai_spend_caps.user_id is today's PRIMARY KEY (one row per account,
--     by design) -- supporting per-agent caps means restructuring the
--     primary key (a real schema change, not just adding a column) AND
--     building per-agent spend tracking first, since ai_spend_daily is
--     account-aggregated only today.
--   - More importantly: spend-guard.ts's 100%-of-cap behavior trips the
--     ACCOUNT-WIDE kill switch, stopping every agent, not just the one
--     that overspent. Whether an agent-level cap should trip only that
--     agent or still the whole account is a genuine, consequential
--     product decision -- not something to assume silently while
--     touching safety/financial-control logic. Flagged for the user
--     before this gets built, not guessed at here.
--   - profiles.control_strictness scoping (a new agent_strictness_
--     overrides table) is lower-risk and can follow once the above is
--     resolved, or independently in a later pass.

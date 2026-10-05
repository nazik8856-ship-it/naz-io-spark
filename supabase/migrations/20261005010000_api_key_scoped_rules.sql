-- GAP 1 (Shared Criteria Library): hard_rules/safety_rules can already be
-- scoped to one agent (agent_id) or left account-wide (agent_id null). An
-- external AI connected via an api_keys row had no equivalent -- there was
-- no way to write a rule that governs ONE connected platform specifically,
-- only every one of them at once via an account-wide rule. This mirrors
-- agent_id's exact shape (nullable FK, cascade delete, partial index over
-- the non-null rows only) for api_key_id, so the same selectRulesForEntity
-- scoping logic (supabase/functions/_shared/rule-matching.ts) can resolve
-- rules for either entity kind.
--
-- A rule scoped to both an agent AND an api key at once would be
-- ambiguous (which entity's decisions does it even apply to?) -- the CHECK
-- constraint below rules that out at the schema level rather than leaving
-- it to application code to never do it by accident.
alter table public.hard_rules
  add column api_key_id uuid references public.api_keys(id) on delete cascade;

alter table public.safety_rules
  add column api_key_id uuid references public.api_keys(id) on delete cascade;

alter table public.hard_rules
  add constraint hard_rules_single_scope_chk
  check (not (agent_id is not null and api_key_id is not null));

alter table public.safety_rules
  add constraint safety_rules_single_scope_chk
  check (not (agent_id is not null and api_key_id is not null));

create index idx_hard_rules_api_key on public.hard_rules (api_key_id) where api_key_id is not null;
create index idx_safety_rules_api_key on public.safety_rules (api_key_id) where api_key_id is not null;

-- Outer Control System, v2: content_kind='action' execution support.
--
-- v1 (20260926020748_outer_control_evaluations.sql) reserved content_kind
-- but only ever wrote 'text' rows. This adds the columns an 'action' row
-- needs: the structured action itself (action_type/action_provider/
-- action_params, mirroring control-api's own action shape), a link to
-- whatever agent_decisions row the deterministic gate logged while judging
-- it (null on a clean allow -- the gate's own documented fallthrough
-- behavior), and the real-world execution outcome once NazAI has actually
-- carried the action out via runProviderWrite.
alter table public.outer_control_evaluations
  add column action_type text,
  add column action_provider text,
  add column action_params jsonb,
  add column decision_id uuid references public.agent_decisions(id) on delete set null,
  add column executed boolean not null default false,
  add column execution_summary text,
  add column execution_ref text,
  add column execution_url text;

comment on column public.outer_control_evaluations.action_type is 'Only set when content_kind = ''action'' -- the proposed action type (e.g. send_email), same vocabulary as agent_decisions.action_type.';
comment on column public.outer_control_evaluations.executed is 'True only when NazAI actually carried the action out via runProviderWrite after an allow verdict. Always false for content_kind = ''text'' and for any non-allow verdict.';

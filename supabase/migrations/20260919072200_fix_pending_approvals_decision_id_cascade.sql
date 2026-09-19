-- pending_approvals.decision_id was the one FK on this table left as NO ACTION
-- while every other nullable FK here (agent_id, assigned_to, run_id) already
-- uses ON DELETE SET NULL. That meant deleting an agent -- which cascades to
-- delete its agent_decisions rows -- hit this FK mid-cascade and failed the
-- whole delete with a 23503 violation, silently from the caller's point of
-- view whenever the error message wasn't surfaced. Bringing it in line with
-- its siblings: the pending_approvals row (a real approval/audit record) is
-- preserved, only its now-gone decision reference is cleared.
alter table public.pending_approvals
  drop constraint pending_approvals_decision_id_fkey,
  add constraint pending_approvals_decision_id_fkey
    foreign key (decision_id) references public.agent_decisions(id) on delete set null;

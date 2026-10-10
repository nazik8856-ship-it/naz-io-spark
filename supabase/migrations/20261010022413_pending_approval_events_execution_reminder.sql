-- GAP 5 (Action Execution Feedback Loop, 2026-10-10): approval-escalation-
-- sweep now also inserts an "execution_reminder" timeline entry when an
-- APPROVED action has sat un-executed past EXECUTION_REMINDER_HOURS.
-- pending_approval_events.event_type's CHECK constraint only allowed
-- 'assigned', 'escalated', 'auto_resolved' -- without this, every one of
-- those inserts would have silently violated the constraint and been
-- swallowed by the existing "must never block the alert itself" try/catch,
-- leaving the reminder's timeline entry permanently missing.
ALTER TABLE public.pending_approval_events
  DROP CONSTRAINT pending_approval_events_event_type_check;

ALTER TABLE public.pending_approval_events
  ADD CONSTRAINT pending_approval_events_event_type_check
  CHECK (event_type = ANY (ARRAY['assigned'::text, 'escalated'::text, 'auto_resolved'::text, 'execution_reminder'::text]));

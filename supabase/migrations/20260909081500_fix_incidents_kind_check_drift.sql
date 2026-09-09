-- Found while live-verifying content-gap-backlog-sweep: incidents.kind's
-- CHECK constraint had drifted out of sync with _shared/incidents.ts's
-- own INCIDENT_KINDS array (the single source of truth that array was
-- meant to be) -- it was missing THREE kinds already added in earlier
-- rounds (precedent_pipeline_stale, control_api_coordinated_abuse,
-- on_uncertain_auto_downgraded), on top of today's new
-- content_gap_backlog_stale. openIncident's own catch block is
-- deliberately silent ("incident tracking must never break the alert
-- path"), so every one of these four alert kinds has been silently
-- failing to ever create its incident row -- the critical_alerts row and
-- Slack/email delivery all still worked, just with no incident promoted,
-- with nothing surfacing the failure anywhere. Confirmed via a direct
-- diagnostic insert that reproduced the exact constraint violation this
-- migration fixes.
ALTER TABLE public.incidents DROP CONSTRAINT incidents_kind_check;
ALTER TABLE public.incidents ADD CONSTRAINT incidents_kind_check CHECK (kind = ANY (ARRAY[
  'kill_switch_auto'::text,
  'circuit_breaker_trip'::text,
  'gate_error'::text,
  'self_audit_regression'::text,
  'approval_escalated'::text,
  'confidence_miscalibrated'::text,
  'break_glass_override'::text,
  'correlated_breaker_trip'::text,
  'audit_integrity_failure'::text,
  'webhook_delivery_exhausted'::text,
  'integration_revoked'::text,
  'control_api_abuse'::text,
  'gate_error_fail_open'::text,
  'auto_resolution_share_spike'::text,
  'precedent_pipeline_stale'::text,
  'control_api_coordinated_abuse'::text,
  'on_uncertain_auto_downgraded'::text,
  'content_gap_backlog_stale'::text
]));

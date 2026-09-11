-- "Incident lifecycle" front, items 1/2/3/4: today an incident is only
-- ever open or resolved with a free-text note -- no acknowledgment, no
-- assignment, no escalation of its own (the escalation-sweep concept
-- exists for pending_approvals but nothing equivalent watches an incident
-- itself sitting untouched), and no structured root-cause or linkage
-- between related incidents. Verified directly against
-- 20260818023500_incidents.sql and control-incidents/index.ts: status is
-- CHECK'd to exactly ('open','resolved') and the only writable fields at
-- resolution are resolved_at/resolved_by/resolution_note.

-- Item 1: acknowledgment. "Investigating" is deliberately NOT a third
-- status distinct from "acknowledged" -- assigned_to (item 2, this same
-- migration) already carries "someone is actively on this," so a
-- separate status word for the same fact would just be two ways to say
-- the same thing. status becomes open -> acknowledged -> resolved.
ALTER TABLE public.incidents
  DROP CONSTRAINT incidents_status_check;
ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_status_check CHECK (status IN ('open', 'acknowledged', 'resolved'));

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Item 2: assignment -- who is actually working this, so two people don't
-- duplicate effort on the same incident. Nullable: unassigned is the
-- normal starting state, and a resolved incident's assignment is left
-- alone as a historical record of who worked it.
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Item 3 (schema half -- the sweep itself is a separate migration/function):
-- single-fire marker so an incident-escalation-sweep never re-alerts the
-- same incident twice, mirroring pending_approvals.escalated_at exactly.
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS escalation_alerted_at timestamptz;

-- Item 4: structured resolution + linkage. A small, fixed vocabulary
-- (never a free-text category, which would just become another summary
-- field nobody can aggregate on) -- optional, since not every incident's
-- root cause is known or worth categorizing at resolve time.
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS root_cause_category text
    CHECK (root_cause_category IS NULL OR root_cause_category IN (
      'transient_infra', 'configuration_error', 'external_provider_outage',
      'software_bug', 'expected_behavior_misclassified', 'other'
    ));

-- A single self-referencing link, not a many-to-many junction table --
-- "this incident was actually caused by / duplicates that one" is a
-- one-directional pointer to the incident that actually explains it, not
-- a general incident-to-incident graph nothing here has asked for.
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS related_incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_assigned_to ON public.incidents (assigned_to) WHERE assigned_to IS NOT NULL;

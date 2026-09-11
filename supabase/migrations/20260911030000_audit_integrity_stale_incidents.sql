-- "Incident lifecycle" plan, item 5: audit_integrity_runs gets 2 more
-- optional columns for the new stale-incident backstop dimension, same
-- pattern as every prior dimension this table already carries.
ALTER TABLE public.audit_integrity_runs
  ADD COLUMN IF NOT EXISTS stale_incidents_checked integer,
  ADD COLUMN IF NOT EXISTS stale_incidents_flagged integer;

-- Outer Control: the final artifact.
--
-- A session or Task that is Completed carries one official result: a structured artifact (controlled output, proof,
-- rules applied, changes) whose human-readable text is rendered from the same object. See
-- supabase/functions/_shared/outer-control-artifact.ts. Apply this file first; the guards that refuse a "completed"
-- row without an artifact are in the next migration file and are applied only after the new code is deployed.

ALTER TABLE public.outer_control_sessions ADD COLUMN IF NOT EXISTS final_artifact jsonb;
ALTER TABLE public.outer_control_workflows ADD COLUMN IF NOT EXISTS final_artifact jsonb;

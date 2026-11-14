-- Outer Control: the look of a Task's result, chosen before it starts (docs/outer-control-outputs.md).
-- Kept on the Task so the final artifact can carry it; null means "the page's default". The list is the same as OUTPUT_TEMPLATES in
-- outer-control-report-doc.ts. Only the server writes it (start_report); the browser reads it through the artifact.
ALTER TABLE public.outer_control_workflows
  ADD COLUMN IF NOT EXISTS output_template text;

ALTER TABLE public.outer_control_workflows
  DROP CONSTRAINT IF EXISTS outer_control_workflows_output_template_check;
ALTER TABLE public.outer_control_workflows
  ADD CONSTRAINT outer_control_workflows_output_template_check
  CHECK (output_template IS NULL OR output_template IN ('nazai', 'executive', 'editorial', 'brief', 'data'));

-- Every text column has a class (docs/data-classification.md): a look's name is bookkeeping.
INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('outer_control_workflows', 'output_template', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO NOTHING;

-- The weekly classification check (Mondays) was going to open an incident: classes were registered for columns it does not count
-- (the uuid and bigint columns of the recovery-code tables) and for a column that no longer exists (agent_integrations.credentials,
-- dropped when the credentials moved to the vault). Only text, JSON, array and vector columns have a class.
DELETE FROM public.data_classification WHERE table_name = 'mfa_recovery_codes' AND column_name = 'id';
DELETE FROM public.data_classification WHERE table_name = 'mfa_recovery_codes' AND column_name = 'user_id';
DELETE FROM public.data_classification WHERE table_name = 'mfa_recovery_attempts' AND column_name = 'id';
DELETE FROM public.data_classification WHERE table_name = 'mfa_recovery_attempts' AND column_name = 'user_id';
DELETE FROM public.data_classification WHERE table_name = 'agent_integrations' AND column_name = 'credentials';
-- ...and its storage rule ("vault_only" expects a check on a column that is gone).
DELETE FROM public.secret_storage_rules WHERE table_name = 'agent_integrations' AND column_name = 'credentials';

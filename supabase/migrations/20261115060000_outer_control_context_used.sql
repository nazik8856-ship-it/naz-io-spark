-- Outer Control: what the tools were told about the person's situation (docs/outer-control-context.md).
-- A list of {kind, chars, n?}: which sources went into the Context every tool of the Task received (business profile, the person's
-- own notes, knowledge entries, an attached project, background typed for the Task), and how big each was. Never the text itself.
-- Null means "not recorded" (a Task made before this); an empty list means "the tools were given nothing about the situation".
-- Only the server writes it (outer-control-drive, when a Task starts); the browser reads it through the final artifact.
ALTER TABLE public.outer_control_workflows
  ADD COLUMN IF NOT EXISTS context_used jsonb;

ALTER TABLE public.outer_control_workflows
  DROP CONSTRAINT IF EXISTS outer_control_workflows_context_used_check;
ALTER TABLE public.outer_control_workflows
  ADD CONSTRAINT outer_control_workflows_context_used_check
  CHECK (context_used IS NULL OR (jsonb_typeof(context_used) = 'array' AND jsonb_array_length(context_used) <= 8));

-- Every JSON column has a class (docs/data-classification.md): kinds and sizes are bookkeeping, not content.
INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('outer_control_workflows', 'context_used', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO NOTHING;

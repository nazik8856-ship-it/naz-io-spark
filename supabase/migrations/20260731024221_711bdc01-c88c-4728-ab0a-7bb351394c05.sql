CREATE TABLE public.integration_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid,
  provider text NOT NULL,
  tool_kind text NOT NULL DEFAULT 'any',
  error_type text NOT NULL,
  issue_key text NOT NULL,
  title text NOT NULL,
  human_message text NOT NULL,
  fix_action text NOT NULL DEFAULT 'reconnect',
  scope_hint text,
  technical text,
  status text NOT NULL DEFAULT 'open',
  occurrences integer NOT NULL DEFAULT 1,
  resolution jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX integration_issues_unique_open
  ON public.integration_issues (user_id, provider, tool_kind, issue_key);
CREATE INDEX integration_issues_user_status ON public.integration_issues (user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_issues TO authenticated;
GRANT ALL ON public.integration_issues TO service_role;

ALTER TABLE public.integration_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own integration issues"
ON public.integration_issues FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER integration_issues_updated_at
BEFORE UPDATE ON public.integration_issues
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
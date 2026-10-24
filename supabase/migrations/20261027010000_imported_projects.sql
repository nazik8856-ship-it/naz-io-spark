-- Imported projects: an external project brought into NazAI as a one-time copy (snapshot: a link, uploaded files or pasted text)
-- or still linked to its original (linked: a Notion page from a connected Notion workspace). Once imported it is a NazAI project:
-- Inner Control lists it and can hold rules for it, and Outer Control Tasks can use it. NazAI writes to the original only when the
-- owner turned write-back on, and every write still waits for an approval.
--
-- Everyone in the account can read; every write goes through the projects edge function (service role), which checks the
-- account, the limits and the source. Rules for one project live in project_rules, never in the account-wide rule tables, so
-- a project's rule can not apply anywhere else.
CREATE TABLE IF NOT EXISTS public.imported_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  source_mode text NOT NULL CHECK (source_mode IN ('snapshot', 'linked')),
  source_kind text NOT NULL CHECK (source_kind IN ('link', 'file', 'paste', 'notion')),
  source_ref text CHECK (source_ref IS NULL OR char_length(source_ref) <= 2000),
  source_label text NOT NULL DEFAULT '' CHECK (char_length(source_label) <= 200),
  content_type text NOT NULL CHECK (content_type IN ('text', 'markdown', 'html', 'code', 'mixed')),
  content text NOT NULL CHECK (char_length(content) <= 200000),
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_sha256 text NOT NULL,
  -- The last rule check of the content: { at, rules, matches: [{ name, action }] }.
  last_check jsonb,
  write_back boolean NOT NULL DEFAULT false,
  write_back_enabled_at timestamptz,
  integration_id uuid,
  last_synced_at timestamptz,
  sync_error text CHECK (sync_error IS NULL OR char_length(sync_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  -- A snapshot has no original to write to.
  CHECK (source_mode = 'linked' OR write_back = false)
);
CREATE INDEX IF NOT EXISTS imported_projects_user_idx ON public.imported_projects (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.project_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.imported_projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  pattern text NOT NULL CHECK (char_length(pattern) BETWEEN 1 AND 500),
  severity text NOT NULL CHECK (severity IN ('block', 'require_approval')),
  redact boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_rules_project_idx ON public.project_rules (project_id);

-- The project an Outer Control Task works with (its checked text went to every tool).
ALTER TABLE public.outer_control_workflows ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.imported_projects(id) ON DELETE SET NULL;

ALTER TABLE public.imported_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read their imported projects" ON public.imported_projects;
CREATE POLICY "Owners read their imported projects" ON public.imported_projects FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Team members read the owner's imported projects" ON public.imported_projects;
CREATE POLICY "Team members read the owner's imported projects" ON public.imported_projects FOR SELECT USING (is_account_member(user_id));
DROP POLICY IF EXISTS "Owners read their project rules" ON public.project_rules;
CREATE POLICY "Owners read their project rules" ON public.project_rules FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Team members read the owner's project rules" ON public.project_rules;
CREATE POLICY "Team members read the owner's project rules" ON public.project_rules FOR SELECT USING (is_account_member(user_id));
REVOKE ALL ON TABLE public.imported_projects, public.project_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.imported_projects, public.project_rules TO authenticated;
GRANT ALL ON TABLE public.imported_projects, public.project_rules TO service_role;

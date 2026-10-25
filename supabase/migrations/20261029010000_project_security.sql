-- Protecting imported projects.
--
-- 1. A project's text is stored encrypted (content_enc: AES-256-GCM, "v1:<iv>:<ciphertext>"). The key (PROJECTS_KEY) lives only in
--    the edge functions' environment, so the database, its backups and anyone who can read the table see ciphertext. content stays
--    for projects saved before this change until the session sweep encrypts them (then it is emptied).
-- 2. The browser never reads a project's text from the table: the column grants leave out content and content_enc. The page asks
--    the projects edge function, which decrypts it for the account's members.
-- 3. project_events: each project's history (who imported it, renamed, archived, deleted it, changed its rules or its write-back,
--    asked to write to its original). No foreign key: the history of a deleted project is kept.
ALTER TABLE public.imported_projects ADD COLUMN IF NOT EXISTS content_enc text
  CHECK (content_enc IS NULL OR char_length(content_enc) <= 1200000);

REVOKE SELECT ON TABLE public.imported_projects FROM authenticated;
GRANT SELECT (id, user_id, name, source_mode, source_kind, source_ref, source_label, content_type, files, content_sha256, last_check,
  write_back, write_back_enabled_at, integration_id, last_synced_at, sync_error, created_at, updated_at, archived_at)
  ON public.imported_projects TO authenticated;

CREATE TABLE IF NOT EXISTS public.project_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_name text NOT NULL CHECK (char_length(project_name) <= 120),
  actor_id uuid,
  action text NOT NULL CHECK (action IN ('imported', 'refreshed', 'renamed', 'archived', 'restored', 'deleted', 'rule_added', 'rule_removed',
    'write_back_on', 'write_back_off', 'write_back_requested')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_events_project_idx ON public.project_events (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_events_user_idx ON public.project_events (user_id, created_at DESC);

ALTER TABLE public.project_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read their project history" ON public.project_events;
CREATE POLICY "Owners read their project history" ON public.project_events FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Team members read the owner's project history" ON public.project_events;
CREATE POLICY "Team members read the owner's project history" ON public.project_events FOR SELECT USING (is_account_member(user_id));
REVOKE ALL ON TABLE public.project_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.project_events TO authenticated;
GRANT ALL ON TABLE public.project_events TO service_role;

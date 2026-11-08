-- Security task 1: data at rest protection (docs/data-encryption.md, "Data at rest, security task 1").
--
-- 1. The 14 listed columns that held no values yet are locked: the database refuses a write that puts their text in the clear.
--    Every writer was checked: no database function or trigger writes them; every edge function that reaches them uses the
--    encrypting client (src/test/field-encryption.test.ts follows shared modules too); no screen writes them directly.
-- 2. The 11 deferred columns are encrypted: an agent's goal, role, plan and configuration; an API key's reply persona and fallback
--    message; a connected account's metadata (account details, the last synced data); the question standing for a group of
--    unanswered /respond questions; a website's brief; its saved versions. Their readers moved to the server first (outer-control-
--    read, encrypted-write, openRows); the database functions that read them in SQL are replaced (below). Each is marked
--    lock_when_converted: the session sweep converts the existing rows (a batch every five minutes) and then locks the column
--    itself (encryption_lock_converted()), so no code path can store the text in the clear again.
-- 3. The change log (config_changes) never keeps the plain copy of an encrypted column: the trigger drops it (the encrypted copy,
--    bound to the same row, stays, so "Roll back to this" still restores it), and the 183 agent entries that held plain copies are
--    cleaned.
-- 4. Addresses NazAI calls never carry a credential: a user name or password in the address, or a key, token, secret or signature
--    in the query, is refused by the code (url-safety.ts) and by a check on every stored address column.
-- 5. Key rotation: the sweep records which DATA_KEY and PROJECTS_KEY are current; encryption_rotation_report() lists values still
--    on another key, and the weekly check opens an incident when a rotation has not finished within 14 days.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Lock the 14 columns that hold no values yet.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agent_events', 'reasoning'), ('agent_runs', 'instruction'),
    ('api_response_cache', 'answer'), ('api_response_cache', 'message'), ('api_response_cache', 'sources'),
    ('api_response_generations', 'message'), ('integration_snapshots', 'data'), ('knowledge_base_entries', 'entry_text'),
    ('missions', 'directive'), ('outer_control_evaluations', 'execution_summary'), ('outer_control_sessions', 'next_input'),
    ('pending_approvals', 'execution_summary'), ('website_form_submissions', 'fields'), ('website_form_submissions', 'submitter_ip')
  ) AS v(t, c) LOOP
    PERFORM public.encryption_enforce(r.t, r.c);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. The deferred columns.

ALTER TABLE public.encrypted_columns ADD COLUMN IF NOT EXISTS lock_when_converted boolean NOT NULL DEFAULT false;

-- How a reconnect finds its integration row (a Shopify shop, a Notion or Slack workspace): copied out of metadata into plain
-- columns on every write (encrypted-db.ts "project"). Filled here for the existing rows, before metadata is encrypted.
ALTER TABLE public.agent_integrations
  ADD COLUMN IF NOT EXISTS metadata_shop text,
  ADD COLUMN IF NOT EXISTS metadata_workspace_id text,
  ADD COLUMN IF NOT EXISTS metadata_team_id text;
UPDATE public.agent_integrations SET
  metadata_shop = metadata ->> 'shop', metadata_workspace_id = metadata ->> 'workspace_id', metadata_team_id = metadata ->> 'team_id'
WHERE metadata IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_integrations_metadata_shop_idx ON public.agent_integrations (user_id, provider, metadata_shop) WHERE metadata_shop IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_integrations_metadata_workspace_idx ON public.agent_integrations (user_id, provider, metadata_workspace_id) WHERE metadata_workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_integrations_metadata_team_idx ON public.agent_integrations (user_id, provider, metadata_team_id) WHERE metadata_team_id IS NOT NULL;
-- The encrypting client always writes metadata (default {}); the column default would put a plain value next to it.
ALTER TABLE public.agent_integrations ALTER COLUMN metadata DROP DEFAULT;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agents', 'goal'), ('agents', 'manifest'), ('agents', 'role'), ('agents', 'source_plan'),
    ('api_keys', 'response_persona'), ('api_keys', 'fallback_message'),
    ('agent_integrations', 'metadata'),
    ('content_gap_clusters', 'representative_message'),
    ('websites', 'prompt'),
    ('website_versions', 'website_snapshot'), ('website_versions', 'pages_snapshot')
  ) AS v(t, c) LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text', r.t, r.c || '_enc');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    INSERT INTO public.encrypted_columns (table_name, column_name, note, lock_when_converted)
    VALUES (r.t, r.c, 'Encrypted with DATA_KEY (encrypted-db.ts); data at rest, security task 1. Locked by the sweep once converted.', true)
    ON CONFLICT (table_name, column_name) DO UPDATE SET lock_when_converted = true;
    -- No longer deferred: encrypted.
    DELETE FROM public.encryption_exempt_columns WHERE table_name = r.t AND column_name = r.c;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS agents_plain_wins ON public.agents;
CREATE TRIGGER agents_plain_wins BEFORE INSERT OR UPDATE ON public.agents FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('goal', 'manifest', 'role', 'source_plan');
DROP TRIGGER IF EXISTS api_keys_plain_wins ON public.api_keys;
CREATE TRIGGER api_keys_plain_wins BEFORE INSERT OR UPDATE ON public.api_keys FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('response_persona', 'fallback_message');
DROP TRIGGER IF EXISTS agent_integrations_plain_wins ON public.agent_integrations;
CREATE TRIGGER agent_integrations_plain_wins BEFORE INSERT OR UPDATE ON public.agent_integrations FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('metadata');
DROP TRIGGER IF EXISTS content_gap_clusters_plain_wins ON public.content_gap_clusters;
CREATE TRIGGER content_gap_clusters_plain_wins BEFORE INSERT OR UPDATE ON public.content_gap_clusters FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('representative_message');
DROP TRIGGER IF EXISTS websites_plain_wins ON public.websites;
CREATE TRIGGER websites_plain_wins BEFORE INSERT OR UPDATE ON public.websites FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('prompt');
DROP TRIGGER IF EXISTS website_versions_plain_wins ON public.website_versions;
CREATE TRIGGER website_versions_plain_wins BEFORE INSERT OR UPDATE ON public.website_versions FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('website_snapshot', 'pages_snapshot');

INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('agent_integrations', 'metadata_shop', 'OPERATIONAL'),
('agent_integrations', 'metadata_workspace_id', 'OPERATIONAL'),
('agent_integrations', 'metadata_team_id', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;

-- Locks every column marked lock_when_converted that has no plain value left. Called by the session sweep after each conversion
-- run, so a column is locked minutes after its last row is converted. Returns how many columns it locked.
CREATE OR REPLACE FUNCTION public.encryption_lock_converted()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT e.table_name, e.column_name FROM public.encrypted_columns e
    JOIN public.encryption_report() rep ON rep.table_name = e.table_name AND rep.column_name = e.column_name
    WHERE e.lock_when_converted AND e.enforced_at IS NULL AND rep.plain_rows = 0
  LOOP
    PERFORM public.encryption_enforce(r.table_name, r.column_name);
    n := n + 1;
  END LOOP;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.encryption_lock_converted() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encryption_lock_converted() TO service_role;

-- get_business_context(): an agent's goal and role come back sealed with the row id (business-context.ts opens them).
DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_business_context';
  IF src IS NULL OR position('''goal'', a.goal,' IN src) = 0 THEN
    RAISE EXCEPTION 'get_business_context changed: update this migration';
  END IF;
  src := replace(src, '''goal'', a.goal,', '''goal'', a.goal, ''goal_enc'', a.goal_enc,');
  src := replace(src, '''role'', a.role,', '''role'', a.role, ''role_enc'', a.role_enc,');
  EXECUTE src;
END $$;

-- The /respond content gaps: the representative question comes back sealed with its row id (openRows).
CREATE OR REPLACE FUNCTION public.search_gap_clusters_v2(_api_key_id uuid, _embedding vector, _limit integer)
RETURNS TABLE (id uuid, representative_message text, representative_message_enc text, similarity double precision)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY
  SELECT c.id, c.representative_message, c.representative_message_enc, (1 - (c.embedding <=> _embedding))::float AS similarity
  FROM public.content_gap_clusters c
  WHERE c.api_key_id = _api_key_id AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> _embedding
  LIMIT GREATEST(1, LEAST(_limit, 20));
END $fn$;
REVOKE ALL ON FUNCTION public.search_gap_clusters_v2(uuid, vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_gap_clusters_v2(uuid, vector, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.list_gap_clusters_ranked_v2(_api_key_id uuid, _limit integer)
RETURNS TABLE (cluster_id uuid, representative_message text, representative_message_enc text, occurrence_count bigint,
               first_seen_at timestamptz, last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT c.id, c.representative_message, c.representative_message_enc, count(g.id), min(g.created_at), max(g.created_at)
  FROM public.content_gap_clusters c
  JOIN public.api_response_generations g
    ON g.content_gap_cluster_id = c.id AND g.resolved_at IS NULL AND g.is_test = false
  WHERE c.api_key_id = _api_key_id
  GROUP BY c.id, c.representative_message, c.representative_message_enc
  ORDER BY count(g.id) DESC, max(g.created_at) DESC
  LIMIT GREATEST(1, LEAST(_limit, 100));
$fn$;
REVOKE ALL ON FUNCTION public.list_gap_clusters_ranked_v2(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_gap_clusters_ranked_v2(uuid, integer) TO service_role;

DROP FUNCTION IF EXISTS public.search_gap_clusters(uuid, vector, integer);
DROP FUNCTION IF EXISTS public.list_gap_clusters_ranked(uuid, integer);

-- Restoring a website version moves to the server (encrypted-write "restore", website-restore.ts): the snapshots and the brief are
-- encrypted, so SQL can not read them. The pages are still replaced in one call, as the signed-in user (row level security).
DROP FUNCTION IF EXISTS public.restore_website_version(uuid);
CREATE OR REPLACE FUNCTION public.replace_website_pages(_website_id uuid, _pages jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
DECLARE pg jsonb; n integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _pages IS NULL OR jsonb_typeof(_pages) <> 'array' OR jsonb_array_length(_pages) > 200 THEN RAISE EXCEPTION 'pages must be a list of at most 200'; END IF;
  -- The site must be one this user may edit (row level security on websites decides, as for the pages below).
  PERFORM 1 FROM public.websites WHERE id = _website_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Website not found'; END IF;
  DELETE FROM public.website_pages WHERE website_id = _website_id;
  FOR pg IN SELECT * FROM jsonb_array_elements(_pages) LOOP
    INSERT INTO public.website_pages (website_id, slug, title, seo_description, sections, order_index)
    VALUES (_website_id, pg ->> 'slug', pg ->> 'title', pg ->> 'seo_description', COALESCE(pg -> 'sections', '[]'::jsonb),
            COALESCE((pg ->> 'order_index')::int, 0));
    n := n + 1;
  END LOOP;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.replace_website_pages(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_website_pages(uuid, jsonb) TO authenticated, service_role;

-- Site pictures (site-images-cleanup-sweep): the move of pre-2026-11-05 picture folders is finished (no old-style address is left
-- in any page, brief or version), so the helpers that rewrite old addresses no longer look inside the encrypted brief and
-- versions. Whether a deleted site's folder is still named by a saved version is checked by the sweep itself (it reads the versions
-- decrypted); the database checks the plain pages and shared copies.
CREATE OR REPLACE FUNCTION public.site_image_folder_in_use(_site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT _site IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.website_pages WHERE sections::text LIKE '%' || _site::text || '%')
    OR EXISTS (SELECT 1 FROM public.shared_websites WHERE html LIKE '%' || _site::text || '%')
  )
$fn$;
CREATE OR REPLACE FUNCTION public.site_images_refs_count(_prefix text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN coalesce(_prefix, '') !~ '^website-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/$'
    THEN NULL ELSE
      (SELECT count(*) FROM public.website_pages WHERE strpos(sections::text, _prefix) > 0)
    + (SELECT count(*) FROM public.shared_websites WHERE strpos(html, _prefix) > 0)
  END
$fn$;
CREATE OR REPLACE FUNCTION public.site_images_rewrite_refs(_site uuid, _from text, _to text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE n integer := 0; k integer;
BEGIN
  IF _site IS NULL
     OR _from IS NULL OR _from !~ ('^website-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || _site::text || '/$')
     OR _to IS DISTINCT FROM ('website-images/' || _site::text || '/') THEN
    RAISE EXCEPTION 'site_images_rewrite_refs: unexpected folders';
  END IF;
  UPDATE public.website_pages SET sections = replace(sections::text, _from, _to)::jsonb WHERE strpos(sections::text, _from) > 0;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.shared_websites SET html = replace(html, _from, _to) WHERE strpos(html, _from) > 0;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. The change log keeps no plain copy of an encrypted column.
CREATE OR REPLACE FUNCTION public.log_config_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user_id uuid;
  v_row_id uuid;
  v_before jsonb;
  v_after jsonb;
  sealed text[];
BEGIN
  v_before := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_after := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  -- Encrypted columns (encrypted_columns): only their encrypted copy ("<col>_enc", bound to this row) is kept, so the log holds no
  -- text in the clear and a rollback restores the encrypted value.
  SELECT coalesce(array_agg(column_name), '{}') INTO sealed FROM public.encrypted_columns WHERE table_name = TG_TABLE_NAME;
  IF array_length(sealed, 1) > 0 THEN
    v_before := v_before - sealed;
    v_after := v_after - sealed;
  END IF;
  v_user_id := COALESCE((v_after->>'user_id')::uuid, (v_before->>'user_id')::uuid);
  v_row_id := COALESCE((v_after->>'id')::uuid, (v_before->>'id')::uuid, v_user_id);

  INSERT INTO public.config_changes (user_id, actor_id, table_name, row_id, action, before, after)
  VALUES (v_user_id, auth.uid(), TG_TABLE_NAME, v_row_id, lower(TG_OP), v_before, v_after);

  RETURN COALESCE(NEW, OLD);
END $fn$;

UPDATE public.config_changes c SET
  before = CASE WHEN c.before IS NULL THEN NULL ELSE c.before - s.cols END,
  after = CASE WHEN c.after IS NULL THEN NULL ELSE c.after - s.cols END
FROM (SELECT table_name, array_agg(column_name) AS cols FROM public.encrypted_columns GROUP BY table_name) s
WHERE s.table_name = c.table_name AND (coalesce(c.before, '{}'::jsonb) ?| s.cols OR coalesce(c.after, '{}'::jsonb) ?| s.cols);

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. No credential in an address NazAI calls or looks up.
CREATE OR REPLACE FUNCTION public.url_carries_credentials(_url text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT _url IS NOT NULL AND (
       _url ~* '^[a-z][a-z0-9+.-]*://[^/?#@]*@'
    OR _url ~* '[?&#;](access[_-]?token|api[_-]?key|apikey|auth|authorization|client[_-]?secret|key|passwd|password|pwd|secret|sig|signature|token|x-api-key)='
  )
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_tools_endpoint_url_safe') THEN
    ALTER TABLE public.external_tools ADD CONSTRAINT external_tools_endpoint_url_safe
      CHECK (endpoint_url ~* '^(https://|nazai-internal://)' AND NOT public.url_carries_credentials(endpoint_url)) NOT VALID;
    ALTER TABLE public.external_tools VALIDATE CONSTRAINT external_tools_endpoint_url_safe;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhooks_url_safe') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_url_safe
      CHECK (url ~* '^https://' AND NOT public.url_carries_credentials(url)) NOT VALID;
    ALTER TABLE public.webhooks VALIDATE CONSTRAINT webhooks_url_safe;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_callback_url_safe') THEN
    ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_callback_url_safe
      CHECK (callback_url IS NULL OR (callback_url ~* '^https://' AND NOT public.url_carries_credentials(callback_url))) NOT VALID;
    ALTER TABLE public.api_keys VALIDATE CONSTRAINT api_keys_callback_url_safe;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_source_url_safe') THEN
    ALTER TABLE public.business_profiles ADD CONSTRAINT business_profiles_source_url_safe
      CHECK (source_url IS NULL OR NOT public.url_carries_credentials(source_url)) NOT VALID;
    ALTER TABLE public.business_profiles VALIDATE CONSTRAINT business_profiles_source_url_safe;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Key rotation: which key is current, and what is still on another one.
CREATE TABLE IF NOT EXISTS public.encryption_key_state (
  key_name text PRIMARY KEY CHECK (key_name IN ('DATA_KEY', 'PROJECTS_KEY')),
  current_id text NOT NULL CHECK (current_id ~ '^[0-9a-f]{8}$'),
  since timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.encryption_key_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.encryption_key_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.encryption_key_state TO service_role;
INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note)
VALUES ('encryption_key_state', 'system_only', NULL, NULL, 'the id (not the value) of the current DATA_KEY and PROJECTS_KEY, for the rotation check')
ON CONFLICT (table_name) DO NOTHING;
INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('encryption_key_state', 'key_name', 'OPERATIONAL'), ('encryption_key_state', 'current_id', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;

-- Called by the session sweep with the ids of the keys it encrypts with; "since" moves only when the key changes.
CREATE OR REPLACE FUNCTION public.encryption_note_keys(_data_key_id text, _projects_key_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF _data_key_id IS NOT NULL THEN
    INSERT INTO public.encryption_key_state (key_name, current_id) VALUES ('DATA_KEY', _data_key_id)
    ON CONFLICT (key_name) DO UPDATE SET seen_at = now(),
      since = CASE WHEN encryption_key_state.current_id = EXCLUDED.current_id THEN encryption_key_state.since ELSE now() END,
      current_id = EXCLUDED.current_id;
  END IF;
  IF _projects_key_id IS NOT NULL THEN
    INSERT INTO public.encryption_key_state (key_name, current_id) VALUES ('PROJECTS_KEY', _projects_key_id)
    ON CONFLICT (key_name) DO UPDATE SET seen_at = now(),
      since = CASE WHEN encryption_key_state.current_id = EXCLUDED.current_id THEN encryption_key_state.since ELSE now() END,
      current_id = EXCLUDED.current_id;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.encryption_note_keys(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encryption_note_keys(text, text) TO service_role;

-- Every column with values on a key other than the current one (imported projects use PROJECTS_KEY, everything else DATA_KEY).
CREATE OR REPLACE FUNCTION public.encryption_rotation_report()
RETURNS TABLE (table_name text, column_name text, key_name text, current_id text, rotated_since timestamptz, old_values bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT r.table_name, r.column_name, s.key_name, s.current_id, s.since,
         (SELECT coalesce(sum(v::bigint), 0) FROM jsonb_each_text(coalesce(r.keys, '{}'::jsonb)) AS k(id, v) WHERE k.id <> s.current_id)
  FROM public.encryption_report() r
  JOIN public.encryption_key_state s ON s.key_name = CASE WHEN r.table_name = 'imported_projects' THEN 'PROJECTS_KEY' ELSE 'DATA_KEY' END
  WHERE EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(r.keys, '{}'::jsonb)) AS k(id) WHERE k.id <> s.current_id)
$fn$;
REVOKE ALL ON FUNCTION public.encryption_rotation_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encryption_rotation_report() TO service_role;

-- The weekly check also names a rotation that has not finished within 14 days, and a converted column the sweep has not locked.
CREATE OR REPLACE FUNCTION public.encryption_weekly_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE plain jsonb; uncovered jsonb; unlocked jsonb; lock_missing jsonb; rotation jsonb; open_id uuid; result jsonb; problems int;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'plain_rows', plain_rows)), '[]')
    INTO plain FROM public.encryption_report() WHERE plain_rows > 0;
  SELECT coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'type', data_type)), '[]')
    INTO uncovered FROM public.encryption_coverage_report();
  SELECT coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'encrypted_rows', encrypted_rows)), '[]')
    INTO unlocked FROM public.encryption_report() WHERE encrypted_rows > 0 AND NOT enforced;
  SELECT coalesce(jsonb_agg(jsonb_build_object('table', e.table_name, 'column', e.column_name)), '[]')
    INTO lock_missing FROM public.encrypted_columns e
   WHERE e.enforced_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                      WHERE k.conname = left(e.table_name || '_' || e.column_name || '_encrypted', 63)
                        AND k.conrelid = to_regclass('public.' || quote_ident(e.table_name)));
  SELECT coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'key', key_name, 'old_values', old_values,
                                               'rotated_since', rotated_since)), '[]')
    INTO rotation FROM public.encryption_rotation_report() WHERE rotated_since < now() - interval '14 days';
  result := jsonb_build_object('plain', plain, 'uncovered', uncovered, 'unlocked', unlocked, 'lock_missing', lock_missing,
                               'rotation_stalled', rotation, 'checked_at', now());
  problems := jsonb_array_length(plain) + jsonb_array_length(uncovered) + jsonb_array_length(unlocked) + jsonb_array_length(lock_missing)
            + jsonb_array_length(rotation);
  SELECT id INTO open_id FROM public.platform_incidents WHERE kind = 'encryption_check' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF problems > 0 THEN
    IF open_id IS NULL THEN
      INSERT INTO public.platform_incidents (kind, summary, detail) VALUES ('encryption_check',
        format('Data encryption check: %s column(s) with plain values left, %s content column(s) neither encrypted nor exempt, '
          || '%s encrypted column(s) in use without a lock, %s lock(s) missing, %s column(s) still on a previous key 14 days after a '
          || 'rotation. Plain values are converted (and marked columns locked) by outer-control-session-sweep within minutes; an '
          || 'uncovered column needs an _enc twin or an entry in encryption_exempt_columns; an unlocked column is locked with '
          || 'encryption_enforce() once its writers are checked; a missing lock is put back with encryption_enforce(); a stalled '
          || 'rotation: check that DATA_KEY_PREVIOUS / PROJECTS_KEY_PREVIOUS are still set and the sweep runs (docs/secrets-rotation.md).',
          jsonb_array_length(plain), jsonb_array_length(uncovered), jsonb_array_length(unlocked), jsonb_array_length(lock_missing),
          jsonb_array_length(rotation)), result);
    ELSE
      UPDATE public.platform_incidents SET detail = result WHERE id = open_id;
    END IF;
  ELSIF open_id IS NOT NULL THEN
    UPDATE public.platform_incidents SET resolved_at = now(),
      resolution_note = 'All listed columns encrypted and locked, every content column covered, and nothing left on a previous key.' WHERE id = open_id;
  END IF;
  RETURN result;
END $fn$;

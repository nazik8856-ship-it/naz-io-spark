-- Two follow-ups, one migration.
--
-- 1. Data encryption: lock the encrypted columns that are in use.
--    Every column below holds encrypted values and no plain ones (encryption_report(), 2026-11-04: 38 columns, 0 plain values).
--    No code path writes them in the clear: the edge functions write through the encrypting client (src/test/field-encryption.test.ts),
--    the website writes through encrypted-write, the only database function that touches one (record_approval_signoff, comment) is
--    called with a null comment, and the converter in outer-control-session-sweep found nothing to convert in any run.
--    encryption_enforce() adds "<table>_<column>_encrypted" CHECK that the plain column stays empty, so a write that would store the
--    text in the clear now fails instead of being converted minutes later. It refuses (and this migration fails, changing nothing)
--    if any of these columns holds a plain value when it runs.
--    The 14 listed columns that hold no values at all yet stay unlocked until they are in use; the weekly check below names any column
--    that holds encrypted values without a lock, and any lock that has gone missing.
--
-- 2. Older sites' pictures: sites generated before 2026-11-05 keep their pictures under website-images/<owner>/<site>/, so a public
--    image address shows the owner's account id. site-images-cleanup-sweep moves them to website-images/<site>/ (copy, rewrite every
--    stored address, then remove the old files only when nothing points at them any more). These two server-only helpers do the
--    database part.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agent_events', 'payload'),
    ('agent_runs', 'outcome'), ('agent_runs', 'summary'),
    ('api_key_context_entries', 'entry_text'),
    ('imported_projects', 'content'),
    ('outer_control_completion_checks', 'summary'),
    ('outer_control_evaluations', 'changes'), ('outer_control_evaluations', 'input_excerpt'), ('outer_control_evaluations', 'matches'),
    ('outer_control_evaluations', 'next_step'), ('outer_control_evaluations', 'output_text'), ('outer_control_evaluations', 'shadow_matches'),
    ('outer_control_evaluations', 'summary'),
    ('outer_control_memory', 'data'), ('outer_control_memory', 'summary'),
    ('outer_control_session_steps', 'decision'), ('outer_control_session_steps', 'note'), ('outer_control_session_steps', 'reply_text'),
    ('outer_control_session_steps', 'request'),
    ('outer_control_sessions', 'context'), ('outer_control_sessions', 'correction'), ('outer_control_sessions', 'final_artifact'),
    ('outer_control_sessions', 'final_output'), ('outer_control_sessions', 'handoff'), ('outer_control_sessions', 'history'),
    ('outer_control_sessions', 'objective'), ('outer_control_sessions', 'pending_answer'), ('outer_control_sessions', 'pending_question'),
    ('outer_control_workflows', 'context'), ('outer_control_workflows', 'criteria_state'), ('outer_control_workflows', 'done_criteria'),
    ('outer_control_workflows', 'final_artifact'), ('outer_control_workflows', 'final_output'), ('outer_control_workflows', 'goal_pool'),
    ('outer_control_workflows', 'objective'), ('outer_control_workflows', 'summary'),
    ('pending_approvals', 'comment'), ('pending_approvals', 'description')
  ) AS v(t, c) LOOP
    PERFORM public.encryption_enforce(r.t, r.c);
  END LOOP;
END $$;

-- The weekly check (Mondays 03:43 UTC) also names columns that hold encrypted values but are not locked, and locks that are recorded
-- but missing from the table. Anything on either list keeps the encryption_check incident open.
CREATE OR REPLACE FUNCTION public.encryption_weekly_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE plain jsonb; uncovered jsonb; unlocked jsonb; lock_missing jsonb; open_id uuid; result jsonb; problems int;
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
  result := jsonb_build_object('plain', plain, 'uncovered', uncovered, 'unlocked', unlocked, 'lock_missing', lock_missing, 'checked_at', now());
  problems := jsonb_array_length(plain) + jsonb_array_length(uncovered) + jsonb_array_length(unlocked) + jsonb_array_length(lock_missing);
  SELECT id INTO open_id FROM public.platform_incidents WHERE kind = 'encryption_check' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF problems > 0 THEN
    IF open_id IS NULL THEN
      INSERT INTO public.platform_incidents (kind, summary, detail) VALUES ('encryption_check',
        format('Data encryption check: %s column(s) with plain values left, %s content column(s) neither encrypted nor exempt, '
          || '%s encrypted column(s) in use without a lock, %s lock(s) missing. Plain values are converted by outer-control-session-sweep '
          || 'within minutes; an uncovered column needs an _enc twin or an entry in encryption_exempt_columns; an unlocked column is locked '
          || 'with encryption_enforce() once its writers are checked; a missing lock is put back with encryption_enforce() (docs/data-encryption.md).',
          jsonb_array_length(plain), jsonb_array_length(uncovered), jsonb_array_length(unlocked), jsonb_array_length(lock_missing)), result);
    ELSE
      UPDATE public.platform_incidents SET detail = result WHERE id = open_id;
    END IF;
  ELSIF open_id IS NOT NULL THEN
    UPDATE public.platform_incidents SET resolved_at = now(),
      resolution_note = 'All listed columns encrypted, every column in use locked, and every content column covered.' WHERE id = open_id;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.encryption_weekly_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encryption_weekly_check() TO service_role;

-- How many stored pages, prompts, shared copies and saved versions still contain an old-layout picture folder
-- ("website-images/<owner>/<site>/"). Null for anything that is not exactly such a folder, which the sweep treats as "unsure: keep".
CREATE OR REPLACE FUNCTION public.site_images_refs_count(_prefix text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN coalesce(_prefix, '') !~ '^website-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/$'
    THEN NULL ELSE
      (SELECT count(*) FROM public.website_pages WHERE strpos(sections::text, _prefix) > 0)
    + (SELECT count(*) FROM public.websites WHERE strpos(prompt, _prefix) > 0)
    + (SELECT count(*) FROM public.shared_websites WHERE strpos(html, _prefix) > 0)
    + (SELECT count(*) FROM public.website_versions
        WHERE strpos(pages_snapshot::text, _prefix) > 0 OR strpos(coalesce(website_snapshot::text, ''), _prefix) > 0)
  END
$$;
REVOKE ALL ON FUNCTION public.site_images_refs_count(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_images_refs_count(text) TO service_role;

-- Rewrites one site's old picture folder to its new one wherever it is stored, in one transaction. Only accepts exactly
-- website-images/<owner>/<site>/ -> website-images/<site>/ for the site given, so it can not be used to rewrite anything else.
-- Returns the number of rows changed.
CREATE OR REPLACE FUNCTION public.site_images_rewrite_refs(_site uuid, _from text, _to text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer := 0; k integer;
BEGIN
  IF _site IS NULL
     OR _from IS NULL OR _from !~ ('^website-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || _site::text || '/$')
     OR _to IS DISTINCT FROM ('website-images/' || _site::text || '/') THEN
    RAISE EXCEPTION 'site_images_rewrite_refs: unexpected folders';
  END IF;
  UPDATE public.website_pages SET sections = replace(sections::text, _from, _to)::jsonb WHERE strpos(sections::text, _from) > 0;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.websites SET prompt = replace(prompt, _from, _to) WHERE strpos(prompt, _from) > 0;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.shared_websites SET html = replace(html, _from, _to) WHERE strpos(html, _from) > 0;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.website_versions
     SET pages_snapshot = replace(pages_snapshot::text, _from, _to)::jsonb,
         website_snapshot = CASE WHEN website_snapshot IS NULL THEN NULL ELSE replace(website_snapshot::text, _from, _to)::jsonb END
   WHERE strpos(pages_snapshot::text, _from) > 0 OR strpos(coalesce(website_snapshot::text, ''), _from) > 0;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.site_images_rewrite_refs(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_images_rewrite_refs(uuid, text, text) TO service_role;

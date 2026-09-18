-- Version history + undo for website regenerations. An AI edit or full
-- rebuild currently overwrites websites/website_pages in place with no way
-- back — if the result is worse than what was there, the only option was
-- to describe the old version in a new prompt and hope. This stores a full
-- snapshot of the website + its pages before every edit/rebuild (written by
-- compile-website-manifest's snapshotWebsiteVersion helper) and a restore
-- path back onto it.
CREATE TABLE IF NOT EXISTS public.website_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text,
  website_snapshot jsonb NOT NULL,
  pages_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS website_versions_website_id_idx
  ON public.website_versions(website_id, created_at DESC);

ALTER TABLE public.website_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their website versions"
  ON public.website_versions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Restores a website + its pages to a prior snapshot. Snapshots the CURRENT
-- state first (as its own version) so a restore is itself undoable, then
-- replaces the website's editable columns and swaps website_pages wholesale
-- from pages_snapshot (delete-then-insert, since a restore can reintroduce
-- pages that were since removed or drop ones since added — a partial patch
-- can't express that).
CREATE OR REPLACE FUNCTION public.restore_website_version(_version_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  v public.website_versions;
  current_site public.websites;
  current_pages jsonb;
  snap jsonb;
  pg jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v FROM public.website_versions WHERE id = _version_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Version not found'; END IF;
  IF v.user_id <> uid THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT * INTO current_site FROM public.websites WHERE id = v.website_id AND user_id = uid;
  IF current_site.id IS NULL THEN RAISE EXCEPTION 'Website no longer exists'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(wp) - 'id' - 'website_id' - 'created_at' - 'updated_at'), '[]'::jsonb)
    INTO current_pages
    FROM public.website_pages wp WHERE wp.website_id = v.website_id;

  INSERT INTO public.website_versions (website_id, user_id, label, website_snapshot, pages_snapshot)
  VALUES (v.website_id, uid, 'Before restore', to_jsonb(current_site), current_pages);

  snap := v.website_snapshot;
  UPDATE public.websites SET
    name = COALESCE(snap->>'name', name),
    title = COALESCE(snap->>'title', title),
    tagline = snap->>'tagline',
    theme = COALESCE(snap->'theme', theme),
    prompt = COALESCE(snap->>'prompt', prompt)
  WHERE id = v.website_id AND user_id = uid;

  DELETE FROM public.website_pages WHERE website_id = v.website_id;

  FOR pg IN SELECT * FROM jsonb_array_elements(v.pages_snapshot)
  LOOP
    INSERT INTO public.website_pages (website_id, slug, title, seo_description, sections, order_index)
    VALUES (
      v.website_id,
      pg->>'slug',
      pg->>'title',
      pg->>'seo_description',
      COALESCE(pg->'sections', '[]'::jsonb),
      COALESCE((pg->>'order_index')::int, 0)
    );
  END LOOP;

  RETURN v.website_id;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_website_version(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.restore_website_version(uuid) TO authenticated;

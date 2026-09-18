-- The generated-website "Share" link (/website-preview/:id) is meant to be
-- viewable by anyone holding the link, not just the owner. Both websites and
-- website_pages currently only grant SELECT to the owner, so any visitor who
-- isn't signed in as the owner gets nothing back from Supabase and the site
-- appears broken ("Website not found") on its own public URL. The website's
-- id is an unguessable UUID, so a public SELECT keyed by id is the same
-- "anyone with the link" model this codebase already used for the legacy
-- shared_websites table — read-only; INSERT/UPDATE/DELETE stay owner-only.

CREATE POLICY "Anyone can view a website by its link"
  ON public.websites
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can view pages of a website by its link"
  ON public.website_pages
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- User & data isolation, leftovers: 20261105050000 site_image_folder_in_use() says when a site's image folder is still pointed at.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

-- the tables as they are after the earlier tests, plus the saved-versions table
CREATE TABLE IF NOT EXISTS public.website_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), website_id uuid, website_snapshot jsonb NOT NULL DEFAULT '{}', pages_snapshot jsonb NOT NULL DEFAULT '[]');
DELETE FROM public.website_pages; DELETE FROM public.shared_websites; DELETE FROM public.websites; DELETE FROM public.website_versions;
INSERT INTO public.websites (id, user_id, name) VALUES ('80000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'Live site');
INSERT INTO public.website_pages (website_id, slug, sections) VALUES
  ('80000000-0000-0000-0000-0000000000a1', 'home', '[{"asset_url":"https://x.test/storage/v1/object/public/mission-assets/website-images/11111111-1111-1111-1111-111111111111/a.png"}]');
INSERT INTO public.shared_websites (html, title, user_id) VALUES
  ('<img src="https://x.test/storage/v1/object/public/mission-assets/website-images/22222222-2222-2222-2222-222222222222/b.png">', 's', '00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.website_versions (website_id, pages_snapshot) VALUES
  (NULL, '[{"sections":[{"asset_url":".../website-images/33333333-3333-3333-3333-333333333333/c.png"}]}]');

\ir ../../migrations/20261105050000_site_images_cleanup.sql
\ir ../../migrations/20261105050000_site_images_cleanup.sql

SELECT pg_temp.check(public.site_image_folder_in_use('11111111-1111-1111-1111-111111111111'), 'a page that shows the picture keeps its folder');
SELECT pg_temp.check(public.site_image_folder_in_use('22222222-2222-2222-2222-222222222222'), 'a shared copy keeps it');
SELECT pg_temp.check(public.site_image_folder_in_use('33333333-3333-3333-3333-333333333333'), 'a saved version keeps it');
SELECT pg_temp.check(NOT public.site_image_folder_in_use('44444444-4444-4444-4444-444444444444'), 'nothing points at an unrelated folder');
SELECT pg_temp.check(public.site_image_folder_in_use(NULL) IS NOT TRUE, 'no site: not in use');
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.site_image_folder_in_use(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.site_image_folder_in_use(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.site_image_folder_in_use(uuid)', 'EXECUTE'), 'only the server can ask');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.isolation_report() WHERE object LIKE 'site_image_folder_in_use%'), 'the report does not flag it');
SELECT 'site_images_cleanup_test: all checks passed' AS result;

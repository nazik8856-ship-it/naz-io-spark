-- User & data isolation, leftovers: files that outlive their site or account (supabase/functions/site-images-cleanup-sweep).
--
-- site_image_folder_in_use(site): true when something that stays still points at a site's image folder: a page of any site (a site
-- can be copied), a saved version, or a shared copy (a share link outlives the site on purpose). The sweep never removes the files of
-- a folder that is in use. Server only.
CREATE OR REPLACE FUNCTION public.site_image_folder_in_use(_site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _site IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.website_pages WHERE sections::text LIKE '%' || _site::text || '%')
    OR EXISTS (SELECT 1 FROM public.shared_websites WHERE html LIKE '%' || _site::text || '%')
    OR EXISTS (SELECT 1 FROM public.website_versions WHERE pages_snapshot::text LIKE '%' || _site::text || '%' OR website_snapshot::text LIKE '%' || _site::text || '%')
  )
$$;
REVOKE ALL ON FUNCTION public.site_image_folder_in_use(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_image_folder_in_use(uuid) TO service_role;

-- ============================================================
-- POST-MIGRATION STEP (applied directly; needs the project URL and vault key), like the other sweeps:
--
--    SELECT cron.schedule(
--      'site-images-cleanup-daily',
--      '30 3 * * *',
--      $$
--      INSERT INTO public.scheduled_job_requests (job_name, request_id)
--      SELECT 'site-images-cleanup-daily', net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/site-images-cleanup-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
--    Stop it: SELECT cron.unschedule('site-images-cleanup-daily');
--    Or pause every consequential sweep: platform_settings.consequential_sweeps_paused = true.
-- ============================================================

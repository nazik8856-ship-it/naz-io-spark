-- Custom image generation for generated websites (2026-10-11): the page needs
-- to know whether images are still being generated so it can refresh itself,
-- and generate-site-images needs a started-at to avoid double-running.
ALTER TABLE public.websites
  ADD COLUMN IF NOT EXISTS images_status text,
  ADD COLUMN IF NOT EXISTS images_started_at timestamptz;

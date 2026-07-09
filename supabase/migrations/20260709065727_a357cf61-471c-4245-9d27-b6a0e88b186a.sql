
ALTER TABLE public.websites
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS tagline TEXT,
  ADD COLUMN IF NOT EXISTS theme JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS subdomain TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS websites_subdomain_key ON public.websites(subdomain) WHERE subdomain IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.website_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT,
  seo_description TEXT,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (website_id, slug)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_pages TO authenticated;
GRANT ALL ON public.website_pages TO service_role;

ALTER TABLE public.website_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their website pages"
  ON public.website_pages
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.websites w WHERE w.id = website_pages.website_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.websites w WHERE w.id = website_pages.website_id AND w.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS website_pages_website_id_idx ON public.website_pages(website_id);

DROP TRIGGER IF EXISTS update_website_pages_updated_at ON public.website_pages;
CREATE TRIGGER update_website_pages_updated_at
  BEFORE UPDATE ON public.website_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

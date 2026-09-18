-- Generated-website forms (contact, newsletter, booking/quote) previously
-- had no backend at all -- WebsitePreview.tsx's onSubmit just called
-- alert() and threw the data away. For a product whose pitch is "build a
-- business site," the site's #1 job (capturing a lead) did nothing.
--
-- Writes go through the new website-form-submit edge function only
-- (service-role insert) so an anonymous site visitor never needs direct
-- table access; only the website's owner can read their own submissions.
CREATE TABLE public.website_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  page_slug text,
  section_kind text NOT NULL,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitter_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_website_form_submissions_website ON public.website_form_submissions(website_id, created_at DESC);
CREATE INDEX idx_website_form_submissions_user ON public.website_form_submissions(user_id, created_at DESC);

ALTER TABLE public.website_form_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their own website submissions"
  ON public.website_form_submissions FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy for anon/authenticated -- every write goes
-- through website-form-submit's service-role client, which also applies
-- IP rate limiting a client-side policy couldn't express.

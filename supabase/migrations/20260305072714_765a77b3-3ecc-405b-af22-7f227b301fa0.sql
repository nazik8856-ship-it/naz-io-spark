CREATE TABLE public.shared_websites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  html text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_websites ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read shared websites (public sharing)
CREATE POLICY "Anyone can view shared websites"
  ON public.shared_websites
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow anyone to insert (no auth required for sharing)
CREATE POLICY "Anyone can create shared websites"
  ON public.shared_websites
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
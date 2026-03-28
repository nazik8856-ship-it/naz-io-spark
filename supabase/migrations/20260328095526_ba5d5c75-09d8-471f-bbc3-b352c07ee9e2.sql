ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert websites"
ON public.websites FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Anyone can read websites"
ON public.websites FOR SELECT
TO anon, authenticated
USING (true);
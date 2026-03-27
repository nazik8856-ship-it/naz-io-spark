CREATE TABLE public.websites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  title text NOT NULL DEFAULT 'Untitled',
  html text NOT NULL,
  prompt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.websites DISABLE ROW LEVEL SECURITY;
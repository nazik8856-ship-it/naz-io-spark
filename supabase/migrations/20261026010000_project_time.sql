-- How long a person spends on each of their projects (an agent or a website), so Inner Control can open on the one they use most.
-- Time is added only through add_project_time (called every few seconds while the project's page is open and in front); nobody can
-- write the table directly. A person reads only their own row.
CREATE TABLE IF NOT EXISTS public.project_time (
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('agent', 'website')),
  project_id uuid NOT NULL,
  seconds bigint NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, project_id)
);
ALTER TABLE public.project_time ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "People read their own project time" ON public.project_time;
CREATE POLICY "People read their own project time" ON public.project_time FOR SELECT USING (user_id = auth.uid());
REVOKE ALL ON TABLE public.project_time FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.project_time TO authenticated;
GRANT ALL ON TABLE public.project_time TO service_role;

-- One call adds at most a minute. The project must be the caller's own, or belong to an account the caller is an active member of.
CREATE OR REPLACE FUNCTION public.add_project_time(p_kind text, p_id uuid, p_seconds integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  owner uuid;
  secs integer := LEAST(GREATEST(COALESCE(p_seconds, 0), 0), 60);
BEGIN
  IF uid IS NULL OR secs < 1 OR p_id IS NULL THEN
    RETURN;
  END IF;
  IF p_kind = 'agent' THEN
    SELECT user_id INTO owner FROM public.agents WHERE id = p_id;
  ELSIF p_kind = 'website' THEN
    SELECT user_id INTO owner FROM public.websites WHERE id = p_id;
  ELSE
    RETURN;
  END IF;
  IF owner IS NULL THEN
    RETURN;
  END IF;
  IF owner <> uid AND NOT EXISTS (
    SELECT 1 FROM public.account_members WHERE member_id = uid AND account_owner_id = owner AND status = 'active'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.project_time (user_id, kind, project_id, seconds, last_seen_at)
  VALUES (uid, p_kind, p_id, secs, now())
  ON CONFLICT (user_id, kind, project_id)
  DO UPDATE SET seconds = public.project_time.seconds + secs, last_seen_at = now();
END;
$function$;
REVOKE ALL ON FUNCTION public.add_project_time(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_project_time(text, uuid, integer) TO authenticated;

-- Secrets handling, front 1: agent_integrations.credentials is the plain-JSON column from before integration credentials moved
-- into Vault (credentials_secret_id). No code reads or writes it and it is empty on the live database; it goes, so a secret can
-- never land in it again. The check and the drop are one statement: while any row still holds a value nothing is dropped.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_integrations' AND column_name = 'credentials') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_integrations WHERE credentials IS NOT NULL AND credentials::text NOT IN ('{}', 'null', '""')) THEN
    RAISE EXCEPTION 'agent_integrations.credentials still holds values; move them to Vault first';
  END IF;
  EXECUTE 'ALTER TABLE public.agent_integrations DROP COLUMN credentials';
END $$;

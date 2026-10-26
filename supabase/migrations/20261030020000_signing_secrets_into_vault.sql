-- Secrets handling, front 1: the signing secrets NazAI holds for its customers move into Supabase Vault.
--
--   webhooks.secret / previous_secret  ->  webhooks.secret_id / previous_secret_id
--   api_keys.callback_secret           ->  api_keys.callback_secret_id
--
-- The functions read Vault first and the old column second (_shared/signing-secrets.ts), so the order "migrate, then deploy" and
-- "deploy, then migrate" both keep signing working. The old columns stay (emptied) until every function that reads them has
-- been redeployed; a later migration drops them. The browser never reads the new id columns (the column grants list them not).

ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS secret_id uuid, ADD COLUMN IF NOT EXISTS previous_secret_id uuid;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS callback_secret_id uuid;

-- Move what is stored today (each value becomes one Vault secret, as JSON {"secret": "..."} like every other credential).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, secret, previous_secret FROM public.webhooks WHERE secret_id IS NULL AND coalesce(secret, '') <> '' LOOP
    UPDATE public.webhooks SET
      secret_id = vault.create_secret(json_build_object('secret', r.secret)::text, 'webhook-' || r.id || '-' || gen_random_uuid(), 'webhook signing secret'),
      previous_secret_id = CASE WHEN coalesce(r.previous_secret, '') <> ''
        THEN vault.create_secret(json_build_object('secret', r.previous_secret)::text, 'webhook-' || r.id || '-' || gen_random_uuid(), 'webhook previous signing secret') END,
      secret = '', previous_secret = NULL
    WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id, callback_secret FROM public.api_keys WHERE callback_secret_id IS NULL AND coalesce(callback_secret, '') <> '' LOOP
    UPDATE public.api_keys SET
      callback_secret_id = vault.create_secret(json_build_object('secret', r.callback_secret)::text, 'api-key-callback-' || r.id || '-' || gen_random_uuid(), 'API key callback secret'),
      callback_secret = NULL
    WHERE id = r.id;
  END LOOP;
END $$;

-- A Vault secret is deleted the moment its row stops pointing at it: the row is deleted, a rotation replaces it, or the sweep
-- clears an expired previous secret. No path (the website deleting a webhook, the retention sweep deleting an old key) can leave
-- a secret behind in Vault.
CREATE OR REPLACE FUNCTION public.forget_replaced_vault_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  old_ids uuid[];
  kept uuid[];
  sid uuid;
BEGIN
  IF TG_TABLE_NAME = 'webhooks' THEN
    old_ids := ARRAY[OLD.secret_id, OLD.previous_secret_id];
    kept := CASE WHEN TG_OP = 'DELETE' THEN ARRAY[]::uuid[] ELSE ARRAY[NEW.secret_id, NEW.previous_secret_id] END;
  ELSE
    old_ids := ARRAY[OLD.callback_secret_id];
    kept := CASE WHEN TG_OP = 'DELETE' THEN ARRAY[]::uuid[] ELSE ARRAY[NEW.callback_secret_id] END;
  END IF;
  kept := array_remove(kept, NULL);
  FOREACH sid IN ARRAY array_remove(old_ids, NULL) LOOP
    IF NOT (sid = ANY (kept)) THEN
      DELETE FROM vault.secrets WHERE id = sid;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.forget_replaced_vault_secrets() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS webhooks_forget_vault_secrets ON public.webhooks;
CREATE TRIGGER webhooks_forget_vault_secrets AFTER UPDATE OF secret_id, previous_secret_id OR DELETE ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.forget_replaced_vault_secrets();
DROP TRIGGER IF EXISTS api_keys_forget_vault_secrets ON public.api_keys;
CREATE TRIGGER api_keys_forget_vault_secrets AFTER UPDATE OF callback_secret_id OR DELETE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.forget_replaced_vault_secrets();

-- Rotation, now on Vault: the old secret becomes the previous one for the grace window, the new one is stored in Vault and
-- returned once (to the owner who asked); the rotated-out value never leaves the database (previous_secret comes back NULL).
-- Same name, arguments and result columns as before, so callers do not change.
CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(_webhook_id uuid, _new_secret text, _grace_hours integer DEFAULT 24)
RETURNS TABLE(id uuid, secret text, previous_secret text, previous_secret_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  w public.webhooks%ROWTYPE;
  cur uuid;
  expires timestamptz;
BEGIN
  IF _new_secret IS NULL OR length(_new_secret) < 16 THEN
    RAISE EXCEPTION 'new secret must be at least 16 characters';
  END IF;
  IF _grace_hours IS NULL OR _grace_hours < 0 OR _grace_hours > 168 THEN
    RAISE EXCEPTION 'grace_hours must be between 0 and 168';
  END IF;
  SELECT * INTO w FROM public.webhooks WHERE webhooks.id = _webhook_id AND webhooks.user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  cur := w.secret_id;
  IF cur IS NULL AND coalesce(w.secret, '') <> '' THEN
    cur := vault.create_secret(json_build_object('secret', w.secret)::text, 'webhook-' || w.id || '-' || gen_random_uuid(), 'webhook signing secret');
  END IF;
  expires := CASE WHEN cur IS NULL THEN NULL ELSE now() + make_interval(hours => _grace_hours) END;
  UPDATE public.webhooks SET
    previous_secret_id = cur,
    previous_secret_expires_at = expires,
    secret_id = vault.create_secret(json_build_object('secret', _new_secret)::text, 'webhook-' || w.id || '-' || gen_random_uuid(), 'webhook signing secret'),
    secret = '',
    previous_secret = NULL,
    updated_at = now()
  WHERE webhooks.id = w.id;
  RETURN QUERY SELECT w.id, _new_secret, NULL::text, expires;
END;
$$;
REVOKE ALL ON FUNCTION public.rotate_webhook_secret(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid, text, integer) TO authenticated;

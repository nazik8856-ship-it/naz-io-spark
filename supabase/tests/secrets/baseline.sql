-- Supabase-like baseline for testing the secrets migrations locally: roles, auth.uid()/auth.role(), a vault stand-in, and the
-- tables with the live database's columns, grants and row level security (as read from the live database on 2026-10-26).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth; CREATE SCHEMA vault;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text, secret text NOT NULL);
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '') RETURNS uuid
  LANGUAGE sql AS $$ INSERT INTO vault.secrets (secret, name, description) VALUES (new_secret, new_name, new_description) RETURNING id $$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL) RETURNS void
  LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = coalesce(new_secret, secret) WHERE id = secret_id $$;
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret, secret AS decrypted_secret FROM vault.secrets;

-- The existing service-role-only Vault wrappers.
CREATE FUNCTION public.create_integration_secret(payload jsonb, label text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE new_id uuid; BEGIN IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT vault.create_secret(payload::text, coalesce(label, 'integration-' || gen_random_uuid()::text), 'agent_integrations credentials') INTO new_id; RETURN new_id; END; $$;
CREATE FUNCTION public.read_integration_secret(sid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE raw text; BEGIN IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT decrypted_secret INTO raw FROM vault.decrypted_secrets WHERE id = sid; IF raw IS NULL THEN RETURN NULL; END IF; RETURN raw::jsonb; END; $$;
REVOKE ALL ON FUNCTION public.create_integration_secret(jsonb, text), public.read_integration_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_integration_secret(jsonb, text), public.read_integration_secret(uuid) TO service_role;

CREATE TABLE public.account_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_owner_id uuid NOT NULL, member_id uuid, email text NOT NULL,
  role text NOT NULL DEFAULT 'viewer', status text NOT NULL DEFAULT 'pending', invite_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by uuid, invited_at timestamptz DEFAULT now(), accepted_at timestamptz, created_at timestamptz DEFAULT now(), ooo_until timestamptz,
  ooo_fallback_member_id uuid, permissions text[], invite_expires_at timestamptz);
CREATE FUNCTION public.is_account_member(_account_owner_id uuid, _min_role text DEFAULT NULL, _permission text DEFAULT NULL) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.account_members WHERE account_owner_id = _account_owner_id AND member_id = auth.uid() AND status = 'active') $$;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, text, text) TO anon, authenticated;
ALTER TABLE public.account_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their own team" ON public.account_members FOR ALL TO authenticated USING (auth.uid() = account_owner_id);
CREATE POLICY "Members can view their own memberships" ON public.account_members FOR SELECT TO authenticated USING (auth.uid() = member_id);
GRANT ALL ON public.account_members TO anon, authenticated, service_role;

CREATE TABLE public.agent_integrations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, agent_id uuid, provider text NOT NULL,
  credentials jsonb DEFAULT '{}'::jsonb, metadata jsonb DEFAULT '{}'::jsonb, status text DEFAULT 'connected', last_verified_at timestamptz, last_error text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), credentials_secret_id uuid, revoked_alerted_at timestamptz);
ALTER TABLE public.agent_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own integrations" ON public.agent_integrations FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Team members can view owner's integrations" ON public.agent_integrations FOR SELECT TO authenticated USING (is_account_member(user_id));
GRANT ALL ON public.agent_integrations TO anon, authenticated, service_role;

CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL, key_prefix text, key_hash text NOT NULL,
  scopes text[], last_used_at timestamptz, revoked_at timestamptz, expires_at timestamptz, created_at timestamptz DEFAULT now(), on_uncertain text DEFAULT 'approve',
  callback_url text, callback_secret text, callback_timeout_seconds integer, callback_fallback text);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view their own api keys" ON public.api_keys FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Team members can view owner's api keys" ON public.api_keys FOR SELECT TO authenticated USING (is_account_member(user_id));
GRANT ALL ON public.api_keys TO anon, service_role;
GRANT SELECT (id, user_id, name, key_prefix, scopes, last_used_at, revoked_at, expires_at, created_at, on_uncertain, callback_url, callback_timeout_seconds, callback_fallback)
  ON public.api_keys TO authenticated;

CREATE TABLE public.email_unsubscribe_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token text NOT NULL UNIQUE, email text NOT NULL,
  created_at timestamptz DEFAULT now(), used_at timestamptz);
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE USING (auth.role() = 'service_role');
GRANT ALL ON public.email_unsubscribe_tokens TO anon, authenticated, service_role;

CREATE TABLE public.webhooks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, url text NOT NULL, secret text NOT NULL, events text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), alerted_at timestamptz,
  previous_secret text, previous_secret_expires_at timestamptz);
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own webhooks" ON public.webhooks FOR ALL TO authenticated USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON public.webhooks TO authenticated;
GRANT SELECT (id, user_id, url, events, enabled, created_at, updated_at, alerted_at, previous_secret_expires_at) ON public.webhooks TO anon, authenticated;
GRANT ALL ON public.webhooks TO service_role;
-- The current rotation function (20260825030000).
CREATE FUNCTION public.rotate_webhook_secret(_webhook_id uuid, _new_secret text, _grace_hours integer DEFAULT 24)
RETURNS TABLE(id uuid, secret text, previous_secret text, previous_secret_expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY UPDATE public.webhooks w SET previous_secret = w.secret, previous_secret_expires_at = now() + (_grace_hours || ' hours')::interval,
    secret = _new_secret, updated_at = now() WHERE w.id = _webhook_id AND w.user_id = auth.uid()
  RETURNING w.id, w.secret, w.previous_secret, w.previous_secret_expires_at;
END; $$;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid, text, integer) TO authenticated;

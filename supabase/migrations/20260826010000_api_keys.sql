-- "Outer NazAI" plan, item 1: api_keys table.
--
-- Foundation for a public Control API letting an EXTERNAL platform submit
-- one of its own proposed actions to NazAI's decision-gating engine and
-- get back a verdict (allow/block/escalate/modify) -- verdict-only, per
-- the user's explicit scope choice: an external caller can never create,
-- edit, or delete this account's own hard rules/safety rules/spend caps
-- from outside. All policy management stays inside the NazAI app.
--
-- Unlike webhooks.secret (which the owner is meant to see again to
-- configure their receiver), the raw API key must NEVER be persisted or
-- re-displayable after creation -- only its hash is stored. Hashed with
-- extensions.digest(..., 'sha256'), the same primitive already used for
-- HMAC signing elsewhere in this project (decision-signing,
-- webhooks.ts's own signature computation) -- a fast indexed hash is
-- correct here since the key is a 32-byte CSPRNG value with no
-- brute-forceable keyspace, unlike a human password (no bcrypt/crypt()
-- needed).
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{control:verdict}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partial index: only active (unrevoked) keys are ever looked up by hash
-- on the hot verdict-request path (see resolve_api_key in the next
-- migration) -- a revoked key falls out of this index entirely rather
-- than requiring a runtime filter to matter.
CREATE INDEX idx_api_keys_active_hash ON public.api_keys (key_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_user ON public.api_keys (user_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- SELECT only -- no INSERT/UPDATE/DELETE grant to authenticated. Every
-- write (create, revoke, last_used_at bump) goes through a service-role
-- edge function or SECURITY DEFINER RPC instead, since key creation needs
-- to mint the raw secret in application code and hash it before the row
-- ever exists, and revocation/last-used tracking must not be spoofable by
-- a client holding only their own JWT.
CREATE POLICY "Users view their own api keys"
ON public.api_keys FOR SELECT TO authenticated
USING (auth.uid() = user_id);

GRANT SELECT ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;

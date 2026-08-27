-- "Policy autonomy" plan, item 13: opt-in, coarse anonymized precedent
-- sharing across accounts. Per the user's own explicit scope decision,
-- the shared aggregate carries ONLY action_type + provider + aggregate
-- verdict shares -- never free text, params, or the embedding vector.
--
-- The opt-in flag lives on profiles alongside every other account-wide
-- toggle (kill_switch, require_dual_control_for_policy) and is written
-- the exact same way: directly via the existing owner-scoped UPDATE RLS
-- policy ("Users can update own profile info") -- no new endpoint for
-- the toggle itself, consistent with this round's own "no UX" scope.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS share_anonymized_precedent_stats boolean NOT NULL DEFAULT false;

-- One row per (action_type, provider) shape, recomputed FRESH on every
-- sweep run from a lookback window across every currently opted-in
-- account -- never incrementally added to, so an account that opts out
-- stops contributing to the next computed total rather than leaving a
-- stale trace behind. `provider` is NOT NULL (empty string standing in
-- for "no specific provider") specifically so the unique constraint
-- below can actually dedupe on repeated upserts -- a plain nullable
-- column would let Postgres treat every NULL as distinct, silently
-- accumulating duplicate rows for the same shape across sweep runs.
CREATE TABLE IF NOT EXISTS public.cross_account_precedent_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  provider text NOT NULL DEFAULT '',
  total_count integer NOT NULL DEFAULT 0,
  non_allow_count integer NOT NULL DEFAULT 0,
  -- The anonymity safeguard this whole feature depends on: how many
  -- DISTINCT accounts contributed to this shape's totals. Enforced at
  -- read time (MIN_CONTRIBUTING_ACCOUNTS, cross-account-precedent.ts) --
  -- a lone contributor's own real numbers must never be exposed as if
  -- they were a genuine cross-account pattern.
  contributing_account_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cross_account_precedent_stats_unique_shape UNIQUE (action_type, provider)
);

-- Deliberately readable by ANY authenticated user, not just contributors
-- -- these rows carry no per-account information at all (that's the
-- entire point of the aggregation), so there's no privacy reason to
-- gate reads behind the caller's own opt-in status.
GRANT SELECT ON public.cross_account_precedent_stats TO authenticated;
GRANT ALL ON public.cross_account_precedent_stats TO service_role;

ALTER TABLE public.cross_account_precedent_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Any authenticated user can read coarse cross-account precedent stats"
  ON public.cross_account_precedent_stats FOR SELECT TO authenticated
  USING (true);

-- ============================================================
-- POST-MIGRATION STEP (same convention as every other scheduled sweep in
-- this codebase -- applied directly, not committed as static SQL, since
-- it needs a project-specific service_role key and function URL):
--
-- CRON JOB (pg_cron): schedule 'cross-account-precedent-sweep-daily' once
-- a day, reusing the existing 'email_queue_service_role_key' vault
-- secret as the Authorization bearer token:
--
--    SELECT cron.schedule(
--      'cross-account-precedent-sweep-daily',
--      '0 7 * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/cross-account-precedent-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );

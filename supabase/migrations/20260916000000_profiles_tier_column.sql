-- Server-side source of truth for a user's subscription tier. Previously
-- the tier lived only in the browser's localStorage (src/lib/credit-tiers.ts),
-- fully client-controlled and trusted as-is by every feature gate
-- (src/lib/feature-gates.ts) -- any user could set
-- localStorage['nazai:user-tier'] = 'enterprise' and unlock every premium
-- capability with no payment and no server ever checking. This column is
-- written only by purchase-credits (service role, after validating the
-- requested plan against the real catalog) and read back by the client to
-- resync its local cache.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'explorer';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_tier_check
  CHECK (tier IN ('explorer', 'operator', 'titan', 'enterprise'));

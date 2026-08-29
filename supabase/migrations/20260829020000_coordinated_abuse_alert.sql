-- "Policy autonomy" plan, item 2: coordinated-abuse-sweep tracks which
-- ACCOUNTS it has already alerted on, clearing the flag once the
-- account's combined traffic across its keys no longer looks abusive.
-- Lives on profiles (account-level), not api_keys, since the whole
-- point is a signal no single key's own row can carry -- mirrors
-- profiles.auto_resolution_share_alerted_at.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coordinated_abuse_alerted_at timestamptz;

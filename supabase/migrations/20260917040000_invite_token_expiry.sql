-- account_members.invite_token (an unguessable gen_random_uuid()) never
-- expired -- a generated invite link stayed redeemable forever until
-- manually revoked or accepted, so a link leaked, forwarded, or cached
-- (an email security scanner, a shared inbox, browser history) months or
-- years later could still be used to join the account.
ALTER TABLE public.account_members
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz;

-- Existing pending invites get a fresh 7-day window from now rather than
-- being retroactively expired outright -- a real invite someone hasn't
-- gotten to yet shouldn't silently die the moment this migration runs.
UPDATE public.account_members
SET invite_expires_at = now() + interval '7 days'
WHERE status = 'pending' AND invite_expires_at IS NULL;

-- Per-user notification preferences: every scheduled email (daily digest,
-- weekly trend, monthly compliance/ROI) has only ever gone to the account
-- owner's own auth email, with no opt-out and no way for a team member to
-- receive anything at all -- basic SaaS account maturity once there's an
-- actual team (RBAC) to have preferences.
--
-- Each row is one recipient's own preference for one account. The owner
-- themselves is just another recipient row (account_owner_id = recipient_id
-- for their own preference) -- no special-casing needed in the schema.
CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  digest_enabled boolean NOT NULL DEFAULT true,
  weekly_trend_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_owner_id, recipient_id)
);

CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Notification preferences are personal: a recipient manages only their
-- own row, for any account they're the owner of or an active member of.
-- The account owner does NOT get to edit a teammate's preferences (that
-- would defeat "per-user"), only view that a row exists via the same
-- read policy every recipient already has for their own account.
CREATE POLICY "A recipient can view/manage their own notification preference"
ON public.notification_preferences FOR ALL TO authenticated
USING (
  auth.uid() = recipient_id
  AND (auth.uid() = account_owner_id OR public.is_account_member(account_owner_id))
)
WITH CHECK (
  auth.uid() = recipient_id
  AND (auth.uid() = account_owner_id OR public.is_account_member(account_owner_id))
);

-- RBAC Phase 1 (infrastructure only — does NOT yet gate any real
-- enforcement path; that's a deliberate, separate Phase 2). A genuine
-- customer-facing "invite your team to your account" feature, additive
-- and account-scoped — NOT a reuse of the existing global user_roles/
-- app_role system (owner/admin/user), which has no account scoping at
-- all and looks like it's meant for platform staff, not customer teams.
-- Repurposing it would either break that staff-access use case or grant
-- a customer's teammate cross-account power by accident.
CREATE TABLE public.account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'approver', 'viewer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  invite_token uuid NOT NULL DEFAULT gen_random_uuid(),
  invited_by uuid NOT NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_owner_id, email),
  UNIQUE (invite_token)
);

-- A member can only be attached to one active membership per account.
CREATE UNIQUE INDEX idx_account_members_owner_member
  ON public.account_members (account_owner_id, member_id) WHERE member_id IS NOT NULL;

CREATE INDEX idx_account_members_member
  ON public.account_members (member_id) WHERE member_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_members TO authenticated;
GRANT ALL ON public.account_members TO service_role;

ALTER TABLE public.account_members ENABLE ROW LEVEL SECURITY;

-- The account owner manages their own team.
CREATE POLICY "Owners manage their own team"
ON public.account_members FOR ALL TO authenticated
USING (auth.uid() = account_owner_id) WITH CHECK (auth.uid() = account_owner_id);

-- A member can see the memberships that name them (which accounts they're on).
CREATE POLICY "Members can view their own memberships"
ON public.account_members FOR SELECT TO authenticated
USING (auth.uid() = member_id);

-- invited_by is never client-controlled, regardless of what a direct
-- insert claims — always the actual caller.
CREATE OR REPLACE FUNCTION public.set_account_member_invited_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.invited_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_account_members_invited_by
BEFORE INSERT ON public.account_members
FOR EACH ROW EXECUTE FUNCTION public.set_account_member_invited_by();

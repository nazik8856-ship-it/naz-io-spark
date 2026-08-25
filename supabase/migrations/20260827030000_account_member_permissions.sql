-- "15 more items" plan, item 5: split the all-or-nothing "owner" role into
-- specific permissions. Today, giving a teammate the "owner" role hands
-- them every owner-level write surface at once (hard rules, safety rules,
-- spend cap, strictness, policy versions, API keys, webhooks) with no way
-- to grant just one category. Adds a nullable column an account owner can
-- use to narrow a specific owner-role member's access, and extends
-- is_account_member() with an optional permission check.
--
-- Nullable, no default: NULL means unrestricted -- every existing and
-- newly-invited owner-role member keeps exactly today's full access
-- unless an account owner explicitly narrows them. The values stored here
-- (e.g. 'policy', 'spend', 'integrations') are validated in application
-- code, not a DB CHECK constraint -- same posture as api_keys.scopes,
-- which also went unconstrained at the DB level.
ALTER TABLE public.account_members ADD COLUMN permissions text[];

-- CREATE OR REPLACE (not DROP+CREATE) since only a new trailing DEFAULT
-- NULL parameter is being added -- every existing 2-argument call site in
-- this codebase's RLS policies is completely unaffected: _permission
-- defaults to NULL there, and the new AND clause below is a no-op when
-- NULL, exactly preserving today's behavior for anything not updated to
-- pass a permission explicitly.
CREATE OR REPLACE FUNCTION public.is_account_member(_account_owner_id uuid, _min_role text DEFAULT NULL, _permission text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE account_owner_id = _account_owner_id
      AND member_id = auth.uid()
      AND status = 'active'
      AND (
        _min_role IS NULL
        OR (_min_role = 'viewer')
        OR (_min_role = 'approver' AND role IN ('approver', 'owner'))
        OR (_min_role = 'owner' AND role = 'owner')
      )
      AND (
        _permission IS NULL
        OR permissions IS NULL
        OR _permission = ANY(permissions)
      )
  );
$$;

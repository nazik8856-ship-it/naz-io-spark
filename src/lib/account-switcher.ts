// Pure helpers for the account switcher: which accounts a user can view/act
// on (their own, plus any active team membership), which one is currently
// selected, and what role they hold on it.

export type AccountRole = "self" | "viewer" | "approver" | "owner";

export type AccountOption = {
  accountId: string;
  role: AccountRole;
  label: string;
  // null/undefined = unrestricted (every owner-role member defaults to
  // full access, backward compatible with every account created before
  // this column existed); a populated array narrows an owner-role member
  // to just those categories. Irrelevant for "self"/"approver"/"viewer".
  permissions: string[] | null;
};

export type Membership = { account_owner_id: string; role: "owner" | "approver" | "viewer"; permissions?: string[] | null };

export function buildAccountOptions(
  selfId: string,
  memberships: Membership[],
  ownerNames: Record<string, string>,
): AccountOption[] {
  return [
    { accountId: selfId, role: "self", label: "My account", permissions: null },
    ...memberships.map((m) => ({
      accountId: m.account_owner_id,
      role: m.role as AccountRole,
      label: ownerNames[m.account_owner_id] ?? `${m.account_owner_id.slice(0, 8)}…`,
      permissions: m.permissions ?? null,
    })),
  ];
}

/** Falls back to the user's own account if the stored selection is missing or no longer valid (e.g. a revoked membership). */
export function resolveActiveAccountId(storedId: string | null, options: AccountOption[], selfId: string): string {
  if (storedId && options.some((o) => o.accountId === storedId)) return storedId;
  return selfId;
}

export function roleForAccount(options: AccountOption[], accountId: string): AccountRole {
  return options.find((o) => o.accountId === accountId)?.role ?? "self";
}

export function permissionsForAccount(options: AccountOption[], accountId: string): string[] | null {
  return options.find((o) => o.accountId === accountId)?.permissions ?? null;
}

/** Whether the current role can perform owner-only writes (hard rules, safety rules, spend cap, strictness, kill switch). */
export function canWriteAsOwner(role: AccountRole): boolean {
  return role === "self" || role === "owner";
}

/** Whether the current role can co-sign approvals (approver or owner, or the account's own self). */
export function canApprove(role: AccountRole): boolean {
  return role === "self" || role === "owner" || role === "approver";
}

/**
 * The narrower, category-specific version of canWriteAsOwner -- lets an
 * account owner grant a teammate SOME of the owner-role write surface
 * (e.g. just spend/strictness) without all of it, instead of the single
 * bundled owner switch. `permissions === null` (the default for every
 * existing and newly-invited owner-role member unless explicitly
 * narrowed) means unrestricted -- exactly canWriteAsOwner's behavior.
 */
export type AccountPermission = "policy" | "spend" | "integrations";
export const ACCOUNT_PERMISSIONS: readonly AccountPermission[] = ["policy", "spend", "integrations"];
export const PERMISSION_LABEL: Record<AccountPermission, string> = {
  policy: "Policy (hard rules, safety rules, policy versions)",
  spend: "Spend & strictness",
  integrations: "Integrations (API keys, webhooks)",
};

export function hasPermission(role: AccountRole, permissions: string[] | null | undefined, permission: AccountPermission): boolean {
  if (role === "self") return true;
  if (role !== "owner") return false;
  return permissions == null || permissions.includes(permission);
}

// Pure helpers for the account switcher: which accounts a user can view/act
// on (their own, plus any active team membership), which one is currently
// selected, and what role they hold on it.

export type AccountRole = "self" | "viewer" | "approver" | "owner";

export type AccountOption = {
  accountId: string;
  role: AccountRole;
  label: string;
};

export type Membership = { account_owner_id: string; role: "owner" | "approver" | "viewer" };

export function buildAccountOptions(
  selfId: string,
  memberships: Membership[],
  ownerNames: Record<string, string>,
): AccountOption[] {
  return [
    { accountId: selfId, role: "self", label: "My account" },
    ...memberships.map((m) => ({
      accountId: m.account_owner_id,
      role: m.role as AccountRole,
      label: ownerNames[m.account_owner_id] ?? `${m.account_owner_id.slice(0, 8)}…`,
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

/** Whether the current role can perform owner-only writes (hard rules, safety rules, spend cap, strictness, kill switch). */
export function canWriteAsOwner(role: AccountRole): boolean {
  return role === "self" || role === "owner";
}

/** Whether the current role can co-sign approvals (approver or owner, or the account's own self). */
export function canApprove(role: AccountRole): boolean {
  return role === "self" || role === "owner" || role === "approver";
}

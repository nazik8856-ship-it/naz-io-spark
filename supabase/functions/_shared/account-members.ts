// Pure validation for the account-members (RBAC Phase 1) invite flow.

export const ACCOUNT_ROLES = ["owner", "approver", "viewer"] as const;
export type AccountRole = typeof ACCOUNT_ROLES[number];

export function isValidAccountRole(role: unknown): role is AccountRole {
  return typeof role === "string" && (ACCOUNT_ROLES as readonly string[]).includes(role);
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

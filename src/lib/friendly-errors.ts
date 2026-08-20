// Maps raw Postgres/PostgREST error text to something a user can actually
// act on. Most callers currently show error.message directly in a toast --
// for an RLS violation that's Postgres's own internal wording ("new row
// violates row-level security policy for table \"hard_rules\""), which is
// technically correct but meaningless to anyone who isn't the developer.
// This became reachable in practice once RBAC Phase 2/3 let non-owner
// team members attempt writes their role doesn't actually permit.

export function friendlyErrorMessage(rawMessage: string): string {
  const msg = rawMessage || "";
  if (/row-level security/i.test(msg)) {
    return "You don't have permission to do that on this account.";
  }
  if (/permission denied/i.test(msg)) {
    return "You don't have permission to do that on this account.";
  }
  return rawMessage;
}

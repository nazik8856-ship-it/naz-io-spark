// "15 more items" plan, item 2: shared helper for edge functions that let
// a caller optionally act on a DIFFERENT account than their own -- e.g. an
// invited team owner managing a shared account's API keys. Verifies real
// owner-role team membership via the same is_account_member() RPC the
// database's own RLS policies use, rather than trusting a client-supplied
// account_id outright. Only useful for edge functions using the
// service-role admin client for the actual read/write, where RLS itself
// never runs -- a function that queries with the caller's own JWT-scoped
// client doesn't need this, RLS already does the equivalent check there.
//
// deno-lint-ignore no-explicit-any
export type AccountScopeClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

/**
 * Resolves which account a request should act on: the caller's own id by
 * default (or when no account_id is named), or a different account only
 * if the caller genuinely holds 'owner' role team membership on it.
 * Returns null when a requested account was named but isn't authorized --
 * the caller should treat that as 403, not silently fall back to their own.
 */
export async function resolveAccountScope(
  userClient: AccountScopeClient,
  callerId: string,
  requestedAccountId: unknown,
): Promise<string | null> {
  if (typeof requestedAccountId !== "string" || !requestedAccountId || requestedAccountId === callerId) {
    return callerId;
  }
  const { data, error } = await userClient.rpc("is_account_member", {
    _account_owner_id: requestedAccountId,
    _min_role: "owner",
  });
  if (error || !data) return null;
  return requestedAccountId;
}

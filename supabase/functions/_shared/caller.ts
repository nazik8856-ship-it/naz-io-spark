// User & data isolation, front 3: the two steps every server function that acts for a signed-in person should take.
//
//   requireCaller   who is calling: the user id comes ONLY from the verified sign-in token, never from the request body or address.
//                   The caller's own database client (their Authorization on it, so row level security applies a second time) comes
//                   with it. An account named in the request is only ever a request: resolveCallerAccount() checks the caller's
//                   team membership (the same is_account_member check the database rules use) before it is used.
//   assertOwned     before a function acts on an id it was sent (an agent, project, tool, session, approval, webhook, key…) with the
//                   full-access key: the row must belong to the account. A row that belongs to someone else answers exactly like one
//                   that does not exist, so ids of other accounts can not be probed ("not found", never "forbidden").
import { resolveAccountScope, type AccountScopeClient } from "./account-scope.ts";

export type CallerClient = AccountScopeClient & {
  auth: { getUser: () => Promise<{ data: { user: { id: string; email?: string | null } | null }; error: unknown }> };
};

export type Caller<C extends CallerClient = CallerClient> = { userId: string; email: string | null; authHeader: string; userClient: C };
export type CallerResult<C extends CallerClient = CallerClient> = { ok: true; caller: Caller<C> } | { ok: false; status: 401; error: "unauthorized" };

/** makeClient builds a client that sends the caller's Authorization header (anon key + their token), as the functions already do. */
export async function requireCaller<C extends CallerClient>(req: Request, makeClient: (authHeader: string) => C): Promise<CallerResult<C>> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) return { ok: false, status: 401, error: "unauthorized" };
  try {
    const userClient = makeClient(authHeader);
    const { data, error } = await userClient.auth.getUser();
    if (error || !data?.user?.id) return { ok: false, status: 401, error: "unauthorized" };
    return { ok: true, caller: { userId: data.user.id, email: data.user.email ?? null, authHeader, userClient } };
  } catch {
    return { ok: false, status: 401, error: "unauthorized" };
  }
}

/**
 * The account a request acts on: the caller's own, or a team account they hold owner-role membership of (narrowed to a permission
 * category when one is named). Null when an account was named that they may not act on: answer 403/404, never fall back to theirs.
 */
export function resolveCallerAccount(caller: Caller, requestedAccountId: unknown, permission?: string): Promise<string | null> {
  return resolveAccountScope(caller.userClient, caller.userId, requestedAccountId, permission);
}

/**
 * For reading only: the caller's own account, or a team account they are an active member of at any role (viewer or above), which is
 * what the database rules allow them to read anyway. Null when they are not a member.
 */
export async function resolveCallerReadAccount(caller: Caller, requestedAccountId: unknown): Promise<string | null> {
  if (typeof requestedAccountId !== "string" || !requestedAccountId || requestedAccountId === caller.userId) return caller.userId;
  const { data, error } = await caller.userClient.rpc("is_account_member", { _account_owner_id: requestedAccountId, _min_role: "viewer", _permission: null });
  return error || !data ? null : requestedAccountId;
}

// deno-lint-ignore no-explicit-any
type AdminLike = { from: (table: string) => any };

/**
 * The row with this id, only if it belongs to the account (ownerColumn = accountId, in the query itself, so another account's row is
 * never even read). Null for a row that is missing and for one that belongs to someone else, which the caller answers the same way.
 */
export async function assertOwned<T = Record<string, unknown>>(
  admin: AdminLike, table: string, id: unknown, accountId: string,
  opts: { select?: string; ownerColumn?: string } = {},
): Promise<T | null> {
  if (typeof id !== "string" || !id || !accountId) return null;
  const { data, error } = await admin.from(table).select(opts.select ?? "*").eq("id", id).eq(opts.ownerColumn ?? "user_id", accountId).maybeSingle();
  if (error || !data) return null;
  return data as T;
}

/** The one answer for "no such thing, or not yours". */
export const notFoundResponse = (corsHeaders: Record<string, string>, what = "Not found") =>
  new Response(JSON.stringify({ error: "not_found", message: what }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

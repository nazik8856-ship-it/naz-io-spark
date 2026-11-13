// Complete account erasure (docs/account-erasure.md), the part that is not SQL: cancel every connected service's token at its provider,
// then run erase_account() (all rows, stored secrets and the login, in one transaction that undoes itself when anything is left).
import { disconnectIntegration, type DisconnectResult } from "./integration-disconnect.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export type ErasureResult = { ok: true; counts: Record<string, number>; revoked: number } | { ok: false; error: string; revoked: number };

export type ErasureDeps = {
  disconnect?: (admin: AnyClient, target: { userId: string; provider: string; agentId: string | null }) => Promise<DisconnectResult>;
};

/** One provider token per distinct (provider, agent): the same set the Disconnect button works through. */
export async function eraseAccount(admin: AnyClient, userId: string, deps: ErasureDeps = {}): Promise<ErasureResult> {
  const disconnect = deps.disconnect ?? ((a, target) => disconnectIntegration(a, a, target, { fetchImpl: fetch, env: (n: string) => Deno.env.get(n) }));
  let revoked = 0;
  try {
    const { data: rows } = await admin.from("agent_integrations").select("provider, agent_id").eq("user_id", userId);
    const seen = new Set<string>();
    for (const r of (rows ?? []) as { provider: string; agent_id: string | null }[]) {
      const key = `${r.provider}|${r.agent_id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A provider that refuses or is down never stops the erasure (disconnectIntegration records the outcome and goes on).
      const res = await disconnect(admin, { userId, provider: r.provider, agentId: r.agent_id ?? null });
      if (res.ok) revoked += 1;
    }
    const { data, error } = await admin.rpc("erase_account", { _user_id: userId });
    if (error) return { ok: false, error: String(error.message ?? "erase failed").slice(0, 200), revoked };
    return { ok: true, counts: (data ?? {}) as Record<string, number>, revoked };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : "erase failed").slice(0, 200), revoked };
  }
}

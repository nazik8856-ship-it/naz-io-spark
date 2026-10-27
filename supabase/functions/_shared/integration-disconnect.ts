// Secrets handling, front 3: what "Disconnect" does to the stored credentials. For each matching integration: read its token,
// cancel it at the provider, record the outcome, then delete the row; deleting the row deletes the stored token (the database
// trigger forget_replaced_vault_secrets). A provider that refuses or is down never stops the disconnect.
import { readSecret } from "./integration-secrets.ts";
import { revokeAtProvider, type RevokeDeps, type RevokeOutcome } from "./revoke-at-provider.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export type DisconnectResult = { ok: true; revocations: RevokeOutcome[] } | { ok: false; error: string };

export async function disconnectIntegration(
  admin: AnyClient,
  userClient: AnyClient,
  target: { userId: string; provider: string; agentId: string | null },
  deps: RevokeDeps,
): Promise<DisconnectResult> {
  let sel = admin.from("agent_integrations").select("id, provider, credentials_secret_id").eq("user_id", target.userId).eq("provider", target.provider);
  sel = target.agentId ? sel.eq("agent_id", target.agentId) : sel.is("agent_id", null);
  const { data: rows } = await sel;

  const revocations: RevokeOutcome[] = [];
  for (const r of (rows ?? []) as { id: string; provider: string; credentials_secret_id: string | null }[]) {
    const creds = await readSecret(admin, r.credentials_secret_id);
    const result = await revokeAtProvider(r.provider, creds, deps);
    revocations.push(result);
    if (result.outcome === "failed") console.warn(`[integration-connect] revocation at ${r.provider} failed: ${result.detail}`);
    await admin.from("secret_events").insert({ user_id: target.userId, kind: "provider_revocation", provider: r.provider, outcome: result.outcome, detail: result.detail });
  }

  // The user's own client: row level security decides what they may delete.
  let del = userClient.from("agent_integrations").delete().eq("user_id", target.userId).eq("provider", target.provider);
  del = target.agentId ? del.eq("agent_id", target.agentId) : del.is("agent_id", null);
  const { error } = await del;
  if (error) return { ok: false, error: error.message };
  return { ok: true, revocations };
}

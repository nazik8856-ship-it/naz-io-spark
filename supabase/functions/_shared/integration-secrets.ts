// Shared helpers to read/write agent_integrations credentials via Supabase Vault.
// All plaintext credentials are stored encrypted at rest; the row only carries
// a `credentials_secret_id` UUID that maps to `vault.decrypted_secrets`.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type Creds = Record<string, unknown>;

export async function readSecret(admin: SupabaseClient, secretId: string | null | undefined): Promise<Creds> {
  if (!secretId) return {};
  const { data, error } = await admin.rpc("read_integration_secret", { sid: secretId });
  if (error) {
    console.error("read_integration_secret failed:", error.message);
    return {};
  }
  return (data as Creds) || {};
}

export async function createSecret(admin: SupabaseClient, payload: Creds, label?: string): Promise<string | null> {
  const { data, error } = await admin.rpc("create_integration_secret", {
    payload,
    label: label ?? null,
  });
  if (error) {
    console.error("create_integration_secret failed:", error.message);
    throw new Error(error.message);
  }
  return (data as string) || null;
}

export async function updateSecret(admin: SupabaseClient, secretId: string, payload: Creds): Promise<void> {
  const { error } = await admin.rpc("update_integration_secret", { sid: secretId, payload });
  if (error) {
    console.error("update_integration_secret failed:", error.message);
    throw new Error(error.message);
  }
}

export async function deleteSecret(admin: SupabaseClient, secretId: string | null | undefined): Promise<void> {
  if (!secretId) return;
  const { error } = await admin.rpc("delete_integration_secret", { sid: secretId });
  if (error) {
    console.error("delete_integration_secret failed:", error.message);
  }
}

// Convenience: hydrate an integration row with its decrypted credentials.
export async function loadIntegrationWithCreds(
  admin: SupabaseClient,
  filter: { id?: string; user_id?: string; provider?: string; agent_id?: string | null },
): Promise<{ id: string; credentials_secret_id: string | null; credentials: Creds; agent_id: string | null } | null> {
  let q = admin
    .from("agent_integrations")
    .select("id, credentials_secret_id, agent_id");
  if (filter.id) q = q.eq("id", filter.id);
  if (filter.user_id) q = q.eq("user_id", filter.user_id);
  if (filter.provider) q = q.eq("provider", filter.provider);
  if (filter.agent_id !== undefined) {
    q = filter.agent_id === null ? q.is("agent_id", null) : q.eq("agent_id", filter.agent_id);
  }
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  const credentials = await readSecret(admin, data.credentials_secret_id as string | null);
  return {
    id: data.id as string,
    credentials_secret_id: (data.credentials_secret_id as string | null) ?? null,
    agent_id: (data.agent_id as string | null) ?? null,
    credentials,
  };
}

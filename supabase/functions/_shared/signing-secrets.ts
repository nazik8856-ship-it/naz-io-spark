// Signing secrets NazAI holds for its customers (an outbound webhook's HMAC secret, an API key's callback secret) live in
// Supabase Vault: the row carries only a *_secret_id, the value is read here, server-side, at the moment it is used. A row made
// before the move to Vault still has its value in the old plain column (secret / previous_secret / callback_secret); it is read
// from there until the migration has moved it, so nothing stops signing in between.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSecret, readSecret, updateSecret } from "./integration-secrets.ts";

/** A secret's value from Vault, or null when there is none. */
export async function vaultSecretValue(admin: SupabaseClient, secretId: string | null | undefined): Promise<string | null> {
  if (!secretId) return null;
  const v = (await readSecret(admin, secretId)).secret;
  return typeof v === "string" && v ? v : null;
}

/** Stores a new signing secret in Vault and returns its id (the label only helps find it in the Vault, it holds no secret). */
export async function storeSigningSecret(admin: SupabaseClient, value: string, label: string): Promise<string | null> {
  return await createSecret(admin, { secret: value }, `${label}-${crypto.randomUUID()}`);
}

/** Replaces the value behind an existing Vault id, or stores a new one; returns the id to keep on the row. */
export async function putSigningSecret(admin: SupabaseClient, existingId: string | null | undefined, value: string, label: string): Promise<string | null> {
  if (existingId) { await updateSecret(admin, existingId, { secret: value }); return existingId; }
  return await storeSigningSecret(admin, value, label);
}

export type StoredWebhookSecrets = {
  secret?: string | null; secret_id?: string | null;
  previous_secret?: string | null; previous_secret_id?: string | null; previous_secret_expires_at?: string | null;
};

/**
 * The secrets a webhook signs with: the current one, and the rotated-out one only while its grace window is still open (the
 * value is not even read otherwise).
 */
export async function webhookSigningSecrets(admin: SupabaseClient, hook: StoredWebhookSecrets, now: Date = new Date()): Promise<{ secret: string | null; previous: string | null }> {
  const secret = (await vaultSecretValue(admin, hook.secret_id)) ?? (hook.secret || null);
  const open = !!hook.previous_secret_expires_at && new Date(hook.previous_secret_expires_at).getTime() > now.getTime();
  const previous = open ? ((await vaultSecretValue(admin, hook.previous_secret_id)) ?? (hook.previous_secret || null)) : null;
  return { secret, previous };
}

/** An API key's callback secret: from Vault, or the old plain column. */
export async function callbackSecretOf(admin: SupabaseClient, key: { callback_secret?: string | null; callback_secret_id?: string | null }): Promise<string | null> {
  return (await vaultSecretValue(admin, key.callback_secret_id)) ?? (key.callback_secret || null);
}

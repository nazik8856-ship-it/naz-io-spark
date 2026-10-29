// Data encryption, front 3: the Supabase client for the edge functions that reach Outer Control content. Same as supabase-js's
// createClient, except that every client it makes reads and writes the encrypted columns (encrypted-db.ts) with DATA_KEY. A
// function imports createClient from here instead of esm.sh; src/test/field-encryption.test.ts checks that every function that
// reaches those tables does.
import { createClient as createSupabaseClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dataKeysFromEnv, MIN_PASSPHRASE_CHARS } from "./field-crypto.ts";
import { optionalSecret, requireSecret } from "./require-secret.ts";
import { withFieldEncryption } from "./encrypted-db.ts";

// Without the key nothing can be read or stored: a missing, misnamed or too short DATA_KEY stops the function at startup, by name.
requireSecret("DATA_KEY", { minLength: MIN_PASSPHRASE_CHARS });
optionalSecret("DATA_KEY_PREVIOUS", { minLength: MIN_PASSPHRASE_CHARS });
const keys = dataKeysFromEnv();

export type { SupabaseClient };
// deno-lint-ignore no-explicit-any
export function createClient(...args: Parameters<typeof createSupabaseClient>): any {
  return withFieldEncryption(createSupabaseClient(...args), keys);
}

/** The plain client, for converting rows only (sweepEncryptedColumns reads and writes the raw columns). */
export const createPlainClient = createSupabaseClient;

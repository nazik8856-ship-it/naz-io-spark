// Run with: deno test --allow-env supabase/functions/_shared/signing-secrets_test.ts
import { callbackSecretOf, putSigningSecret, storeSigningSecret, webhookSigningSecrets } from "./signing-secrets.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

/** A stand-in for the service-role client: the Vault wrapper RPCs over an in-memory map, recording every call. */
function fakeAdmin(vault: Record<string, Record<string, unknown>> = {}) {
  const calls: string[] = [];
  let n = 0;
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === "read_integration_secret") return { data: vault[String(args.sid)] ?? null, error: null };
      if (name === "create_integration_secret") { const id = `vault-${++n}`; vault[id] = args.payload as Record<string, unknown>; calls.push(`label:${args.label}`); return { data: id, error: null }; }
      if (name === "update_integration_secret") { vault[String(args.sid)] = args.payload as Record<string, unknown>; return { data: null, error: null }; }
      return { data: null, error: { message: "unknown rpc" } };
    },
  };
  return { admin: admin as never, calls, vault };
}

const soon = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

Deno.test("a webhook signs with its Vault secret; the plain column is only a fallback for a webhook made before Vault", async () => {
  const { admin } = fakeAdmin({ v1: { secret: "from-vault" }, v2: { secret: "previous-from-vault" } });
  assertEquals(await webhookSigningSecrets(admin, { secret: "", secret_id: "v1" }), { secret: "from-vault", previous: null });
  assertEquals(await webhookSigningSecrets(admin, { secret: "legacy-plain" }), { secret: "legacy-plain", previous: null });
  assertEquals(await webhookSigningSecrets(admin, { secret: "", secret_id: "v1", previous_secret_id: "v2", previous_secret_expires_at: soon }), { secret: "from-vault", previous: "previous-from-vault" });
  assertEquals(await webhookSigningSecrets(admin, { secret: "", secret_id: "missing" }), { secret: null, previous: null }, "an unreadable secret is null, never an empty signature key");
});

Deno.test("the rotated-out secret is not even read once its grace window has closed", async () => {
  const { admin, calls } = fakeAdmin({ v1: { secret: "cur" }, v2: { secret: "old" } });
  assertEquals(await webhookSigningSecrets(admin, { secret_id: "v1", previous_secret_id: "v2", previous_secret_expires_at: past }), { secret: "cur", previous: null });
  assertEquals(calls, ["read_integration_secret"], "only the current secret was read");
});

Deno.test("storing and replacing: a new secret gets its own Vault entry; replacing keeps the id; labels hold no secret", async () => {
  const { admin, calls, vault } = fakeAdmin();
  const id = await storeSigningSecret(admin, "s3cr3t-value", "webhook-acct");
  assertEquals(vault[id!], { secret: "s3cr3t-value" });
  const label = calls.find((c) => c.startsWith("label:"))!;
  if (!/^label:webhook-acct-[0-9a-f-]{36}$/.test(label) || label.includes("s3cr3t")) throw new Error(`bad label ${label}`);
  assertEquals(await putSigningSecret(admin, id, "next-value", "x"), id);
  assertEquals(vault[id!], { secret: "next-value" });
  const fresh = await putSigningSecret(admin, null, "other", "api-key-callback-k1");
  if (fresh === id) throw new Error("a new entry was expected");
});

Deno.test("an API key's callback secret: Vault first, then the old column", async () => {
  const { admin } = fakeAdmin({ c1: { secret: "cb-vault" } });
  assertEquals(await callbackSecretOf(admin, { callback_secret_id: "c1", callback_secret: null }), "cb-vault");
  assertEquals(await callbackSecretOf(admin, { callback_secret: "cb-legacy" }), "cb-legacy");
  assertEquals(await callbackSecretOf(admin, { callback_secret: null, callback_secret_id: null }), null);
});

// Run with: deno test --allow-env supabase/functions/_shared/svix-verify_test.ts
// Secrets handling, front 4: an inbound webhook secret can be rotated without dropping events -- during the rotation both the
// new and the previous secret verify; afterwards only the new one does.
import { verifySvixSignature, webhookSecrets } from "./svix-verify.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const newSecret = () => `whsec_${b64(crypto.getRandomValues(new Uint8Array(24)))}`;
async function sign(secret: string, id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `v1,${b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`))))}`;
}
const now = () => String(Math.floor(Date.now() / 1000));

Deno.test("during a rotation an event signed with the old secret and one signed with the new both verify; afterwards only the new", async () => {
  const OLD = newSecret(), NEW = newSecret(), body = '{"type":"email.bounced"}', ts = now();
  const byOld = await sign(OLD, "msg_1", ts, body), byNew = await sign(NEW, "msg_2", ts, body);
  assertEquals(await verifySvixSignature([NEW, OLD], "msg_1", ts, byOld, body), null);
  assertEquals(await verifySvixSignature([NEW, OLD], "msg_2", ts, byNew, body), null);
  assertEquals(await verifySvixSignature([NEW], "msg_1", ts, byOld, body), "signature mismatch", "once the previous secret is removed it no longer verifies");
  assertEquals(await verifySvixSignature([NEW], "msg_2", ts, byNew, body), null);
});

Deno.test("a changed body, a stale timestamp, missing headers or a malformed secret never verify (and never throw)", async () => {
  const S = newSecret(), ts = now(), sig = await sign(S, "m", ts, "a");
  assertEquals(await verifySvixSignature([S], "m", ts, sig, "b"), "signature mismatch");
  assertEquals(await verifySvixSignature([S], "m", String(Number(ts) - 3600), await sign(S, "m", String(Number(ts) - 3600), "a"), "a"), "stale svix-timestamp");
  assertEquals(await verifySvixSignature([S], null, ts, sig, "a"), "missing svix headers");
  assertEquals(await verifySvixSignature(["whsec_not base64!!", S], "m", ts, sig, "a"), null, "a broken previous secret does not block the good one");
});

Deno.test("webhookSecrets: the secret, then <name>_PREVIOUS; blanks and duplicates dropped", () => {
  const env = (m: Record<string, string>) => (n: string) => m[n];
  assertEquals(webhookSecrets("RESEND_WEBHOOK_SECRET", env({ RESEND_WEBHOOK_SECRET: "a", RESEND_WEBHOOK_SECRET_PREVIOUS: "b" })), ["a", "b"]);
  assertEquals(webhookSecrets("RESEND_WEBHOOK_SECRET", env({ RESEND_WEBHOOK_SECRET: "a", RESEND_WEBHOOK_SECRET_PREVIOUS: " a " })), ["a"]);
  assertEquals(webhookSecrets("RESEND_WEBHOOK_SECRET", env({ RESEND_WEBHOOK_SECRET_PREVIOUS: "" })), []);
});

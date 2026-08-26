// Real tests for the shared OAuth client-secret rotation helpers.
//
// Run with: deno test --allow-none supabase/functions/_shared/oauth-secret-rotation_test.ts
import { withClientSecretRotation, verifyWithClientSecretRotation, isStandardInvalidClientError, type RotatableClientSecret } from "./oauth-secret-rotation.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("withClientSecretRotation: the current secret succeeding never touches the previous one", async () => {
  const secrets: RotatableClientSecret = { current: "new-secret", previous: "old-secret" };
  const tried: string[] = [];
  const result = await withClientSecretRotation(
    secrets,
    async (secret) => { tried.push(secret); return { ok: true, secretUsed: secret }; },
    (r) => !r.ok,
  );
  assertEquals(tried, ["new-secret"]);
  assertEquals(result, { ok: true, secretUsed: "new-secret" });
});

Deno.test("withClientSecretRotation: an invalid_client-shaped failure retries with the previous secret", async () => {
  const secrets: RotatableClientSecret = { current: "new-secret", previous: "old-secret" };
  const tried: string[] = [];
  const result = await withClientSecretRotation(
    secrets,
    async (secret) => { tried.push(secret); return secret === "old-secret" ? { ok: true } : { ok: false, error: "invalid_client" }; },
    (r) => !r.ok,
  );
  assertEquals(tried, ["new-secret", "old-secret"]);
  assertEquals(result, { ok: true });
});

Deno.test("withClientSecretRotation: no previous secret configured -- the first (failing) result is returned as-is, no retry attempted", async () => {
  const secrets: RotatableClientSecret = { current: "new-secret", previous: null };
  const tried: string[] = [];
  const result = await withClientSecretRotation(
    secrets,
    async (secret) => { tried.push(secret); return { ok: false, error: "invalid_client" }; },
    (r) => !r.ok,
  );
  assertEquals(tried, ["new-secret"]);
  assertEquals(result, { ok: false, error: "invalid_client" });
});

Deno.test("withClientSecretRotation: a failure that ISN'T a client-auth error is never retried, even with a previous secret configured", async () => {
  // A revoked refresh token, a network error, or a provider 500 has nothing
  // to do with which client secret is in use -- retrying with a different
  // secret can't fix it, and doing so anyway would mask the real error.
  const secrets: RotatableClientSecret = { current: "new-secret", previous: "old-secret" };
  const tried: string[] = [];
  const result = await withClientSecretRotation(
    secrets,
    async (secret) => { tried.push(secret); return { ok: false, error: "invalid_grant" }; },
    (r) => r.error === "invalid_client",
  );
  assertEquals(tried, ["new-secret"]);
  assertEquals(result, { ok: false, error: "invalid_grant" });
});

Deno.test("verifyWithClientSecretRotation: the current secret verifying is accepted without trying the previous one", async () => {
  const secrets: RotatableClientSecret = { current: "new-secret", previous: "old-secret" };
  const tried: string[] = [];
  const ok = await verifyWithClientSecretRotation(secrets, async (secret) => { tried.push(secret); return secret === "new-secret"; });
  assert(ok);
  assertEquals(tried, ["new-secret"]);
});

Deno.test("verifyWithClientSecretRotation: falls back to the previous secret when the current one doesn't verify", async () => {
  const secrets: RotatableClientSecret = { current: "new-secret", previous: "old-secret" };
  const ok = await verifyWithClientSecretRotation(secrets, async (secret) => secret === "old-secret");
  assert(ok);
});

Deno.test("verifyWithClientSecretRotation: neither secret verifying returns false, not a throw", async () => {
  const secrets: RotatableClientSecret = { current: "new-secret", previous: "old-secret" };
  const ok = await verifyWithClientSecretRotation(secrets, async () => false);
  assert(!ok);
});

Deno.test("verifyWithClientSecretRotation: no previous secret configured and the current one fails -- returns false, no retry attempted", async () => {
  const secrets: RotatableClientSecret = { current: "new-secret", previous: null };
  const tried: string[] = [];
  const ok = await verifyWithClientSecretRotation(secrets, async (secret) => { tried.push(secret); return false; });
  assert(!ok);
  assertEquals(tried, ["new-secret"]);
});

Deno.test("isStandardInvalidClientError: recognizes RFC 6749's invalid_client error code", () => {
  assert(isStandardInvalidClientError({ error: "invalid_client" }));
});

Deno.test("isStandardInvalidClientError: rejects other error codes and malformed input", () => {
  assert(!isStandardInvalidClientError({ error: "invalid_grant" }));
  assert(!isStandardInvalidClientError(null));
  assert(!isStandardInvalidClientError({}));
});

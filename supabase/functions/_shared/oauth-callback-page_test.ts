// Real tests for oauth-callback-page.ts's pure origin-validation helpers.
//
// Run with: deno test --allow-none supabase/functions/_shared/oauth-callback-page_test.ts
import { isAllowedRedirectOrigin, safeRedirectOrigin, oauthCallbackPage } from "./oauth-callback-page.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(actual === expected, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("isAllowedRedirectOrigin: the real production and Vercel origins are allowed", () => {
  assert(isAllowedRedirectOrigin("https://nazai.net"));
  assert(isAllowedRedirectOrigin("https://www.nazai.net"));
  assert(isAllowedRedirectOrigin("https://naz-io.vercel.app"));
});

Deno.test("isAllowedRedirectOrigin: the Lovable preview domain is deliberately not a redirect target", () => {
  assertFalse(isAllowedRedirectOrigin("https://naz-io-spark.lovable.app"));
});

Deno.test("isAllowedRedirectOrigin: localhost (any port) is allowed for local dev", () => {
  assert(isAllowedRedirectOrigin("http://localhost:5173"));
  assert(isAllowedRedirectOrigin("http://127.0.0.1:5173"));
  assert(isAllowedRedirectOrigin("http://localhost"));
});

Deno.test("isAllowedRedirectOrigin: an arbitrary attacker-supplied origin is rejected", () => {
  assertFalse(isAllowedRedirectOrigin("https://evil.com"));
  assertFalse(isAllowedRedirectOrigin("https://nazai.net.evil.com"));
  assertFalse(isAllowedRedirectOrigin("https://nazai.net@evil.com"));
  assertFalse(isAllowedRedirectOrigin("javascript:alert(1)"));
});

Deno.test("isAllowedRedirectOrigin: null/undefined/empty is rejected", () => {
  assertFalse(isAllowedRedirectOrigin(null));
  assertFalse(isAllowedRedirectOrigin(undefined));
  assertFalse(isAllowedRedirectOrigin(""));
});

Deno.test("safeRedirectOrigin: passes through an allowed origin unchanged", () => {
  assertEquals(safeRedirectOrigin("https://www.nazai.net"), "https://www.nazai.net");
});

Deno.test("safeRedirectOrigin: falls back to production for a disallowed origin", () => {
  assertEquals(safeRedirectOrigin("https://evil.com"), "https://nazai.net");
  assertEquals(safeRedirectOrigin(null), "https://nazai.net");
});

Deno.test("oauthCallbackPage: embeds the postMessage source/ok/message and the validated redirect target", () => {
  const htmlOut = oauthCallbackPage({
    title: "Figma connected", message: "Connected as Alice.", ok: true,
    source: "nazai-figma-oauth", redirectOrigin: "https://evil.com",
  });
  assert(htmlOut.includes('"source":"nazai-figma-oauth"'));
  assert(htmlOut.includes('"ok":true'));
  assert(htmlOut.includes("Connected as Alice."));
  // The malicious origin must never appear -- only the safe fallback should.
  assertFalse(htmlOut.includes("evil.com"));
  assert(htmlOut.includes("https://nazai.net"));
  assert(htmlOut.includes("window.opener"));
  assert(htmlOut.includes("window.close"));
});

Deno.test("oauthCallbackPage: merges provider-specific extra fields into the postMessage payload", () => {
  const htmlOut = oauthCallbackPage({
    title: "Shopify connected", message: "Connected mystore.", ok: true,
    source: "nazai-shopify-oauth", extra: { shop: "mystore.myshopify.com" },
  });
  assert(htmlOut.includes('"shop":"mystore.myshopify.com"'));
});

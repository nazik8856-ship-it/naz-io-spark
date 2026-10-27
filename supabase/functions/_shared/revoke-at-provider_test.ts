// Run with: deno test --allow-env supabase/functions/_shared/revoke-at-provider_test.ts
// Secrets handling, front 3: each provider is asked to cancel the token the way its API documents, and a refusal is reported,
// never thrown.
import { revokeAtProvider, type RevokeDeps } from "./revoke-at-provider.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

type Call = { url: string; method: string; headers: Record<string, string>; body: string };
function deps(answer: (c: Call) => { status: number; body?: string } | "throw", env: Record<string, string> = {}): RevokeDeps & { calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const c = { url, method: String(init.method), headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body ?? "") };
    calls.push(c);
    const a = answer(c);
    if (a === "throw") throw new Error("connection reset");
    return new Response(a.body ?? "", { status: a.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, env: (n) => env[n], calls };
}
const ENV = { NOTION_CLIENT_ID: "nid", NOTION_CLIENT_SECRET: "nsec", CANVA_CLIENT_ID: "cid", CANVA_CLIENT_SECRET: "csec" };

Deno.test("Google: the refresh token is revoked (it ends the whole grant), form-encoded", async () => {
  const d = deps(() => ({ status: 200 }));
  assertEquals(await revokeAtProvider("Gmail", { access_token: "ya29.a", refresh_token: "1//r" }, d), { outcome: "revoked", detail: null });
  assertEquals(d.calls[0].url, "https://oauth2.googleapis.com/revoke");
  assertEquals(d.calls[0].method, "POST");
  assertEquals(d.calls[0].body, "token=1%2F%2Fr");
  assertEquals(d.calls[0].headers["content-type"], "application/x-www-form-urlencoded");
});

Deno.test("Google: a token it already considers invalid counts as revoked; anything else is a failure with the reason", async () => {
  assertEquals((await revokeAtProvider("Gmail", { access_token: "ya29.a" }, deps(() => ({ status: 400, body: '{"error":"invalid_token"}' })))).outcome, "revoked");
  const r = await revokeAtProvider("Gmail", { access_token: "ya29.a" }, deps(() => ({ status: 503, body: "busy" })));
  assertEquals(r, { outcome: "failed", detail: "The provider answered HTTP 503: busy" });
});

Deno.test("Slack: auth.revoke with the token as Bearer; ok only when Slack says revoked", async () => {
  const d = deps(() => ({ status: 200, body: '{"ok":true,"revoked":true}' }));
  assertEquals((await revokeAtProvider("Slack", { access_token: "xoxb-1" }, d)).outcome, "revoked");
  assertEquals(d.calls[0].url, "https://slack.com/api/auth.revoke");
  assertEquals(d.calls[0].headers.authorization, "Bearer xoxb-1");
  assertEquals((await revokeAtProvider("Slack", { access_token: "xoxb-1" }, deps(() => ({ status: 200, body: '{"ok":false,"error":"invalid_auth"}' })))).outcome, "revoked", "already dead");
  assertEquals((await revokeAtProvider("Slack", { access_token: "xoxb-1" }, deps(() => ({ status: 200, body: '{"ok":false,"error":"ratelimited"}' })))).outcome, "failed");
});

Deno.test("Notion and Canva: client id and secret as Basic auth; Canva gets the refresh token", async () => {
  const n = deps(() => ({ status: 200 }), ENV);
  assertEquals((await revokeAtProvider("Notion", { access_token: "ntn_x" }, n)).outcome, "revoked");
  assertEquals(n.calls[0].url, "https://api.notion.com/v1/oauth/revoke");
  assertEquals(n.calls[0].headers.authorization, `Basic ${btoa("nid:nsec")}`);
  assertEquals(JSON.parse(n.calls[0].body), { token: "ntn_x" });
  const c = deps(() => ({ status: 200 }), ENV);
  assertEquals((await revokeAtProvider("Canva", { access_token: "a", refresh_token: "r" }, c)).outcome, "revoked");
  assertEquals(c.calls[0].url, "https://api.canva.com/rest/v1/oauth/revoke");
  assertEquals(c.calls[0].headers.authorization, `Basic ${btoa("cid:csec")}`);
  assertEquals(c.calls[0].body, "token=r");
  assertEquals((await revokeAtProvider("Notion", { access_token: "ntn_x" }, deps(() => ({ status: 200 })))).outcome, "failed", "no client credentials configured");
});

Deno.test("Shopify: DELETE api_permissions/current.json on the stored shop; a bad shop address is never contacted", async () => {
  const d = deps(() => ({ status: 200 }));
  assertEquals((await revokeAtProvider("Shopify", { access_token: "shpat_x", shop_domain: "acme.myshopify.com" }, d)).outcome, "revoked");
  assertEquals(d.calls[0], { url: "https://acme.myshopify.com/admin/api_permissions/current.json", method: "DELETE", headers: { "x-shopify-access-token": "shpat_x" }, body: "" });
  const bad = deps(() => ({ status: 200 }));
  assertEquals((await revokeAtProvider("Shopify", { access_token: "shpat_x", shop_domain: "evil.example.com/x?" }, bad)).outcome, "failed");
  assertEquals(bad.calls.length, 0);
});

Deno.test("Figma and pasted keys: nothing to call, said plainly; no token: nothing to do; a network error is a failure, not a throw", async () => {
  const d = deps(() => ({ status: 200 }));
  assertEquals((await revokeAtProvider("Figma", { access_token: "figd_x" }, d)).outcome, "unsupported");
  assertEquals((await revokeAtProvider("Stripe", { api_key: "sk_live_x" }, d)).outcome, "unsupported");
  assertEquals((await revokeAtProvider("Gmail", {}, d)).outcome, "none");
  assertEquals(d.calls.length, 0);
  const r = await revokeAtProvider("Slack", { access_token: "xoxb-1" }, deps(() => "throw"));
  assertEquals(r.outcome, "failed");
  assert(r.detail?.includes("could not be reached"), String(r.detail));
});

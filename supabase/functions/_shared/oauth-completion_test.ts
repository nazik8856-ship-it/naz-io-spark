import { completionRedirect, oauthGate, oauthResponse, type PeekFn } from "./oauth-completion.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }

const STARTER = "00000000-0000-0000-0000-0000000000a1", STRANGER = "00000000-0000-0000-0000-0000000000b2";
const peekFor = (origin: string | null = "https://nazai.net"): PeekFn => async (_p, state) => (state === "good" ? { user_id: STARTER, request_origin: origin } : null);
const get = (qs: string) => new Request(`https://x.test/functions/v1/slack-oauth-callback?${qs}`);
const post = (qs: string, origin = "https://nazai.net") => new Request(`https://x.test/functions/v1/slack-oauth-callback?${qs}`, { method: "POST", headers: { Authorization: "Bearer t", Origin: origin } });

Deno.test("the provider's redirect (GET) is handed back to the app, with every parameter, and uses nothing up", async () => {
  let peeks = 0;
  const res = await oauthGate(get("code=abc&state=good&team=T1"), { provider: "slack", peek: async (p, s) => { peeks++; return peekFor()(p, s); } });
  assertEquals(res!.status, 302);
  const to = new URL(res!.headers.get("Location")!);
  assertEquals(to.origin + to.pathname, "https://nazai.net/oauth/complete");
  assertEquals([to.searchParams.get("provider"), to.searchParams.get("code"), to.searchParams.get("state"), to.searchParams.get("team")], ["slack", "abc", "good", "T1"]);
  assertEquals(peeks, 1, "it only looked, once");
  assertEquals(res!.headers.get("Referrer-Policy"), "no-referrer");
});

Deno.test("the redirect goes to the app address the connection was started from when it is one of ours, otherwise to production", async () => {
  const local = await oauthGate(get("code=a&state=good"), { provider: "slack", peek: peekFor("http://localhost:5173") });
  assertEquals(new URL(local!.headers.get("Location")!).origin, "http://localhost:5173");
  const evil = await oauthGate(get("code=a&state=good"), { provider: "slack", peek: peekFor("https://evil.example") });
  assertEquals(new URL(evil!.headers.get("Location")!).origin, "https://nazai.net");
  const signed = await oauthGate(get("code=a&state=signed"), { provider: "gmail", peek: peekFor(null), originFromState: async () => "https://www.nazai.net" });
  assertEquals(new URL(signed!.headers.get("Location")!).origin, "https://www.nazai.net", "an address carried in a signed state is used when the table has none");
});

Deno.test("a GET without a state carries on to the callback's own page; a failing lookup still sends the browser back to the app", async () => {
  assertEquals(await oauthGate(get("code=abc"), { provider: "slack", peek: peekFor() }), null);
  const res = await oauthGate(get("code=a&state=good"), { provider: "slack", peek: async () => { throw new Error("db down"); } });
  assertEquals(res!.status, 302);
});

Deno.test("finishing: nobody signed in is turned away with 401 and nothing is looked up as the starter", async () => {
  const res = await oauthGate(post("code=a&state=good"), { provider: "slack", peek: peekFor(), who: async () => null });
  assertEquals(res!.status, 401);
  assertEquals((await res!.json()).ok, false);
});

Deno.test("finishing: a different account than the one that started it gets 403 and the state stays unused", async () => {
  const res = await oauthGate(post("code=a&state=good"), { provider: "slack", peek: peekFor(), who: async () => STRANGER });
  assertEquals(res!.status, 403);
  const body = await res!.json();
  assertEquals(body.ok, false);
  assert(String(body.message).includes("different NazAI account"));
});

Deno.test("finishing: the account that started it carries on; an unknown state is left to the callback's own answer", async () => {
  assertEquals(await oauthGate(post("code=a&state=good"), { provider: "slack", peek: peekFor(), who: async () => STARTER }), null);
  assertEquals(await oauthGate(post("code=a&state=used-or-made-up"), { provider: "slack", peek: peekFor(), who: async () => STRANGER }), null);
  assertEquals(await oauthGate(post("code=a"), { provider: "slack", peek: peekFor(), who: async () => STARTER }), null);
});

Deno.test("finishing: when the lookup itself fails the request stops (503), it is never let through unchecked", async () => {
  const res = await oauthGate(post("code=a&state=good"), { provider: "slack", peek: async () => { throw new Error("db down"); }, who: async () => STARTER });
  assertEquals(res!.status, 503);
});

Deno.test("preflight answers only for our own app's origins; other methods are refused", async () => {
  const ok = await oauthGate(new Request("https://x.test/f", { method: "OPTIONS", headers: { Origin: "https://nazai.net" } }), { provider: "slack" });
  assertEquals([ok!.status, ok!.headers.get("Access-Control-Allow-Origin")], [204, "https://nazai.net"]);
  const other = await oauthGate(new Request("https://x.test/f", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), { provider: "slack" });
  assertEquals(other!.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await oauthGate(new Request("https://x.test/f", { method: "PUT" }), { provider: "slack" }))!.status, 405);
});

Deno.test("the answer is the result page for the provider's redirect and JSON for the app", async () => {
  const opts = { title: "Slack connected", message: "Connected to Acme.", ok: true, source: "nazai-slack-oauth", extra: { team: "T1" } };
  const html = oauthResponse(get("x=1"), opts, 200);
  assert((html.headers.get("Content-Type") ?? "").startsWith("text/html"));
  const json = oauthResponse(post("x=1"), opts, 200);
  assertEquals(await json.json(), { source: "nazai-slack-oauth", ok: true, title: "Slack connected", message: "Connected to Acme.", team: "T1" });
  assertEquals(json.headers.get("Access-Control-Allow-Origin"), "https://nazai.net");
});

Deno.test("completionRedirect keeps provider-signed parameters (Shopify's hmac) exactly and never lets a caller choose the host", () => {
  const u = new URL(completionRedirect("https://evil.example", "shopify", new URLSearchParams("shop=a.myshopify.com&hmac=abc&state=s&provider=hijack")));
  assertEquals(u.origin, "https://nazai.net");
  assertEquals([u.searchParams.get("hmac"), u.searchParams.get("shop"), u.searchParams.get("provider")], ["abc", "a.myshopify.com", "shopify"]);
});

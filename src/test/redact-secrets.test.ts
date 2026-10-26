// Secrets handling, front 2: the one scrubber used by the edge functions' console, Sentry (server and website), PostHog's error
// capture and (as its SQL twin) the stored-error trigger. The website copy must stay byte-identical to the server one.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REDACTED, redactDeep, redactSecrets, scrubErrorEvent } from "@/lib/redact-secrets";
import { scrubPostHogEvent } from "@/lib/posthog";

const R = REDACTED;
const KEYS = {
  anthropic: "sk-ant-api03-" + "Ab1_".repeat(8),
  openaiProject: "sk-proj-" + "Xy9-".repeat(8),
  openai: "sk-" + "a1B2".repeat(6),
  stripe: "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc",
  githubFine: "github_pat_" + "11ABCDEFG0".repeat(3),
  githubClassic: "ghp_" + "a1b2c3d4e5".repeat(4),
  aws: "AKIA" + "IOSFODNN7EXAMPLE",
  slack: "xoxb-" + "1234567890-abcdefghij",
  google: "AIza" + "SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY",
  googleAccess: "ya29." + "a0AfH6SMBx7f9L2kqZ3".repeat(2),
  notion: "secret_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6",
  resend: "re_" + "123abcDEF456ghiJKL789mno",
  jwt: "eyJhbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0" + "." + "abcDEF123_-xyz",
};

describe("redactSecrets: the secret goes, the words around it stay", () => {
  it.each(Object.entries(KEYS))("a %s key is removed wherever it appears", (_kind, key) => {
    const out = redactSecrets(`calling the tool with ${key} now`);
    expect(out).not.toContain(key);
    expect(out).toContain(R);
    expect(out.startsWith("calling the tool with ")).toBe(true);
  });

  it("an Authorization header, a named value and URL parameters lose only their values", () => {
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnop123")).toBe(`Authorization: ${R}`);
    expect(redactSecrets("got header Bearer abcdefghijklmnop123 back")).toBe(`got header Bearer ${R} back`);
    expect(redactSecrets(`Authorization: Bearer ${KEYS.jwt}`)).toBe(`Authorization: Bearer ${R}`);
    expect(redactSecrets(`x-api-key: ${KEYS.anthropic}`)).toBe(`x-api-key: ${R}`);
    expect(redactSecrets('{"access_token":"tok_live_123456789","expires_in":3600}')).toBe(`{"access_token":"${R}","expires_in":3600}`);
    expect(redactSecrets("client_secret=s3cr3tvalue&grant_type=refresh_token")).toBe(`client_secret=${R}&grant_type=refresh_token`);
    expect(redactSecrets("GET https://api.example.com/cb?code=4/0AY0e-g7&state=xyz&access_token=abc123def")).toBe(`GET https://api.example.com/cb?code=${R}&state=xyz&access_token=${R}`);
    expect(redactSecrets("password: hunter2024!")).toBe(`password: ${R}`);
  });

  it("a private key block is removed whole", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(`key: ${pem} done`)).not.toMatch(/MIIEow|abc\n/);
  });

  it("ordinary text, ids, counts and already-redacted text are left as they are", () => {
    for (const t of [
      "The tool answered HTTP 503 after 30 seconds.",
      "tokens_used: 1200, secret_id: 9b2f0c1e-1111-2222-3333-444455556666",
      "Use the risk-assessment-framework for skeleton keys and tokens.",
      `token: ${R}`,
      "https://example.com/page?state=abc&lang=en",
    ]) expect(redactSecrets(t)).toBe(t);
    expect(redactSecrets(redactSecrets(`token=${KEYS.openai}`))).toBe(`token=${R}`);
  });
});

describe("redactDeep: objects, errors and headers", () => {
  it("blanks secret-named keys and scrubs every string, keeping the shape", () => {
    const out = redactDeep({
      provider: "Notion", status: 401, headers: { Authorization: "Bearer zzzzzzzzzzzz", "content-type": "application/json" },
      body: { access_token: "anything-at-all", note: `retry with ${KEYS.stripe}` }, list: [KEYS.aws, "fine"], secret_id: "uuid-kept",
    }) as { headers: Record<string, string>; body: Record<string, string>; list: string[]; secret_id: string; provider: string };
    expect(out.headers.Authorization).toBe(R);
    expect(out.headers["content-type"]).toBe("application/json");
    expect(out.body.access_token).toBe(R);
    expect(out.body.note).toBe(`retry with ${R}`);
    expect(out.list).toEqual([R, "fine"]);
    expect(out.secret_id).toBe("uuid-kept");
    expect(out.provider).toBe("Notion");
  });

  it("keeps an error readable with its secret removed, survives cycles, never throws", () => {
    const e = new Error(`Notion refused token ${KEYS.notion}`);
    const out = redactDeep(e) as Error;
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe(`Notion refused token ${R}`);
    expect(out.stack ?? "").not.toContain(KEYS.notion);
    const a: Record<string, unknown> = { name: "a" }; a.self = a;
    expect((redactDeep(a) as Record<string, unknown>).self).toBe("[circular]");
    const h = new Headers({ authorization: "Bearer abcdefghijkl", accept: "x" });
    expect(redactDeep(h)).toEqual({ authorization: R, accept: "x" });
  });
});

describe("error reports leave without secrets", () => {
  it("a Sentry event: request headers and cookies dropped, message, exception, extra and breadcrumbs scrubbed", () => {
    const event = {
      message: `failed with ${KEYS.openai}`,
      exception: { values: [{ type: "Error", value: `GET https://x.test/cb?access_token=abc123456&ok=1` }] },
      extra: { body: { client_secret: "zzz-secret-value" }, tool: "Notion" },
      breadcrumbs: [{ category: "fetch", data: { url: `https://api.test/v1?key=${KEYS.google}` } }],
      request: { url: "https://app.test/page", headers: { Authorization: "Bearer abcdefghijklmnop" }, cookies: { sb: "session" } },
    };
    const out = scrubErrorEvent(event)!;
    const text = JSON.stringify(out);
    for (const s of [KEYS.openai, "abc123456", "zzz-secret-value", KEYS.google, "abcdefghijklmnop", "session"]) expect(text).not.toContain(s);
    expect(out.request).toEqual({ url: "https://app.test/page" });
    expect(out.extra.tool).toBe("Notion");
    expect(out.exception.values[0].value).toBe(`GET https://x.test/cb?access_token=${R}&ok=1`);
  });

  it("a PostHog event: the error message is scrubbed, the public project key kept, replay snapshots untouched", () => {
    const exc = { event: "$exception", properties: { token: "phc_public_project_key", $exception_message: `Bearer ${KEYS.jwt}`, $current_url: "https://app.test/cb?code=4/0AY0e&state=x" } };
    const out = scrubPostHogEvent(exc)!;
    expect(out.properties!.token).toBe("phc_public_project_key");
    expect(out.properties!.$exception_message).toBe(`Bearer ${R}`);
    expect(out.properties!.$current_url).toBe(`https://app.test/cb?code=${R}&state=x`);
    const snap = { event: "$snapshot", properties: { token: "phc_public_project_key", $snapshot_data: [{ deep: { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } } }] } };
    expect(scrubPostHogEvent(snap)).toBe(snap);
    expect(scrubPostHogEvent(null)).toBeNull();
  });
});

describe("the server and website copies are byte-identical", () => {
  it("src/lib/redact-secrets.ts matches supabase/functions/_shared/redact-secrets.ts", () => {
    const a = readFileSync(join(__dirname, "../lib/redact-secrets.ts"), "utf8");
    const b = readFileSync(join(__dirname, "../../supabase/functions/_shared/redact-secrets.ts"), "utf8");
    expect(a).toBe(b);
  });
});

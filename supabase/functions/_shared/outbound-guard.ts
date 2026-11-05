// General data security, task 2: protected data in transit (docs/data-in-transit.md).
//
// Two layers, both hard (nothing is sent that should not be; there is no warning-only mode):
//
// 1. The request guard. Importing this module patches fetch for the whole function (every edge function imports it right after
//    redact-console.ts; src/test/data-in-transit.test.ts checks). Before any request leaves for a host other than NazAI's own
//    Supabase project, it looks for NazAI's own credentials (every environment value named like a key, secret, token or password)
//    in the address, the headers and the body. A credential may only go to the service it belongs to (an OAuth client secret to that
//    provider's token endpoint, a model key to that model provider); anything else (the service key, DATA_KEY, PROJECTS_KEY,
//    signing secrets) may go nowhere but NazAI's own project. A request that would carry one elsewhere is refused before it is sent:
//    fetch throws OutboundBlocked, and the log line names the credential and the host, never the value.
//
// 2. Content masking. Where an account's content leaves NazAI (a connected tool's request, an MCP call, a provider write, a model
//    prompt, a webhook or a callback), maskOutbound() replaces anything shaped like a provider credential (the formats the secrets
//    rule knows, except plain JWTs: NazAI's own expiring file links carry one and are meant to be shared), every NazAI credential
//    value, and the tool's own credential, with [REDACTED:secrets]. The same masking is applied to what comes back before it is
//    stored (scrubInbound).
import { REDACTED, SECRET_SHAPES } from "./redact-secrets.ts";

export class OutboundBlocked extends Error {
  constructor(message: string) { super(message); this.name = "OutboundBlocked"; }
}

type Secret = { name: string; value: string; hosts: string[] };

// DB_URL: the database connection string carries its password.
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|DSN|DB_URL)(_PREVIOUS)?$|_KEY_|_SECRET_|_TOKEN_/;
// Public by design (sent by every browser) or not a secret.
const NOT_SECRET = new Set(["SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS"]);
const MIN_SECRET_CHARS = 16;

/** Where each credential may go (host suffixes). A credential that matches none may go only to NazAI's own project. */
export const SECRET_HOSTS: [RegExp, string[]][] = [
  [/^LOVABLE_/, ["lovable.dev"]],
  [/^OPENAI_/, ["openai.com"]],
  [/^OPENROUTER_/, ["openrouter.ai"]],
  [/^ANTHROPIC_/, ["anthropic.com"]],
  [/^RESEND_API_KEY/, ["resend.com"]],
  [/^SLACK_/, ["slack.com"]],
  [/^GOOGLE_/, ["googleapis.com", "google.com"]],
  [/^NOTION_/, ["notion.com"]],
  [/^CANVA_/, ["canva.com"]],
  [/^FIGMA_/, ["figma.com"]],
  [/^SHOPIFY_/, ["myshopify.com", "shopify.com"]],
  [/^SENTRY_/, ["sentry.io"]],
];

export function allowedHostsFor(name: string): string[] {
  for (const [re, hosts] of SECRET_HOSTS) if (re.test(name)) return hosts;
  return [];
}

/** NazAI's own credentials in an environment: names that say they are secret, values long enough to be one. */
export function secretsFrom(env: Record<string, string>): Secret[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && !NOT_SECRET.has(name) && typeof value === "string" && value.length >= MIN_SECRET_CHARS)
    .map(([name, value]) => ({ name, value, hosts: allowedHostsFor(name) }))
    .sort((a, b) => b.value.length - a.value.length);
}

export function hostAllowed(host: string, allowed: string[], ownHost: string | null): boolean {
  const h = host.toLowerCase();
  if (ownHost && h === ownHost) return true;
  return allowed.some((s) => h === s || h.endsWith(`.${s}`));
}

export type OutgoingParts = { url: string; headers: [string, string][]; body: string | null };

/** The first NazAI credential this request would carry to a host it does not belong to, or null. */
export function findLeak(parts: OutgoingParts, secrets: Secret[], ownHost: string | null): { name: string; where: "address" | "header" | "body"; host: string } | null {
  let host: string;
  try { host = new URL(parts.url).hostname.toLowerCase(); } catch { return null; }
  if (ownHost && host === ownHost) return null;
  for (const s of secrets) {
    if (hostAllowed(host, s.hosts, ownHost)) continue;
    const forms = [s.value, encodeURIComponent(s.value)];
    if (forms.some((v) => parts.url.includes(v))) return { name: s.name, where: "address", host };
    if (parts.headers.some(([, v]) => forms.some((f) => v.includes(f)))) return { name: s.name, where: "header", host };
    if (parts.body !== null && forms.some((f) => parts.body!.includes(f))) return { name: s.name, where: "body", host };
  }
  return null;
}

const MAX_BODY_SCAN = 4 * 1024 * 1024;

async function bodyText(input: RequestInfo | URL, init: RequestInit | undefined): Promise<string | null> {
  const b = init?.body ?? null;
  if (typeof b === "string") return b;
  if (b instanceof URLSearchParams) return b.toString();
  if (b instanceof Uint8Array || b instanceof ArrayBuffer) {
    const bytes = b instanceof ArrayBuffer ? new Uint8Array(b) : b;
    return bytes.byteLength > MAX_BODY_SCAN ? null : new TextDecoder().decode(bytes);
  }
  if (b === null && input instanceof Request && !["GET", "HEAD"].includes(input.method)) {
    try { const t = await input.clone().text(); return t.length > MAX_BODY_SCAN ? null : t; } catch { return null; }
  }
  return null; // FormData, Blob, streams: files, not text
}

function headerPairs(input: RequestInfo | URL, init: RequestInit | undefined): [string, string][] {
  const h = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((v, k) => h.set(k, v));
  return [...h.entries()];
}

function env(): Record<string, string> {
  try { return Deno.env.toObject(); } catch { return {}; }
}

function ownProjectHost(e: Record<string, string>): string | null {
  try { return e.SUPABASE_URL ? new URL(e.SUPABASE_URL).hostname.toLowerCase() : null; } catch { return null; }
}

let cachedSecrets: Secret[] | null = null;
let cachedOwnHost: string | null = null;
function loadSecrets() {
  if (cachedSecrets === null) {
    const e = env();
    cachedSecrets = secretsFrom(e);
    cachedOwnHost = ownProjectHost(e);
    // Once per function instance, so a live log shows the guard is on (how many credentials, never which values).
    console.log(`[outbound-guard] active: ${cachedSecrets.length} credential(s) protected`);
  }
  return { secrets: cachedSecrets, ownHost: cachedOwnHost };
}

/** The guarded fetch: refuses a request that would carry a NazAI credential to a host it does not belong to. */
export function guardFetch(original: typeof fetch, load: () => { secrets: Secret[]; ownHost: string | null } = loadSecrets): typeof fetch {
  return async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    const { secrets, ownHost } = load();
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* not a URL: fetch itself will refuse it */ }
    // NazAI's own project (database, storage, its own functions) is where every credential may go: nothing to read.
    if (secrets.length && host && host !== ownHost) {
      const leak = findLeak({ url, headers: headerPairs(input, init), body: await bodyText(input, init) }, secrets, ownHost);
      if (leak) {
        console.error(`[outbound-guard] refused a request to ${leak.host}: it carried ${leak.name} in its ${leak.where}`);
        throw new OutboundBlocked(`refused: the request to ${leak.host} carried a NazAI credential (${leak.name})`);
      }
    }
    return await original(input, init);
  } as typeof fetch;
}

const INSTALLED = Symbol.for("nazai.outbound-guard");
const g = globalThis as unknown as Record<symbol, boolean> & { fetch: typeof fetch };
if (!g[INSTALLED] && typeof g.fetch === "function") {
  g.fetch = guardFetch(g.fetch.bind(globalThis));
  g[INSTALLED] = true;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Content masking

/** Provider credential formats (the secrets rule's shapes without the plain-JWT alternative). */
export const CREDENTIAL_SHAPES = new RegExp(
  SECRET_SHAPES.source.replace(/\|eyJ\[A-Za-z0-9_-\]\{10,\}\\\.\[A-Za-z0-9_-\]\{10,\}\(\\\.\[A-Za-z0-9_-\]\{5,\}\)\?\)$/, ")"),
  "g",
);

const MIN_EXTRA_CHARS = 8;
const DATA_URL = /^data:[\w.+-]+\/[\w.+-]+(;[\w=.+-]+)*;base64,/i;

/** Text with every provider credential, NazAI credential and given extra secret (e.g. the tool's own key) replaced. */
export function maskOutboundText(text: string, extra: (string | null | undefined)[] = [], secrets: Secret[] = loadSecrets().secrets): { text: string; masked: number } {
  if (!text) return { text, masked: 0 };
  let masked = 0;
  let out = text.replace(CREDENTIAL_SHAPES, () => { masked++; return REDACTED; });
  const values = [...secrets.map((s) => s.value), ...extra.filter((v): v is string => typeof v === "string" && v.length >= MIN_EXTRA_CHARS)]
    .sort((a, b) => b.length - a.length);
  for (const v of values) {
    if (!out.includes(v)) continue;
    const parts = out.split(v);
    masked += parts.length - 1;
    out = parts.join(REDACTED);
  }
  return { text: out, masked };
}

/** A copy of a value with every string masked as maskOutboundText does; keys and non-strings are kept. */
export function maskOutbound<T>(value: T, extra: (string | null | undefined)[] = [], secrets: Secret[] = loadSecrets().secrets): { value: T; masked: number } {
  let masked = 0;
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") {
      if (DATA_URL.test(v)) return v; // an embedded file (base64), not text: masking could only corrupt it
      const r = maskOutboundText(v, extra, secrets); masked += r.masked; return r.text;
    }
    if (depth > 30 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v instanceof Date || v instanceof Uint8Array || v instanceof ArrayBuffer) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, depth + 1);
    return out;
  };
  return { value: walk(value, 0) as T, masked };
}

/** JSON.stringify of the masked value: a drop-in for request bodies that leave NazAI. */
export function maskedJson(value: unknown, extra: (string | null | undefined)[] = []): string {
  return JSON.stringify(maskOutbound(value, extra).value);
}

/** What came back from outside, before it is stored or shown: the same masking. */
export const scrubInbound = maskOutboundText;

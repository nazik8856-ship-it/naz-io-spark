// Run with: deno test --allow-env supabase/functions/_shared/url-safety-fetch_test.ts
// Data encryption, front 1: a page fetched from a typed-in address goes over https only, and no redirect can take it to plain http
// or to an internal address.
import { fetchPublicHttps, type UrlSafetyResult } from "./url-safety.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
async function rejects(p: Promise<unknown>, text: string) {
  try { await p; } catch (e) { if (!(e as Error).message.includes(text)) throw new Error(`expected "${text}" in ${(e as Error).message}`); return; }
  throw new Error(`expected a rejection with "${text}"`);
}

/** Answers per URL; records what was requested and with which redirect mode. */
function site(pages: Record<string, { status: number; location?: string; body?: string }>) {
  const calls: { url: string; redirect: string | undefined }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, redirect: init.redirect });
    const p = pages[url] ?? { status: 404 };
    return new Response(p.body ?? "", { status: p.status, headers: p.location ? { location: p.location } : {} });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
// The real check without DNS: https only, and "internal.test" stands for an address that resolves to a private IP.
const validate = async (url: string): Promise<UrlSafetyResult> => {
  const u = new URL(url);
  if (u.protocol !== "https:") return { ok: false, reason: "only https is allowed" };
  if (u.hostname === "internal.test") return { ok: false, reason: "resolved to private/loopback ip 10.0.0.1" };
  return { ok: true, reason: "" };
};

Deno.test("http:// and bare host names are fetched over https", async () => {
  const s = site({ "https://acme.test/": { status: 200, body: "hi" }, "https://acme.test/about": { status: 200 } });
  assertEquals(await (await fetchPublicHttps("http://acme.test/", {}, { ...s, validate })).text(), "hi");
  await fetchPublicHttps("acme.test/about", {}, { ...s, validate });
  assertEquals(s.calls.map((c) => c.url), ["https://acme.test/", "https://acme.test/about"]);
  assertEquals(s.calls.every((c) => c.redirect === "manual"), true, "redirects are never followed automatically");
});

Deno.test("redirects are followed by hand, each hop checked: https ones work, one to http or an internal address is refused", async () => {
  const ok = site({ "https://acme.test/": { status: 301, location: "/home" }, "https://acme.test/home": { status: 200, body: "home" } });
  assertEquals(await (await fetchPublicHttps("https://acme.test/", {}, { ...ok, validate })).text(), "home");
  const toHttp = site({ "https://acme.test/": { status: 308, location: "http://acme.test/plain" } });
  await rejects(fetchPublicHttps("https://acme.test/", {}, { ...toHttp, validate }), "only https is allowed");
  assertEquals(toHttp.calls.length, 1, "the plain http address is never requested");
  const toInternal = site({ "https://acme.test/": { status: 302, location: "https://internal.test/admin" } });
  await rejects(fetchPublicHttps("https://acme.test/", {}, { ...toInternal, validate }), "private/loopback");
  const loop = site({ "https://acme.test/a": { status: 302, location: "/b" }, "https://acme.test/b": { status: 302, location: "/a" } });
  await rejects(fetchPublicHttps("https://acme.test/a", {}, { ...loop, validate }), "too many redirects");
});

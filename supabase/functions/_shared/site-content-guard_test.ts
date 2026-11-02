import { EMBED_HOSTS, plainField, safeEmbed, safeLink, safeMedia, sanitizeSectionContent } from "./site-content-guard.ts";
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }

Deno.test("a normal section comes through unchanged", () => {
  const c = { eyebrow: "Crafted", headline: "Meet the ~remarkable~ side", cta_primary: "Get started", cta_primary_href: "contact", cta_secondary_href: "https://calendly.com/x/y",
    asset_url: "https://abc.supabase.co/storage/v1/object/public/a.png", items: [{ title: "One", description: "Two", icon: "star" }], featured: true, n: 3 };
  assertEquals(sanitizeSectionContent(c), c);
});

Deno.test("links: pages, anchors, paths, https, mailto and tel stay; script and data links are emptied", () => {
  for (const ok of ["home", "contact", "pricing/basic", "#about", "/menu", "https://example.com/a?b=c", "mailto:a@b.co", "tel:+4912345"]) assert(safeLink(ok) !== "", ok);
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "//evil.com", "http://example.com", "https://user:pw@example.com", "vbscript:x", "has space", "/\\evil.com", "<a>"]) assertEquals(safeLink(bad), "", bad);
  assertEquals(sanitizeSectionContent({ cta_primary_href: "javascript:alert(1)", cta_primary: "Click" }), { cta_primary_href: "", cta_primary: "Click" });
});

Deno.test("pictures: https or /path only", () => {
  assert(safeMedia("https://a.example/x.png") !== ""); assert(safeMedia("/img/a.png") !== "");
  for (const bad of ["data:image/svg+xml;base64,AAA", "javascript:x", "http://a.example/x.png", "//a.example/x.png", "file:///etc/passwd"]) assertEquals(safeMedia(bad), "", bad);
  assertEquals(sanitizeSectionContent({ items: [{ caption: "c", asset_url: "data:image/png;base64,AA" }] }), { items: [{ caption: "c", asset_url: "" }] });
});

Deno.test("embeds: only hosts made to be embedded", () => {
  assert(safeEmbed("https://www.youtube.com/embed/abc") !== ""); assert(safeEmbed("https://player.vimeo.com/video/1") !== ""); assert(safeEmbed("https://form.typeform.com/to/x") !== "");
  for (const bad of ["https://evil.example/", "http://www.youtube.com/embed/x", "javascript:alert(1)", "https://youtube.com.evil.example/x", "https://evil.example/youtube.com", "https://x@www.youtube.com/"]) assertEquals(safeEmbed(bad), "", bad);
  assert(EMBED_HOSTS.length > 5);
  assertEquals(sanitizeSectionContent({ kind: "embed", embed_url: "https://evil.example/phish" }), { kind: "embed", embed_url: "" });
});

Deno.test("text: HTML and control characters out, long text cut", () => {
  const c = sanitizeSectionContent({ headline: "Hi <script>steal()</script>there<b onclick=x>!</b>\u0000", body: "x".repeat(9000), bullets: ["a‮b", "<img src=x onerror=alert(1)>ok"] });
  assertEquals(c.headline, "Hi there!"); assertEquals((c.body as string).length, 4000); assertEquals(c.bullets, ["ab", "ok"]);
});

Deno.test("shape: lists and objects are bounded; odd kinds and prototype keys are dropped; never throws", () => {
  const huge = { items: Array.from({ length: 500 }, (_, i) => ({ t: String(i) })) };
  assertEquals((sanitizeSectionContent(huge).items as unknown[]).length, 60);
  let deep: unknown = { x: "leaf" }; for (let i = 0; i < 50; i++) deep = { n: deep };
  sanitizeSectionContent(deep);
  const odd = sanitizeSectionContent({ f: () => 1, u: undefined, n: null, nan: NaN, ok: 1, ["__proto__"]: { a: 1 } } as unknown);
  assertEquals(odd, { ok: 1 });
  assertEquals(sanitizeSectionContent("text"), {}); assertEquals(sanitizeSectionContent(null), {}); assertEquals(sanitizeSectionContent([1]), {});
});

Deno.test("plainField", () => { assertEquals(plainField("  My <b>Site</b>\n name ", 20), "My Site name"); assertEquals(plainField(5, 10), ""); assertEquals(plainField("x".repeat(50), 10).length, 10); });

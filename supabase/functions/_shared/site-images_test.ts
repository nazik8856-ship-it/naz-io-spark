// Run with: deno test supabase/functions/_shared/site-images_test.ts
import {
  applyImageToSections,
  buildImagePrompt,
  collectImageSlots,
  extensionForMime,
  heroUsesImage,
  MAX_IMAGES_PER_SITE,
  optimizedImageUrl,
  parseImageResponse,
} from "./site-images.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Replica of the real "La Famiglia" site that showed no images (live, 2026-10-11).
const FAMIGLIA = () => [
  { slug: "home", sections: [
    { type: "hero", variant: "full-bleed", content: { headline: "Experience the ~taste of Italy~." } },
    { type: "about", content: { heading: "Our Story", bullets: ["Family recipes"] } },
    { type: "services", variant: "cards", content: { items: [{ title: "Handmade Pasta" }] } },
    { type: "gallery", variant: "masonry", content: { items: [{ caption: "A taste of Italy" }, { caption: "Family dining" }, { caption: "Our cozy interior" }] } },
  ] },
  { slug: "menu", sections: [{ type: "feature-split", content: { heading: "Discover Our ~Delicious Offerings~" } }] },
];

// ---- slot selection --------------------------------------------------------

Deno.test("heroUsesImage mirrors the renderer: only split-image and full-bleed draw an image", () => {
  assert(heroUsesImage("split-image", undefined) && heroUsesImage("full-bleed", undefined));
  assert(!heroUsesImage("editorial-lede", undefined) && !heroUsesImage("minimal-luxury", undefined) && !heroUsesImage("asymmetric-mark", undefined) && !heroUsesImage("centered", undefined));
  assert(heroUsesImage(undefined, "split") && !heroUsesImage(undefined, "editorial") && !heroUsesImage(undefined, undefined));
});

Deno.test("the real La Famiglia site gets a hero, about, gallery, and menu image even with ZERO image_prompts", () => {
  const slots = collectImageSlots(FAMIGLIA(), { siteName: "La Famiglia Ristorante" });
  assertEquals(slots.map((s) => `${s.pageSlug}:${s.kind}`), [
    "home:hero", "home:about", "menu:feature-split", "home:gallery-item", "home:gallery-item", "home:gallery-item",
  ]);
  assert(slots[0].subject.includes("taste of Italy") && !slots[0].subject.includes("~"));
});

Deno.test("a hero variant that draws no image gets no slot (no wasted generation)", () => {
  const pages = [{ slug: "home", sections: [{ type: "hero", variant: "editorial-lede", content: { headline: "x" } }] }];
  assertEquals(collectImageSlots(pages, { siteName: "S" }), []);
});

Deno.test("USER-SUPPLIED images always win: any slot with an asset_url is skipped", () => {
  const pages = [{ slug: "home", sections: [
    { type: "hero", variant: "full-bleed", content: { headline: "h", asset_url: "https://user.example/mine.jpg" } },
    { type: "about", content: { heading: "a" } },
    { type: "gallery", content: { items: [{ caption: "one", asset_url: "https://user.example/1.jpg" }, { caption: "two" }] } },
  ] }];
  const slots = collectImageSlots(pages, { siteName: "S" });
  assertEquals(slots.map((s) => `${s.kind}:${s.itemIndex}`), ["about:null", "gallery-item:1"]);
});

Deno.test("an existing image_prompt is used as the subject instead of a derived one", () => {
  const pages = [{ slug: "home", sections: [{ type: "about", content: { heading: "Our Story", image_prompt: "rustic sourdough on a wooden board" } }] }];
  assertEquals(collectImageSlots(pages, { siteName: "S" })[0].subject, "rustic sourdough on a wooden board");
});

Deno.test("zigzag services items get slots; card services do not", () => {
  const mk = (variant: string) => [{ slug: "home", sections: [{ type: "services", variant, content: { items: [{ title: "Pasta" }] } }] }];
  assertEquals(collectImageSlots(mk("zigzag"), { siteName: "S" }).length, 1);
  assertEquals(collectImageSlots(mk("cards"), { siteName: "S" }).length, 0);
});

Deno.test("the cap is enforced and the most visible slots survive it", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ caption: `g${i}` }));
  const pages = [{ slug: "home", sections: [
    { type: "gallery", content: { items } },
    { type: "hero", variant: "split-image", content: { headline: "h" } },
    { type: "about", content: { heading: "a" } },
  ] }];
  const slots = collectImageSlots(pages, { siteName: "S" });
  assertEquals(slots.length, MAX_IMAGES_PER_SITE);
  assertEquals([slots[0].kind, slots[1].kind], ["hero", "about"]);
});

Deno.test("a gallery item with no caption and no prompt is skipped", () => {
  const pages = [{ slug: "home", sections: [{ type: "gallery", content: { items: [{}, { caption: "ok" }] } }] }];
  assertEquals(collectImageSlots(pages, { siteName: "S" }).length, 1);
});

Deno.test("contact and legal pages never get images (a live run illustrated privacy-policy and terms)", () => {
  const pages = [
    { slug: "home", sections: [{ type: "about", content: { heading: "a" } }] },
    { slug: "contact", sections: [{ type: "about", content: { heading: "c" } }] },
    { slug: "privacy-policy", sections: [{ type: "about", content: { heading: "p" } }] },
    { slug: "Terms", sections: [{ type: "about", content: { heading: "t" } }] },
  ];
  assertEquals(collectImageSlots(pages, { siteName: "S" }).map((s) => s.pageSlug), ["home"]);
});

Deno.test("optimizedImageUrl routes through the render endpoint with a width per aspect", () => {
  const u = optimizedImageUrl("https://x.supabase.co/", "mission-assets", "website-images/u/w/a.png", "wide");
  assertEquals(u, "https://x.supabase.co/storage/v1/render/image/public/mission-assets/website-images/u/w/a.png?width=1600&quality=78");
  assert(optimizedImageUrl("https://x.supabase.co", "b", "p.png", "square").includes("width=1000"));
});

// ---- prompt ----------------------------------------------------------------

Deno.test("the prompt carries the owner's own context and forbids text in the image", () => {
  const slot = collectImageSlots(FAMIGLIA(), { siteName: "La Famiglia Ristorante" })[0];
  const p = buildImagePrompt(slot, { siteName: "La Famiglia Ristorante", tagline: "Authentic Italian dining with a ~family touch~.", brief: "a family-run Italian restaurant with a wood-fired oven" });
  assert(p.includes("La Famiglia Ristorante") && p.includes("wood-fired oven") && p.includes("Absolutely no text"));
  assert(!p.includes("~") && p.includes("wide landscape"));
});

Deno.test("without a brief the prompt has no empty brief clause", () => {
  const slot = collectImageSlots(FAMIGLIA(), { siteName: "S" })[1];
  const p = buildImagePrompt(slot, { siteName: "S" });
  assert(!p.includes("The owner described") && p.includes("square framing"));
});

// ---- writing a result back -------------------------------------------------

Deno.test("applyImage sets asset_url and stores a derived image_prompt (About needs it to render)", () => {
  const sections = FAMIGLIA()[0].sections;
  const slot = collectImageSlots(FAMIGLIA(), { siteName: "S" })[1];
  const out = applyImageToSections(sections, slot, "https://cdn.example/a.png")!;
  const about = out[1].content as Record<string, unknown>;
  assertEquals([about.asset_url, typeof about.image_prompt, about.media_style], ["https://cdn.example/a.png", "string", "photo"]);
  assert(!("asset_url" in (sections[1].content as object)), "input mutated");
});

Deno.test("applyImage on a gallery item touches only that item", () => {
  const sections = FAMIGLIA()[0].sections;
  const slot = collectImageSlots(FAMIGLIA(), { siteName: "S" }).find((s) => s.kind === "gallery-item" && s.itemIndex === 1)!;
  const out = applyImageToSections(sections, slot, "https://cdn.example/g.png")!;
  const items = (out[3].content as { items: { asset_url?: string }[] }).items;
  assertEquals(items.map((i) => i.asset_url ?? null), [null, "https://cdn.example/g.png", null]);
});

Deno.test("applyImage refuses a stale slot: moved/removed section, wrong type, or an asset_url that arrived meanwhile", () => {
  const sections = FAMIGLIA()[0].sections;
  const about = collectImageSlots(FAMIGLIA(), { siteName: "S" })[1];
  assertEquals(applyImageToSections([], about, "u"), null);
  assertEquals(applyImageToSections([sections[0], sections[2]], about, "u"), null);
  const withUrl = sections.map((s, i) => (i === 1 ? { ...s, content: { ...(s.content as object), asset_url: "https://user/own.jpg" } } : s));
  assertEquals(applyImageToSections(withUrl, about, "u"), null);
  const gal = collectImageSlots(FAMIGLIA(), { siteName: "S" }).find((s) => s.kind === "gallery-item" && s.itemIndex === 2)!;
  assertEquals(applyImageToSections([sections[0], sections[1], sections[2], { type: "gallery", content: { items: [{ caption: "x" }] } }], gal, "u"), null);
});

// ---- provider responses ----------------------------------------------------

Deno.test("parses the Lovable gateway shape (message.images data URL)", () => {
  const r = parseImageResponse({ choices: [{ message: { images: [{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] } }] });
  assertEquals(r, { kind: "base64", mime: "image/png", base64: "QUJD" });
});

Deno.test("parses the OpenAI images shapes (b64_json and url)", () => {
  assertEquals(parseImageResponse({ data: [{ b64_json: "QUJD" }] }), { kind: "base64", mime: "image/png", base64: "QUJD" });
  assertEquals(parseImageResponse({ data: [{ url: "https://cdn.openai/x.png" }] }), { kind: "url", url: "https://cdn.openai/x.png" });
});

Deno.test("anything else (text-only reply, http:// url, empty) parses to null instead of throwing", () => {
  assertEquals(parseImageResponse({ choices: [{ message: { content: "sorry" } }] }), null);
  assertEquals(parseImageResponse({ data: [{ url: "http://insecure/x.png" }] }), null);
  assertEquals(parseImageResponse(null), null);
  assertEquals(parseImageResponse({}), null);
});

Deno.test("extensionForMime", () => {
  assertEquals([extensionForMime("image/jpeg"), extensionForMime("image/webp"), extensionForMime("image/png")], ["jpg", "webp", "png"]);
});

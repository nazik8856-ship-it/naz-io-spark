// Run with: deno test supabase/functions/_shared/generation-fallback_test.ts
import { startersFromOutline } from "./generation-fallback.ts";
import { assessProfessionalFloor, findStructuralIssues, findUngroundedClaims } from "./generation-floor.ts";
import { defaultOutline, STRUCTURE_IDS, type Outline } from "./generation-templates.ts";
import { findStrictIssues } from "./generation-quality.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const meta = { name: "Lisbon Yoga Studio", offering: "thoughtful solutions" };
const theme = { palette: { bg: "#0A1118", surface: "#121E29", text: "#F4F8FB", accent: "#38D6C7", accentSecondary: "#FFCC66" }, font: { heading: "Inter", body: "Inter" }, layout: "asymmetric", motion: "subtle" };
const manifestFor = (outline: Outline) => ({ name: meta.name, theme, pages: startersFromOutline(outline, meta) });

for (const id of STRUCTURE_IDS) {
  Deno.test(`starter pages for "${id}" satisfy that template's own structure rules`, () => {
    const m = manifestFor(defaultOutline(id));
    assertEquals(findStructuralIssues(m, id), [], findStructuralIssues(m, id).join(" | "));
  });
  Deno.test(`starter pages for "${id}" pass the full professional floor in strict mode (wording, links, visuals)`, () => {
    const m = manifestFor(defaultOutline(id));
    // Placeholder-style legal pages are added later by normalize(); the floor here sees the content pages only.
    const issues = assessProfessionalFloor(m, `${meta.name}`, { template: id, strict: true }).issues;
    assertEquals(issues, [], issues.join(" | "));
  });
}

Deno.test("starters invent nothing: no testimonials, no statistics, no digits-as-prices, no contact details", () => {
  for (const id of STRUCTURE_IDS) {
    const m = manifestFor(defaultOutline(id));
    assertEquals(findUngroundedClaims(m.pages, meta.name), []);
    const text = JSON.stringify(m.pages);
    assert(!/\d/.test(text.replace(/image_prompt":"[^"]*"/g, "")), `${id}: contains digits: ${(text.match(/.{20}\d.{20}/) ?? [""])[0]}`);
    assert(!/@|https?:\/\/|\bexample\.com\b/.test(text), `${id}: contains contact-like data`);
  }
});

Deno.test("pricing-focused: home links to the pricing page and tiers carry no invented prices", () => {
  const m = manifestFor(defaultOutline("pricing-focused"));
  const home = m.pages[0];
  assertEquals(home.sections[0].content.cta_primary_href, "pricing");
  const tiers = m.pages.find((p) => p.slug === "pricing")!.sections.find((s) => s.type === "pricing")!.content.tiers as { price: string }[];
  assert(tiers.length >= 3 && tiers.every((t) => t.price === "Ask for a quote"));
});

Deno.test("an approved custom outline is followed exactly (slugs, titles, section order)", () => {
  const outline: Outline = { pages: [
    { slug: "home", title: "Home", sections: [{ type: "hero", variant: "split-image" }, { type: "about" }, { type: "services", variant: "cards" }, { type: "faq" }, { type: "cta" }] },
    { slug: "classes", title: "Classes", sections: [{ type: "feature-split" }, { type: "process" }] },
    { slug: "contact", title: "Contact", sections: [{ type: "contact" }] },
  ] };
  const pages = startersFromOutline(outline, meta);
  assertEquals(pages.map((p) => p.slug), ["home", "classes", "contact"]);
  assertEquals(pages[0].sections.map((s) => s.type), ["hero", "about", "services", "faq", "cta"]);
  assertEquals(pages[1].title, "Classes");
  assertEquals(pages[0].sections[0].content.cta_primary_href, "classes", "the hero opens the first real content page");
});

Deno.test("every button points at a page that exists", () => {
  for (const id of STRUCTURE_IDS) {
    const m = manifestFor(defaultOutline(id));
    const slugs = new Set(m.pages.map((p) => p.slug));
    const hrefs: string[] = [];
    for (const p of m.pages) for (const s of p.sections) {
      for (const [k, v] of Object.entries(s.content)) if (/href$/.test(k) && typeof v === "string") hrefs.push(v);
      for (const t of ((s.content.tiers as { cta_href?: string }[]) ?? [])) if (t.cta_href) hrefs.push(t.cta_href);
    }
    assert(hrefs.length > 0 && hrefs.every((h) => slugs.has(h)), `${id}: unresolved ${hrefs.filter((h) => !slugs.has(h)).join(",")}`);
    assertEquals(findStrictIssues(m as never, meta.name).filter((i) => /points to/.test(i)), []);
  }
});

Deno.test("unknown section types are skipped, not crashed on; seo descriptions are capped", () => {
  const pages = startersFromOutline({ pages: [{ slug: "home", title: "Home", sections: [{ type: "hero" }, { type: "mystery" }] }] }, meta);
  assertEquals(pages[0].sections.map((s) => s.type), ["hero"]);
  assert(pages[0].seo_description.length <= 160);
});

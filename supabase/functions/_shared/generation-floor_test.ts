// Tests for the deterministic quality floor (Generator Quality, 2026-10-11).
// Run with: deno test supabase/functions/_shared/generation-floor_test.ts
import {
  assessProfessionalFloor,
  describeUngroundedClaims,
  findPlaceholderCopy,
  findStructuralIssues,
  findUngroundedClaims,
  repairUngroundedClaims,
  type ManifestLike,
} from "./generation-floor.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const svc = (n: number) => ({ type: "services", content: { items: Array.from({ length: n }, (_, i) => ({ title: `S${i}`, description: "d" })) } });
const completeHome = () => ({
  slug: "home",
  sections: [{ type: "hero", content: { headline: "h" } }, { type: "about", content: { heading: "a" } }, svc(3), { type: "faq", content: { items: [] } }],
});

// Replica of the REAL output of compile-website-manifest for the brief
// "a bakery website" (live run, 2026-10-11): trust_score 100, no notes.
const LIVE_BAKERY = (): ManifestLike => ({
  name: "Sweet Treats Bakery",
  pages: [
    { slug: "home", sections: [
      { type: "hero", content: { headline: "Indulge in ~freshly baked~ goodness." } },
      { type: "about", content: { heading: "Our Story" } },
      svc(3),
      { type: "testimonials", content: { heading: "What Our Customers Say", items: [
        { quote: "The best bakery in town! Every bite is a delight.", author: "Jane Doe" },
        { quote: "Their custom cakes are both beautiful and delicious.", author: "John Smith" },
      ] } },
    ] },
    { slug: "menu", sections: [{ type: "gallery", content: { items: [{ caption: "Chocolate Croissant" }] } }] },
    { slug: "contact", sections: [{ type: "contact", content: { form_fields: ["name", "email", "message"] } }] },
    { slug: "privacy-policy", sections: [{ type: "about", content: { heading: "Privacy Policy" } }] },
    { slug: "terms", sections: [{ type: "about", content: { heading: "Terms of Service" } }] },
  ],
});

// ---- LOOP 1: structural floor ---------------------------------------------

Deno.test("complete home + 2-section secondary page passes", () => {
  const m: ManifestLike = { pages: [completeHome(), { slug: "menu", sections: [{ type: "gallery" }, { type: "cta" }] }] };
  assertEquals(findStructuralIssues(m), []);
});

Deno.test("a one-section non-home page is flagged by slug", () => {
  const m: ManifestLike = { pages: [completeHome(), { slug: "menu", sections: [{ type: "gallery" }] }] };
  const issues = findStructuralIssues(m);
  assertEquals(issues.length, 1);
  assert(issues[0].includes('"menu"'));
});

Deno.test("contact and legal pages are exempt from the 2-section minimum", () => {
  const m: ManifestLike = { pages: [completeHome(),
    { slug: "menu", sections: [{ type: "gallery" }, { type: "cta" }] },
    { slug: "contact", sections: [{ type: "contact" }] },
    { slug: "privacy-policy", sections: [{ type: "about" }] },
    { slug: "terms", sections: [{ type: "about" }] },
    { slug: "Terms-of-Service", sections: [{ type: "about" }] },
  ] };
  assertEquals(findStructuralIssues(m), []);
});

Deno.test("home must start with a hero", () => {
  const home = completeHome();
  home.sections = [home.sections[1], home.sections[0], ...home.sections.slice(2)];
  assert(findStructuralIssues({ pages: [home] }).some((i) => i.includes("must start with a")));
});

Deno.test("home missing about/services/extra is flagged for each gap", () => {
  const issues = findStructuralIssues({ pages: [{ slug: "home", sections: [{ type: "hero" }] }, { slug: "menu", sections: [{ type: "gallery" }, { type: "cta" }] }] });
  assertEquals(issues.length, 3);
});

Deno.test("home + contact + legal only (no real second content page) is flagged", () => {
  const m: ManifestLike = { pages: [completeHome(),
    { slug: "contact", sections: [{ type: "contact" }] },
    { slug: "privacy-policy", sections: [{ type: "about" }] },
    { slug: "terms", sections: [{ type: "about" }] },
  ] };
  const issues = findStructuralIssues(m);
  assertEquals(issues.length, 1);
  assert(issues[0].includes("content page"));
});

Deno.test("contact and legal pages never count toward the content-page minimum", () => {
  const m: ManifestLike = { pages: [completeHome(), { slug: "Contact", sections: [{ type: "contact" }] }, { slug: "tos", sections: [{ type: "about" }] }] };
  assert(findStructuralIssues(m).some((i) => i.includes("only 1 content page")));
});

Deno.test("home + one real 2-section page is the minimum that passes", () => {
  const m: ManifestLike = { pages: [completeHome(), { slug: "about", sections: [{ type: "about" }, { type: "process" }] }] };
  assertEquals(findStructuralIssues(m), []);
});

// ---- LOOP 4: invented testimonials / stats ---------------------------------

Deno.test("testimonials from people absent from the brief are flagged", () => {
  const claims = findUngroundedClaims(LIVE_BAKERY().pages, "a bakery website");
  assertEquals(claims.filter((c) => c.kind === "testimonial").map((c) => c.value), ["Jane Doe", "John Smith"]);
});

Deno.test("a testimonial whose author the brief names is grounded", () => {
  const claims = findUngroundedClaims(LIVE_BAKERY().pages, "bakery. Testimonial from Jane Doe: loved it. John Smith too.");
  assertEquals(claims, []);
});

Deno.test("an unattributed testimonial is never grounded", () => {
  const pages = [{ slug: "home", sections: [{ type: "testimonials", content: { items: [{ quote: "great" }] } }] }];
  assertEquals(findUngroundedClaims(pages, "anything")[0].value, "(unattributed)");
});

Deno.test("stats: invented figures flagged, brief-supplied and ordinal ones are not", () => {
  const pages = [{ slug: "home", sections: [
    { type: "stats", content: { items: [{ value: "500+", label: "x" }, { value: "01", label: "y" }, { value: "12", label: "z" }, { value: "24/7", label: "q" }] } },
  ] }];
  const claims = findUngroundedClaims(pages, "we have been baking for 12 years");
  assertEquals(claims.map((c) => c.value), ["500+", "24/7"]);
});

Deno.test("stats without digits (words) are not a numeric claim", () => {
  const pages = [{ slug: "home", sections: [{ type: "stats", content: { items: [{ value: "Daily", label: "x" }] } }] }];
  assertEquals(findUngroundedClaims(pages, "x"), []);
});

Deno.test("hero.content.stats is checked too", () => {
  const pages = [{ slug: "home", sections: [{ type: "hero", content: { stats: [{ value: "99%", label: "happy" }] } }] }];
  assertEquals(findUngroundedClaims(pages, "x").length, 1);
});

Deno.test("comma-formatted numbers compare equal (1,000 vs 1000)", () => {
  const pages = [{ slug: "home", sections: [{ type: "stats", content: { items: [{ value: "1,000", label: "x" }] } }] }];
  assertEquals(findUngroundedClaims(pages, "over 1000 orders"), []);
});

Deno.test("repair removes ungrounded testimonials section entirely and never mutates input", () => {
  const m = LIVE_BAKERY();
  const before = JSON.stringify(m);
  const r = repairUngroundedClaims(m, "a bakery website");
  assertEquals(JSON.stringify(m), before, "input mutated");
  assert(!r.manifest.pages[0].sections.some((s) => s.type === "testimonials"));
  assertEquals(r.manifest.pages[0].sections.length, 3);
  assert(r.notes.some((n) => n.includes("2 customer testimonial")));
  assertEquals(findUngroundedClaims(r.manifest.pages, "a bakery website"), []);
});

Deno.test("repair keeps grounded items and drops only the invented ones", () => {
  const m = LIVE_BAKERY();
  const r = repairUngroundedClaims(m, "Testimonial from Jane Doe");
  const t = r.manifest.pages[0].sections.find((s) => s.type === "testimonials");
  assertEquals((t!.content as { items: { author: string }[] }).items.map((i) => i.author), ["Jane Doe"]);
});

Deno.test("repair strips ungrounded hero stats key and stats items, keeps the rest", () => {
  const m: ManifestLike = { pages: [{ slug: "home", sections: [
    { type: "hero", content: { headline: "h", stats: [{ value: "99%", label: "x" }] } },
    { type: "stats", content: { items: [{ value: "99%", label: "x" }, { value: "01", label: "ord" }] } },
  ] }] };
  const r = repairUngroundedClaims(m, "nothing numeric");
  const hero = r.manifest.pages[0].sections[0].content as Record<string, unknown>;
  assert(!("stats" in hero) && hero.headline === "h");
  assertEquals((r.manifest.pages[0].sections[1].content as { items: unknown[] }).items.length, 1);
});

Deno.test("repair drops a non-home page left empty, never the home page", () => {
  const m: ManifestLike = { pages: [
    { slug: "home", sections: [{ type: "testimonials", content: { items: [{ quote: "q", author: "Nobody Real" }] } }] },
    { slug: "reviews", sections: [{ type: "testimonials", content: { items: [{ quote: "q", author: "Nobody Real" }] } }] },
  ] };
  const r = repairUngroundedClaims(m, "x");
  assertEquals(r.manifest.pages.map((p) => p.slug), ["home"]);
});

Deno.test("repair is a no-op (same reference, no notes) when nothing is ungrounded", () => {
  const m: ManifestLike = { pages: [completeHome()] };
  const r = repairUngroundedClaims(m, "x");
  assert(r.manifest === m && r.notes.length === 0);
});

Deno.test("describeUngroundedClaims names every offender in one issue per kind", () => {
  const issues = describeUngroundedClaims(findUngroundedClaims(LIVE_BAKERY().pages, "x"));
  assertEquals(issues.length, 1);
  assert(issues[0].includes("Jane Doe") && issues[0].includes("John Smith"));
});

// ---- Placeholder copy -------------------------------------------------------

Deno.test("placeholder copy is detected; ordinary copy is not", () => {
  assertEquals(findPlaceholderCopy({ pages: [{ slug: "home", sections: [{ type: "hero", content: { headline: "Lorem ipsum dolor" } }] }] }).length, 1);
  assertEquals(findPlaceholderCopy({ pages: [{ slug: "home", sections: [{ type: "hero", content: { headline: "Coming soon: our spring menu" } }] }] }).length, 1);
  assertEquals(findPlaceholderCopy({ pages: [{ slug: "home", sections: [{ type: "hero", content: { headline: "Fresh sourdough daily" } }] }] }), []);
});

// ---- LOOP 5: the floor, end to end on the real live output -----------------

Deno.test("the real live bakery output FAILS the floor with both known defects named", () => {
  const f = assessProfessionalFloor(LIVE_BAKERY(), "a bakery website");
  assert(!f.pass);
  assert(f.issues.some((i) => i.includes("Jane Doe")), "fabricated testimonial must be named");
  assert(f.issues.some((i) => i.includes('"menu"')), "thin menu page must be named");
});

Deno.test("after repair, the only remaining defects are structural (nothing invented survives)", () => {
  const repaired = repairUngroundedClaims(LIVE_BAKERY(), "a bakery website").manifest;
  const f = assessProfessionalFloor(repaired, "a bakery website");
  assertEquals(findUngroundedClaims(repaired.pages, "a bakery website"), []);
  assert(f.issues.every((i) => !i.includes("Jane Doe") && !i.includes("John Smith")));
  assert(f.issues.some((i) => i.includes('"menu"')));
});

Deno.test("a manifest with no real name fails the floor", () => {
  const m: ManifestLike = { name: "Untitled Site", pages: [completeHome()] };
  assert(assessProfessionalFloor(m, "x").issues.some((i) => i.includes("no real name")));
});

Deno.test("a complete, grounded manifest passes the floor", () => {
  const m: ManifestLike = { name: "Acme", pages: [completeHome(), { slug: "menu", sections: [{ type: "gallery" }, { type: "cta" }] }] };
  const f = assessProfessionalFloor(m, "Acme");
  assert(f.pass && f.issues.length === 0, JSON.stringify(f.issues));
});

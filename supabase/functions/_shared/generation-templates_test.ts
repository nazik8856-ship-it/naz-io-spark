// Run with: deno test supabase/functions/_shared/generation-templates_test.ts
import {
  defaultOutline,
  findOutlineConformanceIssues,
  findOutlineTemplateIssues,
  findTemplateIssues,
  isStructureId,
  outlinePromptBlock,
  sanitizeOutline,
  STRUCTURE_IDS,
  structurePromptBlock,
  type StructureId,
} from "./generation-templates.ts";
import { assessProfessionalFloor, findStructuralIssues } from "./generation-floor.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const items = (n: number, key = "title") => Array.from({ length: n }, (_, i) => ({ [key]: `Item ${i}`, description: "d" }));
const sec = (type: string, content: Record<string, unknown> = { heading: "H" }, variant?: string) => ({ type, variant, content });
const contact = { slug: "contact", title: "Contact", sections: [sec("contact", { heading: "c", form_fields: ["name"] })] };

// One complete manifest per template.
const SIMPLE = () => ({ pages: [
  { slug: "home", title: "Home", sections: [sec("hero", { headline: "h" }, "split-image"), sec("about"), sec("services", { heading: "s", items: items(3) }), sec("faq", { heading: "f", items: [] }), sec("process"), sec("cta", { headline: "go" })] },
  contact,
] });
const FULL = () => ({ pages: [
  { slug: "home", title: "Home", sections: [sec("hero", { headline: "h" }), sec("about"), sec("services", { heading: "s", items: items(3) }), sec("gallery"), sec("cta", { headline: "go" })] },
  { slug: "about", title: "About", sections: [sec("about"), sec("process")] },
  { slug: "menu", title: "Menu", sections: [sec("services", { heading: "s", items: items(4) }), sec("faq")] },
  contact,
] });
const PRICING = () => ({ pages: [
  { slug: "home", title: "Home", sections: [sec("hero", { headline: "h", cta_primary: "See plans", cta_primary_href: "pricing" }), sec("feature-split"), sec("services", { heading: "s", items: items(3) }), sec("faq"), sec("cta", { headline: "go", cta_primary_href: "pricing" })] },
  { slug: "pricing", title: "Pricing", sections: [sec("pricing", { heading: "p", tiers: items(3, "name") }), sec("faq"), sec("cta", { headline: "x" })] },
  contact,
] });
const AGENCY = () => ({ pages: [
  { slug: "home", title: "Home", sections: [sec("hero", { headline: "h" }, "full-bleed"), sec("about"), sec("services", { heading: "s", items: items(3) }, "zigzag"), sec("gallery", { heading: "g", items: items(3, "caption") }, "showcase"), sec("cta", { headline: "go" })] },
  { slug: "work", title: "Work", sections: [sec("gallery", { heading: "g", items: items(4, "caption") }, "showcase"), sec("feature-split")] },
  { slug: "services", title: "Services", sections: [sec("services", { heading: "s", items: items(3) }, "zigzag"), sec("process")] },
  contact,
] });
const BUILDERS: Record<StructureId, () => { pages: any[] }> = { "simple-landing": SIMPLE, "full-business": FULL, "pricing-focused": PRICING, agency: AGENCY };

Deno.test("isStructureId accepts exactly the four ids", () => {
  assertEquals([...STRUCTURE_IDS], ["simple-landing", "full-business", "pricing-focused", "agency"]);
  assert(isStructureId("agency") && !isStructureId("blog") && !isStructureId(undefined) && !isStructureId(3));
});

Deno.test("a complete manifest for each template has zero template issues", () => {
  for (const id of STRUCTURE_IDS) assertEquals(findTemplateIssues(BUILDERS[id](), id), [], id);
});

Deno.test("each template's default outline satisfies its own rules", () => {
  for (const id of STRUCTURE_IDS) assertEquals(findOutlineTemplateIssues(defaultOutline(id), id), [], id);
});

Deno.test("simple-landing: an extra content page is rejected (it is one page by definition)", () => {
  const m = SIMPLE();
  m.pages.splice(1, 0, { slug: "about", title: "About", sections: [sec("about"), sec("faq")] });
  const issues = findTemplateIssues(m, "simple-landing");
  assert(issues.some((i) => /allows at most 1/.test(i) && i.includes('"about"')), issues.join("|"));
});

Deno.test("simple-landing: home must end with a cta and stay within 6-9 sections", () => {
  const m = SIMPLE();
  m.pages[0].sections.pop();
  assert(findTemplateIssues(m, "simple-landing").some((i) => /must end with a "cta"/.test(i)));
  const short = SIMPLE();
  short.pages[0].sections = short.pages[0].sections.slice(0, 3);
  assert(findTemplateIssues(short, "simple-landing").some((i) => /needs at least 6/.test(i)));
  const long = SIMPLE();
  for (let i = 0; i < 4; i++) long.pages[0].sections.splice(1, 0, sec("gallery"));
  assert(findTemplateIssues(long, "simple-landing").some((i) => /at most 9/.test(i)));
});

Deno.test("full-business: needs 3 content pages including an about page and an offering page", () => {
  const m = FULL();
  m.pages = m.pages.filter((p) => p.slug !== "menu");
  const issues = findTemplateIssues(m, "full-business");
  assert(issues.some((i) => /has 2 content page/.test(i)), issues.join("|"));
  assert(issues.some((i) => /services \/ menu \/ offering page is required/.test(i)), issues.join("|"));
});

Deno.test("full-business: slug aliases count (our-story satisfies the about requirement)", () => {
  const m = FULL();
  m.pages[1].slug = "our-story";
  assertEquals(findTemplateIssues(m, "full-business"), []);
});

Deno.test("pricing-focused: pricing page needs 3+ plans, a faq, and a home link to it", () => {
  const few = PRICING();
  few.pages[1].sections[0] = sec("pricing", { heading: "p", tiers: items(2, "name") });
  assert(findTemplateIssues(few, "pricing-focused").some((i) => /has 2 plan/.test(i)));

  const nofaq = PRICING();
  nofaq.pages[1].sections = [nofaq.pages[1].sections[0], sec("cta", { headline: "x" }), sec("cta", { headline: "y" })];
  assert(findTemplateIssues(nofaq, "pricing-focused").some((i) => /"faq" section/.test(i)));

  const nolink = PRICING();
  (nolink.pages[0].sections[0].content as any).cta_primary_href = "contact";
  (nolink.pages[0].sections[4].content as any).cta_primary_href = "contact";
  assert(findTemplateIssues(nolink, "pricing-focused").some((i) => /must link to the "pricing" page/.test(i)));

  const nopage = PRICING();
  nopage.pages = nopage.pages.filter((p) => p.slug !== "pricing");
  assert(findTemplateIssues(nopage, "pricing-focused").some((i) => /pricing page is required/.test(i)));
});

Deno.test("agency: hero variant, work page gallery, zigzag services, and a process section are enforced", () => {
  const centered = AGENCY();
  centered.pages[0].sections[0].variant = "centered";
  assert(findTemplateIssues(centered, "agency").some((i) => /home hero must use one of/.test(i)));

  const thin = AGENCY();
  thin.pages[1].sections[0] = sec("gallery", { heading: "g", items: items(2, "caption") }, "showcase");
  assert(findTemplateIssues(thin, "agency").some((i) => /at least 3 projects/.test(i)));

  const cards = AGENCY();
  cards.pages[2].sections[0].variant = "cards";
  assert(findTemplateIssues(cards, "agency").some((i) => /zigzag" or "numbered"/.test(i)));

  const noProcess = AGENCY();
  noProcess.pages[2].sections = [noProcess.pages[2].sections[0], sec("faq")];
  assert(findTemplateIssues(noProcess, "agency").some((i) => /"process" section somewhere/.test(i)));
});

Deno.test("legal and contact pages never count as content pages", () => {
  const m = SIMPLE();
  m.pages.push({ slug: "privacy-policy", title: "Privacy", sections: [sec("about")] }, { slug: "terms", title: "Terms", sections: [sec("about")] });
  assertEquals(findTemplateIssues(m, "simple-landing"), []);
});

Deno.test("the floor uses the template's rules instead of the generic ones when a template is given", () => {
  // A complete one-page landing fails the generic floor (needs 2 content pages) but passes with its template.
  const m = SIMPLE();
  assert(findStructuralIssues(m).some((i) => /content page/.test(i)), "generic floor should flag a 1-page site");
  assertEquals(findStructuralIssues(m, "simple-landing"), []);
  assert(assessProfessionalFloor(m, "a landing page", { template: "simple-landing" }).pass);
  assert(!assessProfessionalFloor(m, "a landing page").pass);
});

Deno.test("the floor still enforces thin non-home pages under a template", () => {
  const m = FULL();
  m.pages[1].sections = [sec("about")];
  assert(findStructuralIssues(m, "full-business").some((i) => /"about" page has only 1 section/.test(i)));
});

Deno.test("floor with no options behaves exactly as before (default path unchanged)", () => {
  const issues = findStructuralIssues({ pages: [{ slug: "home", sections: [sec("hero"), sec("about")] }] } as any);
  assert(issues.length >= 3);
});

Deno.test("structurePromptBlock states the page limits and the template's required pages", () => {
  const p = structurePromptBlock("pricing-focused");
  assert(p.includes("Pricing-focused") && p.includes("pricing") && /2 to 4/.test(p) && /link/.test(p));
  assert(structurePromptBlock("simple-landing").includes("exactly 1"));
  assert(structurePromptBlock("agency").includes("Never invent client names"));
});

Deno.test("sanitizeOutline: unknown types dropped, home forced first with a hero, contact appended, slugs unique", () => {
  const out = sanitizeOutline({ pages: [
    { slug: "Welcome Page", title: "Welcome", sections: [{ type: "about" }, { type: "bogus" }] },
    { slug: "menu", title: "Menu", sections: [{ type: "services" }] },
    { slug: "menu", title: "Menu 2", sections: [{ type: "faq" }] },
  ] })!;
  assertEquals(out.pages.map((p) => p.slug), ["home", "menu", "menu-2", "contact"]);
  assertEquals(out.pages[0].sections.map((s) => s.type), ["hero", "about"]);
});

Deno.test("sanitizeOutline: garbage in -> null (caller falls back to the template default)", () => {
  assertEquals(sanitizeOutline(null), null);
  assertEquals(sanitizeOutline({ pages: [] }), null);
  assertEquals(sanitizeOutline({ pages: [{ title: "x", sections: [{ type: "bogus" }] }] }), null);
});

Deno.test("outline conformance: missing page, wrong section order, and extra page are all reported", () => {
  const outline = defaultOutline("full-business");
  const exact = {
    pages: outline.pages.map((p) => ({ slug: p.slug, title: p.title, sections: p.sections.map((s) => sec(s.type)) })),
  };
  assertEquals(findOutlineConformanceIssues(exact, outline), []);

  const missing = { pages: exact.pages.filter((p) => p.slug !== "about") };
  assert(findOutlineConformanceIssues(missing, outline).some((i) => /"about" page that is missing/.test(i)));

  const reordered = JSON.parse(JSON.stringify(exact));
  reordered.pages[0].sections.reverse();
  assert(findOutlineConformanceIssues(reordered, outline).some((i) => /"home" page must have exactly these sections/.test(i)));

  const extra = JSON.parse(JSON.stringify(exact));
  extra.pages.push({ slug: "blog", title: "Blog", sections: [sec("about")] });
  assert(findOutlineConformanceIssues(extra, outline).some((i) => /"blog" page that is not in the approved outline/.test(i)));

  const legal = JSON.parse(JSON.stringify(exact));
  legal.pages.push({ slug: "privacy-policy", title: "Privacy", sections: [sec("about")] });
  assertEquals(findOutlineConformanceIssues(legal, outline), [], "auto-injected legal pages are not 'extra'");
});

Deno.test("an outline the user edits into a rule violation is caught before content is generated", () => {
  const outline = defaultOutline("pricing-focused");
  outline.pages = outline.pages.filter((p) => p.slug !== "pricing");
  assert(findOutlineTemplateIssues(outline, "pricing-focused").some((i) => /pricing page is required/.test(i)));
});

Deno.test("outlinePromptBlock lists every page and section in order", () => {
  const p = outlinePromptBlock(defaultOutline("simple-landing"));
  assert(p.includes("home") && p.includes("hero[split-image] → about") && p.includes("contact"));
});

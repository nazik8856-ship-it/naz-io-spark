// Run with: deno test supabase/functions/_shared/generation-edit-gate_test.ts
import { gateEdit, introducedIssues, issueKey, newImageSlotCount } from "./generation-edit-gate.ts";
import { contrastRatio, MIN_TEXT_CONTRAST } from "./generation-quality.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const sec = (type: string, content: Record<string, unknown> = { heading: "H" }, variant?: string) => ({ type, variant, content });
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Item ${i + 1}`, body: `Real detail ${i + 1}` }));
const base = () => ({
  name: "Ember Coffee",
  theme: {
    palette: { bg: "#0B0B0F", surface: "#151520", text: "#F4F4F5", accent: "#E8834A", accentSecondary: "#1B7A72" },
    font: { heading: "Fraunces", body: "Inter" }, layout: "asymmetric", motion: "subtle",
  } as Record<string, any>,
  pages: [
    { slug: "home", title: "Home", sections: [
      sec("hero", { headline: "Coffee roasted for the obsessed", cta_primary: "See menu", cta_primary_href: "menu", image_prompt: "a roaster at work" }, "split-image"),
      sec("about", { heading: "Our story" }),
      sec("services", { heading: "What we serve", items: items(3) }),
      sec("faq", { heading: "Questions" }),
      sec("cta", { headline: "Visit us", cta_primary: "Contact", cta_primary_href: "contact" }),
    ] },
    { slug: "menu", title: "Menu", sections: [sec("services", { heading: "Menu", items: items(3) }), sec("faq", { heading: "More questions" })] },
    { slug: "about", title: "About", sections: [sec("about", { heading: "Who we are" }), sec("process", { heading: "How we roast" })] },
    { slug: "gallery", title: "Gallery", sections: [sec("gallery", { heading: "Gallery" }), sec("cta", { headline: "Come in", cta_primary: "Contact", cta_primary_href: "contact" })] },
    { slug: "contact", title: "Contact", sections: [sec("contact", { heading: "Contact" })] },
  ],
});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx = { siteName: "Ember Coffee", layout: "asymmetric" };

Deno.test("issueKey ignores digits and spacing; introducedIssues reports only new problems", () => {
  assertEquals(issueKey('The "home" page has 2 services'), issueKey('The "home" page has 3  services'));
  const before = ["The site has only 2 content page(s)", "A"];
  const after = ["The site has only 3 content page(s)", "A", "B"];
  assertEquals(introducedIssues(before, after), ["B"]);
});

Deno.test("newImageSlotCount: a copy-only edit starts no image run", () => {
  const before = base();
  const after = clone(before);
  after.pages[0].sections[0].content.headline = "New headline";
  assertEquals(newImageSlotCount(before.pages, after.pages, ctx), 0);
});

Deno.test("newImageSlotCount: new gallery items needing pictures are counted", () => {
  const before = base();
  const after = clone(before);
  after.pages[3].sections[0].content.items = [{ caption: "Beans", image_prompt: "roasted beans" }, { caption: "Cup", image_prompt: "a flat white" }];
  assertEquals(newImageSlotCount(before.pages, after.pages, ctx), 2);
});

Deno.test("newImageSlotCount: slots that were already unfilled before the edit do not count, filled ones never do", () => {
  const before = base();
  before.pages[3].sections[0].content.items = [{ caption: "Beans", image_prompt: "roasted beans" }, { caption: "Cup", asset_url: "https://x.test/cup.png" }];
  const after = clone(before);
  after.pages[0].sections[1].content.heading = "Our new story"; // copy only
  assertEquals(newImageSlotCount(before.pages, after.pages, ctx), 0);
});

Deno.test("gateEdit: a clean edit changes nothing and says nothing", () => {
  const before = base();
  const after = clone(before);
  after.pages[0].sections[1].content.heading = "Our story, rewritten";
  const r = gateEdit({ before, after, brief: "a coffee roaster", prompt: "rewrite the heading", strict: false });
  assertEquals(r.notes, []);
  assertEquals(r.manifest, after);
  assertEquals([r.visualFixes, r.claimsRemoved], [0, 0]);
});

Deno.test("gateEdit: an edit that breaks contrast is repaired mechanically and reported; input untouched", () => {
  const before = base();
  const after = clone(before);
  after.theme.palette.text = "#2a2a33"; // "make the text darker" on a near-black background
  const r = gateEdit({ before, after, brief: "a coffee roaster", prompt: "make the text darker", strict: false });
  assert(contrastRatio(r.manifest.theme.palette.text, r.manifest.theme.palette.bg) >= MIN_TEXT_CONTRAST);
  assert(r.notes.some((n) => n.startsWith("Visual fix: ")), r.notes.join("|"));
  assert(r.visualFixes >= 1);
  assertEquals(after.theme.palette.text, "#2a2a33", "input not mutated");
});

Deno.test("gateEdit: testimonials THIS edit invented are removed; ones already on the site stay", () => {
  const before = base();
  before.pages[0].sections.splice(3, 0, sec("testimonials", { heading: "Kind words", items: [{ quote: "Great beans", author: "Maria Silva", role: "Regular" }] }));
  const after = clone(before);
  after.pages[0].sections.push(sec("testimonials", { heading: "More words", items: [{ quote: "Best coffee ever", author: "John Smith", role: "Customer" }] }));
  const r = gateEdit({ before, after, brief: "a coffee roaster", prompt: "add another testimonials section", strict: false });
  const text = JSON.stringify(r.manifest.pages);
  assert(!text.includes("John Smith"), "invented testimonial removed");
  assert(text.includes("Maria Silva"), "pre-existing testimonial untouched");
  assertEquals(r.claimsRemoved, 1);
  assert(r.notes.some((n) => n.startsWith("Relevance Guard: ")), r.notes.join("|"));
});

Deno.test("gateEdit: a testimonial the user typed into the edit request is grounded and kept", () => {
  const before = base();
  const after = clone(before);
  after.pages[0].sections.push(sec("testimonials", { heading: "Kind words", items: [{ quote: "Lovely", author: "Ana Costa", role: "Customer" }] }));
  const r = gateEdit({ before, after, brief: "a coffee roaster", prompt: "add a testimonial from Ana Costa saying Lovely", strict: false });
  assert(JSON.stringify(r.manifest.pages).includes("Ana Costa"));
  assertEquals(r.claimsRemoved, 0);
});

Deno.test("gateEdit: strict issues are only reported in strict mode, and only the ones the edit introduced", () => {
  const before = base();
  before.pages[1].sections[0].content.heading = "The ultimate menu"; // pre-existing hype
  const after = clone(before);
  after.pages[0].sections[0].content.headline = "A revolutionary coffee experience!";
  const off = gateEdit({ before, after, brief: "a coffee roaster", prompt: "punchier headline", strict: false });
  assertEquals(off.strictIssues, []);
  const on = gateEdit({ before, after, brief: "a coffee roaster", prompt: "punchier headline", strict: true });
  const txt = on.strictIssues.join("\n");
  assert(/revolutionary/.test(txt) && /exclamation/.test(txt), txt);
  assert(!/ultimate/.test(txt), "the hype that was already there is not blamed on this edit");
});

Deno.test("gateEdit: structure problems the edit introduced are reported but never forced back", () => {
  const before = base();
  const after = clone(before);
  after.pages[0].sections.reverse(); // home no longer starts with a hero
  const r = gateEdit({ before, after, brief: "a coffee roaster", prompt: "move the call to action to the top", strict: false });
  assert(r.structureIssues.some((i) => /must start with a "hero"/.test(i)), r.structureIssues.join("|"));
  assertEquals(r.manifest.pages[0].sections.map((s) => s.type), after.pages[0].sections.map((s) => s.type), "the user's reorder is kept");
});

Deno.test("gateEdit: pre-existing structure problems are not blamed on the edit", () => {
  const before = base();
  before.pages[3].sections = [sec("gallery", { heading: "Gallery" })]; // thin page already there
  const after = clone(before);
  after.pages[0].sections[1].content.heading = "Another heading";
  const r = gateEdit({ before, after, brief: "a coffee roaster", prompt: "tweak heading", strict: false });
  assertEquals(r.structureIssues, []);
});

Deno.test("gateEdit: removing a template page on purpose is advisory, never undone", () => {
  const before = base();
  before.pages.splice(1, 0, { slug: "pricing", title: "Pricing", sections: [sec("pricing", { heading: "Plans", tiers: [{ name: "A" }, { name: "B" }, { name: "C" }] }), sec("faq", { heading: "FAQ" })] });
  const after = clone(before);
  after.pages = after.pages.filter((p) => p.slug !== "pricing");
  const r = gateEdit({ before, after, brief: "a coffee roaster", prompt: "remove the pricing page", strict: false, template: "pricing-focused" });
  assert(r.manifest.pages.every((p) => p.slug !== "pricing"), "the page stays removed");
  assert(r.structureIssues.length > 0, "but the owner is told");
});

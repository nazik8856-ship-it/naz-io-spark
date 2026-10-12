// Run with: deno test supabase/functions/_shared/generation-quality_test.ts
import {
  contrastRatio,
  findStrictIssues,
  findVisualIssues,
  initialChecks,
  MIN_ACCENT_CONTRAST,
  MIN_TEXT_CONTRAST,
  repairVisual,
  setCheck,
  statusFromCounts,
  STRICT_PROMPT_BLOCK,
} from "./generation-quality.ts";
import { assessProfessionalFloor } from "./generation-floor.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const goodTheme = () => ({
  palette: { bg: "#0B0B0F", surface: "#151520", text: "#F4F4F5", accent: "#E8834A", accentSecondary: "#1B7A72" },
  font: { heading: "Fraunces", body: "Inter" },
  layout: "asymmetric",
  motion: "subtle",
});
const sec = (type: string, content: Record<string, unknown> = { heading: "H" }, variant?: string) => ({ type, variant, content });
const goodManifest = () => ({
  name: "Ember Coffee",
  theme: goodTheme(),
  pages: [
    { slug: "home", sections: [sec("hero", { headline: "Coffee roasted for ~the obsessed~", cta_primary: "See menu", cta_primary_href: "menu", image_prompt: "a roaster at work" }, "split-image"), sec("about", { heading: "Our story" }), sec("services", { heading: "What we serve" }), sec("cta", { headline: "Visit us", cta_primary: "Contact", cta_primary_href: "contact" })] },
    { slug: "menu", sections: [sec("services", { heading: "Menu" }), sec("faq", { heading: "Questions" })] },
    { slug: "contact", sections: [sec("contact", { heading: "Contact" })] },
  ],
});

// ---- checks ------------------------------------------------------------------

Deno.test("initialChecks lists the four checks pending, in display order", () => {
  const c = initialChecks();
  assertEquals(c.map((x) => x.id), ["structure", "visual", "images", "claims"]);
  assert(c.every((x) => x.status === "pending"));
  assertEquals(c.map((x) => x.label), ["Structure", "Visual consistency", "Image relevance", "No hallucinations"]);
});

Deno.test("setCheck updates one check immutably", () => {
  const a = initialChecks();
  const b = setCheck(a, "visual", "fixed", "contrast");
  assertEquals(a.find((x) => x.id === "visual")!.status, "pending");
  assertEquals(b.find((x) => x.id === "visual"), { id: "visual", label: "Visual consistency", status: "fixed", detail: "contrast" });
  assertEquals(b.filter((x) => x.status === "pending").length, 3);
});

Deno.test("statusFromCounts: passed / fixed / flagged", () => {
  assertEquals(statusFromCounts(0, 0), "passed");
  assertEquals(statusFromCounts(3, 0), "fixed");
  assertEquals(statusFromCounts(3, 1), "flagged");
  assertEquals(statusFromCounts(0, 2), "flagged");
});

// ---- colour maths ------------------------------------------------------------

Deno.test("contrastRatio matches known WCAG values", () => {
  assert(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
  assert(Math.abs(contrastRatio("#777777", "#ffffff") - 4.48) < 0.05);
  assertEquals(contrastRatio("nope", "#fff"), 0);
  assert(Math.abs(contrastRatio("#fff", "#000") - 21) < 0.01, "3-digit hex");
});

// ---- visual issues + repair --------------------------------------------------

Deno.test("a well-formed theme has no visual issues", () => {
  assertEquals(findVisualIssues(goodManifest()), []);
});

Deno.test("low text contrast, low accent contrast, identical accents, bad layout/motion/hero are all found", () => {
  const m = goodManifest();
  m.theme.palette.text = "#2a2a33";
  m.theme.palette.accent = "#101018";
  m.theme.palette.accentSecondary = "#101018";
  m.theme.layout = "wobbly";
  m.theme.motion = "frantic";
  m.pages[0].sections[0].variant = "spiral";
  const issues = findVisualIssues(m).join("\n");
  for (const re of [/Body text/, /accent colour/, /identical to accent/, /layout "wobbly"/, /motion "frantic"/, /variant "spiral"/]) assert(re.test(issues), `missing ${re}: ${issues}`);
});

Deno.test("repairVisual fixes contrast and accents mechanically and reports each change", () => {
  const m = goodManifest();
  m.theme.palette.text = "#2a2a33";
  m.theme.palette.accent = "#101018";
  m.theme.palette.accentSecondary = "#101018";
  m.theme.layout = "wobbly";
  m.pages[0].sections[0].variant = "spiral";
  const { manifest, notes } = repairVisual(m);
  assert(contrastRatio(manifest.theme!.palette!.text!, manifest.theme!.palette!.bg!) >= MIN_TEXT_CONTRAST);
  assert(contrastRatio(manifest.theme!.palette!.accent!, manifest.theme!.palette!.bg!) >= MIN_ACCENT_CONTRAST);
  assert(manifest.theme!.palette!.accentSecondary!.toLowerCase() !== manifest.theme!.palette!.accent!.toLowerCase());
  assertEquals(manifest.theme!.layout, "asymmetric");
  assertEquals(manifest.pages[0].sections[0].variant, "split-image");
  assert(notes.length >= 4, notes.join("|"));
  assertEquals(findVisualIssues(manifest), [], "repair must leave no mechanical issue behind");
  assertEquals(m.theme.palette.text, "#2a2a33", "input not mutated");
});

Deno.test("repairVisual works on a light background too (moves text DARKER, not lighter)", () => {
  const m = goodManifest();
  m.theme.palette.bg = "#ffffff";
  m.theme.palette.text = "#cfcfd6";
  m.theme.palette.accent = "#ffd9a8";
  const { manifest } = repairVisual(m);
  assert(contrastRatio(manifest.theme!.palette!.text!, "#ffffff") >= MIN_TEXT_CONTRAST);
  assert(contrastRatio(manifest.theme!.palette!.accent!, "#ffffff") >= MIN_ACCENT_CONTRAST);
});

Deno.test("repairVisual replaces invalid colours with safe defaults", () => {
  const m = goodManifest();
  (m.theme.palette as any).bg = "blue";
  const { manifest, notes } = repairVisual(m);
  assertEquals(manifest.theme!.palette!.bg, "#0B0B0F");
  assert(notes.some((n) => /invalid bg/.test(n)));
});

Deno.test("repairVisual on an already-good theme changes nothing and says nothing", () => {
  const m = goodManifest();
  const { manifest, notes } = repairVisual(m);
  assertEquals(notes, []);
  assertEquals(manifest.theme, m.theme);
});

Deno.test("headings missing and three same-type sections in a row are reported (content issues, not auto-repaired)", () => {
  const m = goodManifest();
  m.pages[1].sections = [sec("gallery", {}), sec("gallery", { heading: "b" }), sec("gallery", { heading: "c" })];
  const issues = findVisualIssues(m).join("\n");
  assert(/gallery section #1 on "menu" has no heading/.test(issues), issues);
  assert(/stacks three "gallery"/.test(issues), issues);
});

// ---- strict mode -------------------------------------------------------------

Deno.test("a clean manifest passes strict mode", () => {
  assertEquals(findStrictIssues(goodManifest(), "a coffee shop"), []);
});

Deno.test("strict: hype words, exclamation marks, long hero headline are flagged with their location", () => {
  const m = goodManifest();
  m.pages[0].sections[0].content.headline = "The ultimate world-class coffee experience!";
  m.pages[0].sections[1].content.body = "x".repeat(600);
  m.pages[0].sections[0].content.headline += " " + "word ".repeat(20);
  const issues = findStrictIssues(m, "a coffee shop").join("\n");
  assert(/home\.sections\[0\] \(hero\)\.headline uses the hype phrase "world-class"/.test(issues), issues);
  assert(/exclamation mark/.test(issues), issues);
  assert(/longer than 80 characters/.test(issues), issues);
  assert(/body is longer than 520/.test(issues), issues);
});

Deno.test("strict: unresolved CTA links and button-without-href are flagged; external and anchor links are fine", () => {
  const m = goodManifest();
  m.pages[0].sections[0].content.cta_primary_href = "nowhere";
  m.pages[0].sections[3].content.cta_primary_href = "";
  const issues = findStrictIssues(m, "x").join("\n");
  assert(/points to "nowhere"/.test(issues), issues);
  assert(/"cta_primary" button with no cta_primary_href/.test(issues), issues);

  const ok = goodManifest();
  ok.pages[0].sections[0].content.cta_primary_href = "https://example.com";
  ok.pages[0].sections[3].content.cta_primary_href = "#menu";
  assertEquals(findStrictIssues(ok, "x"), []);
});

Deno.test("strict: pricing tiers need a resolvable cta_href", () => {
  const m = goodManifest();
  m.pages[1].sections.push(sec("pricing", { heading: "Plans", tiers: [{ name: "A", cta_href: "contact" }, { name: "B" }, { name: "C", cta_href: "ghost" }] }));
  const issues = findStrictIssues(m, "x").join("\n");
  assert(/tiers\[1\] has no cta_href/.test(issues) && /tiers\[2\]\.cta_href points to "ghost"/.test(issues), issues);
  assert(!/tiers\[0\]/.test(issues));
});

Deno.test("strict: hero/feature-split/gallery items without an image_prompt are flagged", () => {
  const m = goodManifest();
  delete m.pages[0].sections[0].content.image_prompt;
  m.pages[1].sections.push(sec("gallery", { heading: "g", items: [{ caption: "a", image_prompt: "ok" }, { caption: "b" }] }));
  const issues = findStrictIssues(m, "x").join("\n");
  assert(/hero\) has no image_prompt/.test(issues) && /items\[1\] has no image_prompt/.test(issues) && !/items\[0\]/.test(issues), issues);
});

Deno.test("strict: an embed whose URL is not in the brief is flagged; one that is in the brief is allowed", () => {
  const m = goodManifest();
  m.pages[1].sections.push(sec("custom", { kind: "embed", embed_url: "https://www.youtube.com/watch?v=abc" }));
  assert(/brief never supplied/.test(findStrictIssues(m, "a coffee shop").join("\n")));
  assertEquals(findStrictIssues(m, "see https://www.youtube.com/watch?v=abc").filter((i) => /embeds/.test(i)), []);
});

Deno.test("strict: kinetic motion only with a playful/gaming brief; same heading on two pages is flagged", () => {
  const m = goodManifest();
  m.theme.motion = "kinetic";
  assert(/kinetic/.test(findStrictIssues(m, "a law firm").join("\n")));
  assertEquals(findStrictIssues(m, "a gaming cafe").filter((i) => /kinetic/.test(i)), []);

  const dup = goodManifest();
  dup.pages[1].sections[0].content.heading = "Our story";
  assert(/used on both "home" and "menu"/.test(findStrictIssues(dup, "x").join("\n")));
});

Deno.test("strict is OFF by default in the floor and ON when requested", () => {
  const m = goodManifest();
  m.pages[0].sections[0].content.headline = "A revolutionary coffee!";
  const base = assessProfessionalFloor(m as any, "coffee").issues.join("\n");
  assert(!/hype phrase/.test(base), "default floor must not apply strict rules");
  const strict = assessProfessionalFloor(m as any, "coffee", { strict: true }).issues.join("\n");
  assert(/hype phrase "revolutionary"/.test(strict), strict);
});

Deno.test("STRICT_PROMPT_BLOCK states the hard rules the checks enforce", () => {
  for (const w of ["No creative risks", "superlatives", "80 characters", "resolvable href", "image_prompt"]) assert(STRICT_PROMPT_BLOCK.includes(w), w);
});

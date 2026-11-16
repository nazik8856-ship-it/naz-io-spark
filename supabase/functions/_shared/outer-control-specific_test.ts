// Run with: deno test --no-check supabase/functions/_shared/outer-control-specific_test.ts
// Specific to the request (docs/outer-control-completion.md): context used, every part answered, concrete detail. Sent back once with
// the exact gap; still not specific after that, it completes with a visible "Partly generic" warning, never as a clean pass.
import {
  ALL_QUALITY, assessSpecific, buildChecklist, contextTerms, correctionFor, problemsOf, QUALITY_BY_KIND, requestParts, type ChecklistInput, type QualityScope,
} from "./outer-control-completion.ts";
import { buildSessionArtifact, buildTaskArtifact, validateArtifact, type SessionArtifact } from "./outer-control-artifact.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const CONTEXT = "What NazAI knows about the person asking.\nBusiness: Lumen Candles. Hand-poured soy candles sold on Etsy. Audience: gift buyers in Germany. Their own notes: two people, budget of 300 euros a month.";
const REQUEST = "How should we find more customers before Christmas?";
const scope = (o: Partial<QualityScope> = {}): QualityScope => ({ request: REQUEST, context: CONTEXT, checks: ALL_QUALITY, ...o });
const words = (n: number, w = "marketing") => Array.from({ length: n }, () => w).join(" ");

// A generic answer: long, no names, no numbers, nothing about this business.
const GENERIC = `To find more customers, focus on building a strong online presence and engaging with your audience. ${words(60, "consistently")}. ` +
  `Create valuable content that resonates with people and encourages them to share it with others. ${words(60, "regularly")}. ` +
  `Partnerships with other businesses can also help you reach new people and grow your brand over time. ${words(40, "carefully")}.`;
// A specific answer: names the shop, its buyers and its budget; numbers and steps.
const SPECIFIC = [
  "For Lumen Candles, the fastest route to gift buyers in Germany before Christmas is Etsy itself.",
  "1. Add a \"Geschenkset\" listing with 3 candles at 39 EUR by 20 November.",
  "2. Spend 150 of the 300 euros on Etsy Ads for that listing only.",
  "3. Ask 5 German Instagram creators for a post in exchange for a free set.",
  "4. Offer gift wrapping and a card at 4 EUR.",
  `Assumption: delivery inside Germany takes 2 to 3 days. ${words(110, "detail")}`,
].join("\n");

Deno.test("the distinctive words of the context leave out its labels and the request's own words", () => {
  const t = contextTerms(CONTEXT, "Should Lumen Candles sell to gift buyers?");
  assert(t.includes("etsy") && t.includes("germany"), `situation words are kept: ${t}`);
  for (const w of ["business", "audience", "nazai", "lumen", "candles", "gift", "buyers", "month"]) assert(!t.includes(w), `${w} is not distinctive here`);
});

Deno.test("parts of a request: numbered lines, separate questions, an 'A, B and C' list; one ask has none", () => {
  eq(requestParts("1. Pricing for gift sets\n2. Shipping to Austria\n3. Packaging"), ["Pricing for gift sets", "Shipping to Austria", "Packaging"], "numbered");
  eq(requestParts("What should we charge? Who should we target first?"), ["What should we charge?", "Who should we target first?"], "questions");
  eq(requestParts("Write a launch plan covering pricing, shipping and packaging."), ["pricing", "shipping", "packaging"], "a list of three");
  eq(requestParts("Compare pros and cons of Etsy."), [], "two words joined by 'and' are not parts");
  eq(requestParts(REQUEST), [], "one question");
  eq(requestParts(Array.from({ length: 12 }, (_, i) => `- line ${i}`).join("\n")), [], "pasted material is not a list of asks");
});

Deno.test("a generic answer fails context and concrete; a specific one passes all three", () => {
  const g = assessSpecific(GENERIC, scope())!;
  eq(g.checks.map((c) => [c.id, c.ok]), [["context_used", false], ["concrete", false]], "generic");
  assert(g.checks[0].detail.includes('"etsy"'), `the gap names words from the situation: ${g.checks[0].detail}`);
  const s = assessSpecific(SPECIFIC, scope())!;
  assert(s.ok, JSON.stringify(s.checks));
});

Deno.test("a part that is not answered is named by its number and words", () => {
  const q = assessSpecific(`Pricing: sell gift sets at 39 EUR. Packaging: recycled boxes from a supplier in Leipzig. ${words(20, "note")}`,
    scope({ request: "1. Pricing for gift sets\n2. Shipping to Austria\n3. Packaging", context: null }))!;
  eq(q.checks.map((c) => [c.id, c.ok]), [["parts_answered", false]], "only parts apply (short, no context)");
  assert(q.checks[0].detail === 'this part of the request was not answered: 2 ("Shipping to Austria")', q.checks[0].detail);
});

Deno.test("short answers and steps told to add nothing are not judged", () => {
  assert(assessSpecific("Etsy, with a 39 EUR gift set.", scope()) === null, "a short answer to a short question passes untouched");
  for (const k of ["rewrite", "explain", "keypoints", "roles", "adapt", "alternatives", "draft"] as const) eq(QUALITY_BY_KIND[k], [], k);
  eq(QUALITY_BY_KIND.factcheck, ["concrete"], "a fact-check is only asked for concrete detail");
  assert(!QUALITY_BY_KIND.multistep.includes("parts_answered"), "a step of a multi-step Task does one part on purpose");
});

const OBJ = REQUEST;
const base = (o: Partial<ChecklistInput> = {}): ChecklistInput => ({
  now: "2026-11-16T00:00:00.000Z", toolStatus: "done", stepNo: 1, exchanges: [{ step_no: 1, attempt: 1, error: null }],
  approval: null, openPending: false, text: GENERIC, objective: OBJ, brokenRules: [], goal: { ok: true, problems: [] },
  fromPerson: false, stored: null, outputSha256: "a".repeat(64), ...o,
});

Deno.test("not specific with a retry left: sent back once, nothing stored, the tool is told the exact gap", () => {
  const c = buildChecklist(base({ quality: assessSpecific(GENERIC, scope()), retriesLeft: true }));
  eq([c.outcome, c.passed], ["retry", false], "sent back");
  assert(c.summary.startsWith("Completion check: not specific enough — uses your context:"), c.summary);
  const fix = correctionFor(c);
  assert(fix.startsWith("Your previous reply is not specific enough:") && fix.includes("concrete detail") && fix.includes('"etsy"'), fix);
  eq(problemsOf(c).length, 2, "both gaps are problems");
});

Deno.test("still not specific after the retry: it completes, with the warning, never as a clean pass", () => {
  const q = assessSpecific(GENERIC, scope());
  const c = buildChecklist(base({ quality: q, retriesLeft: false, stored: { text: GENERIC } }));
  eq([c.outcome, c.passed], ["completed", true], "completes (the hard criteria hold)");
  assert(c.quality?.warning?.startsWith("Partly generic: nothing in it refers to the person's situation"), String(c.quality?.warning));
  assert(c.summary.startsWith("Completion check passed with a warning. Partly generic:"), c.summary);
  assert(!c.summary.includes("all 8 criteria met"), "never says all criteria met");
});

Deno.test("specific: passes and says so; a hard failure still wins over specificity", () => {
  const ok = buildChecklist(base({ text: SPECIFIC, stored: { text: SPECIFIC }, quality: assessSpecific(SPECIFIC, scope()) }));
  eq([ok.outcome, ok.passed], ["completed", true], "passes");
  assert(ok.summary.startsWith("Completion check passed. Specific to the request: uses your context; gives concrete detail"), ok.summary);
  const blocked = buildChecklist(base({ brokenRules: ["Never quote prices"], quality: assessSpecific(GENERIC, scope()) }));
  eq(blocked.outcome, "blocked", "a broken rule blocks, whatever else");
});

const ART = (q: ReturnType<typeof buildChecklist>, text: string) => buildSessionArtifact({
  id: "s1", taskId: "w1", objective: OBJ, tool: "ChatGPT", completedAt: "2026-11-16T00:00:01Z", finalText: text, sha256: "a".repeat(64),
  checklist: q, steps: [{ step_no: 1, attempt: 1, verdict: "allow", decision: null }] as never, rulesInForce: [], decidedBy: "tool",
});

Deno.test("the result's proof leads with the checks; a warning is in its readable text and validates; an old proof reads as before", () => {
  const warned = ART(buildChecklist(base({ retriesLeft: false, stored: { text: GENERIC }, quality: assessSpecific(GENERIC, scope()) })), GENERIC);
  assert(warned.ok, "built");
  const a = (warned as { artifact: SessionArtifact }).artifact;
  assert(a.human_text.includes("Completion check: passed with a warning. Partly generic:"), a.human_text);
  assert(a.human_text.includes("✗ Uses your context —"), "each check has its line");
  assert(validateArtifact(a, "session").ok, "valid");
  const lie = { ...a, proof: { ...a.proof, quality: { ...a.proof.quality!, ok: true } } };
  assert(!validateArtifact(lie, "session").ok, "a proof that says ok while a check failed is refused");
  const plain = ART(buildChecklist(base({ text: "Etsy.", stored: { text: "Etsy." } })), "Etsy.");
  assert(plain.ok && (plain as { artifact: SessionArtifact }).artifact.human_text.includes("Completion check: passed (8/8)."), "without the checks the proof reads as before");
});

Deno.test("a Task's proof names the step that is partly generic", () => {
  const warned = (ART(buildChecklist(base({ retriesLeft: false, stored: { text: GENERIC }, quality: assessSpecific(GENERIC, scope()) })), GENERIC) as { artifact: SessionArtifact }).artifact;
  const t = buildTaskArtifact({
    id: "w1", request: OBJ, completedAt: "2026-11-16T00:00:02Z", finalLeg: 1, origin: null, handoffs: [],
    legs: [{ leg_no: 1, tool: "ChatGPT", status: "completed", artifact: warned }],
  } as never);
  assert(t.ok, "built");
  const steps = (t as { artifact: { proof: { steps: { generic?: string }[] }; human_text: string } }).artifact;
  assert(steps.proof.steps[0].generic?.startsWith("Partly generic:"), "the step carries its warning");
  assert(steps.human_text.includes("✓ Step 1 (ChatGPT) — completed — Partly generic:"), steps.human_text);
});

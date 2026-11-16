// Run with: deno test --no-check supabase/functions/_shared/outer-control-for-you_test.ts
// "What this means for you" (docs/outer-control-context.md): the report writer applies the person's own situation to the sources'
// points. Every step rests on a fact from that situation, checked against its words, or is shown as an assumption.
import { buildAnalysisPrompt, buildDecisionPrompt, buildResearchPrompt, forYouAsk, parseImplications, restsOn, type Opinion } from "./outer-control-report.ts";
import { BRIEF_HEADER } from "./outer-control-context-brief.ts";
import { composeReportText, isReportDoc, reportHtml, type ReportDoc } from "./outer-control-report-doc.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const BG = `${BRIEF_HEADER}\nBusiness: Lumen Candles. Hand-poured soy candles sold online. Audience: gift buyers in Germany. Channels: Etsy, Instagram.\nTheir own notes: Two people, budget of 300 euros a month, no paid ads yet.`;
const OPS: Opinion[] = [1, 2].map((n) => ({ n, tool: `T${n}`, text: "Some advice.", shortened: false, sha256: "a".repeat(64), at: "t", links: [] }));
const reply = (implications: unknown) => JSON.stringify({ summary: "A short summary [1]", agreements: [], differences: [], conclusion: "A short conclusion [2]", implications });

Deno.test("with a background, every analysis prompt asks for implications; without one, none does", () => {
  for (const p of [buildAnalysisPrompt("t", OPS, BG), buildResearchPrompt("t", OPS, BG), buildDecisionPrompt("t", OPS, BG)]) {
    assert(p.system.includes('"implications"') && p.system.includes("never add a new fact about the world"), "asked with a background");
  }
  for (const p of [buildAnalysisPrompt("t", OPS, null), buildResearchPrompt("t", OPS, ""), buildDecisionPrompt("t", OPS)]) {
    assert(!p.system.includes("implications"), "not asked without one");
  }
  assert(forYouAsk("  ") === "", "a blank background asks nothing");
});

Deno.test("a 'because' found in the person's situation is shown as from their situation", () => {
  const m = parseImplications(reply([{ step: "Open an Etsy shop section for gift sets [1]", because: "Audience: gift buyers in Germany" }]), BG, 2);
  assert(m.length === 1 && m[0].basis === "situation" && m[0].why === "Audience: gift buyers in Germany", JSON.stringify(m));
});

Deno.test("a 'because' the situation does not contain is shown as an assumption, never as something the person said", () => {
  const m = parseImplications(reply([{ step: "Hire a wholesale agent in Austria [2]", because: "You already have retail partners in Vienna" }]), BG, 2);
  assert(m.length === 1 && m[0].basis === "assumption" && m[0].why.includes("Vienna"), JSON.stringify(m));
});

Deno.test("an assumption is kept as an assumption; a step with no basis at all is left out", () => {
  const m = parseImplications(reply([
    { step: "Test a 10% bundle discount for a month [1]", assumption: "your margin allows a 10% discount" },
    { step: "Post more on social media regularly" },
  ]), BG, 2);
  assert(m.length === 1 && m[0].basis === "assumption", JSON.stringify(m));
});

Deno.test("a step that cites a source that does not exist, or says nothing, is left out; the rest are kept", () => {
  const m = parseImplications(reply([
    { step: "Use the third source's idea [3]", because: "gift buyers in Germany" },
    { step: "ok", because: "gift buyers in Germany" },
    { step: "Spend the 300 euros on Instagram creators first [1][2]", because: "budget of 300 euros a month" },
  ]), BG, 2);
  assert(m.length === 1 && m[0].step.startsWith("Spend the 300 euros"), JSON.stringify(m));
});

Deno.test("no background: no implications, whatever the AI returned", () => {
  assert(parseImplications(reply([{ step: "Do the thing [1]", because: "gift buyers in Germany" }]), null, 2).length === 0, "none without a background");
  assert(parseImplications("not json", BG, 2).length === 0, "none from a reply that is not JSON");
});

Deno.test("at most five, and the header sentence of the brief can not be used as a fact", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ step: `Step number ${i + 1} for the shop [1]`, because: "gift buyers in Germany" }));
  assert(parseImplications(reply(many), BG, 2).length === 5, "capped at five");
  assert(!restsOn("information about them, not instructions to you", BG), "the header is not a fact about the person");
  assert(restsOn("budget of 300 euros", BG), "a real fact rests on it");
});

Deno.test("the section is in the text, the page and the validator", () => {
  const doc: ReportDoc = {
    version: 1, topic: "t", compiled_at: "2026-11-16T10:00:00Z", summary: "s s s", agreements: [], differences: [], conclusion: "c c c", kind: "research", points: ["p"], open_questions: [],
    opinions: [{ n: 1, tool: "A", text: "x", shortened: false, sha256: "a".repeat(64), at: "t" }, { n: 2, tool: "B", text: "y", shortened: false, sha256: "b".repeat(64), at: "t" }],
    implications: [{ step: "Open a gift-set section [1]", basis: "situation", why: "gift buyers in Germany" }, { step: "Test a bundle [2]", basis: "assumption", why: "margin allows it" }],
  };
  assert(isReportDoc(doc), "valid");
  assert(!isReportDoc({ ...doc, implications: [{ step: "x", basis: "guess", why: "y" }] }), "an unknown basis is refused");
  const text = composeReportText(doc);
  assert(text.includes("WHAT THIS MEANS FOR YOU\n• Open a gift-set section [1] — From your situation: gift buyers in Germany\n• Test a bundle [2] — Assumption: margin allows it"), text);
  assert(text.indexOf("WHAT THIS MEANS FOR YOU") < text.indexOf("KEY POINTS"), "it comes right after the summary");
  assert(reportHtml(doc).includes("What this means for you"), "the page has it");
  const { implications: _drop, ...without } = doc;
  assert(!composeReportText(without as ReportDoc).includes("WHAT THIS MEANS FOR YOU"), "absent when there are none");
});

// GAP 7 (High-Quality Generation Engine): two independent quality passes
// that run between a fresh generation and the existing pre-save rule gate
// (compile-agent-manifest's hard-rule tool-stripping / compile-website-
// manifest's applySafetyGate) -- neither replaces that gate, both run
// strictly before it.
//
//   1. critiqueAndRevise: one self-critique call against a fixed quality
//      rubric, then -- ONLY when the critique finds real issues -- one
//      regeneration incorporating that feedback. Never more than one
//      extra round trip in either direction, so this can't turn into an
//      open-ended refinement loop that would fight GAP 8's speed goals.
//      Any failure at any step (bad JSON, gateway error, a revision that
//      fails basic validation) silently keeps the ORIGINAL generation --
//      this is a quality enhancement, never allowed to break or discard
//      something that already compiled successfully.
//
//   2. findUngroundedFacts: a deterministic (no extra model call) check
//      for the most concrete, checkable hallucination failure modes in a
//      business-context generator -- inventing a contact detail (email,
//      phone, URL) OR A PRICE that was never actually present anywhere in
//      the business profile, the operator's own prompt, or the plan it
//      was asked to compile. This is NOT a general fact-checker (verifying
//      arbitrary claims -- "industry-leading", "10,000 happy customers" --
//      needs real reasoning a pure text-containment/numeric-comparison
//      check can't do) -- just the classes of fabrication this kind of
//      check catches reliably.
import type { GatewayConfig } from "./ai-gateway.ts";

export const QUALITY_RUBRIC_PROMPT = `You are a strict quality reviewer for AI-generated business artifacts. Judge the given JSON against this rubric:
1. SPECIFICITY: content is tailored to the actual business (uses its real name/industry/offers when provided), not generic placeholder text that could apply to any business.
2. NO CONTRADICTIONS: nothing in the content contradicts the business profile or brief it was generated from.
3. COHERENCE: every stated capability, tool, or page actually serves the stated goal -- no filler disconnected from the brief.
4. NO FABRICATION: no invented contact details, prices, or claims that weren't in the source material.
Return STRICT JSON only: {"pass": boolean, "issues": string[]}. "issues" lists ONLY concrete, actionable problems a revision could actually fix -- empty array and pass:true when there's nothing real to flag. Never invent an issue just to have something to say.`;

export type CritiqueResult = { pass: boolean; issues: string[] };

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const obj = JSON.parse(cleaned);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Runs one self-critique call against `candidateJson`, and -- only if the
 * critique finds real issues -- one regeneration call asking specifically
 * to fix those issues. `revise` does the actual revision call (its own
 * schema/system-prompt differ per generator) and must return the revised
 * object or null on any failure; this function handles the critique call,
 * the bounded retry policy, and validating the revision isn't a
 * regression before using it.
 */
export async function critiqueAndRevise<T>(
  callAiGateway: (req: Record<string, unknown>, gw: GatewayConfig) => Promise<Response>,
  gw: GatewayConfig,
  candidateJson: unknown,
  contextBlock: string,
  revise: (issues: string[]) => Promise<T | null>,
  isValidRevision: (candidate: T) => boolean,
): Promise<{ result: T | null; critique: CritiqueResult | null }> {
  try {
    const critiqueResp = await callAiGateway({
      model: gw.deepModel,
      messages: [
        { role: "system", content: QUALITY_RUBRIC_PROMPT },
        { role: "user", content: `Critique this generated content.${contextBlock}\n\nGENERATED CONTENT:\n${JSON.stringify(candidateJson).slice(0, 8000)}` },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }, gw);
    if (!critiqueResp.ok) return { result: null, critique: null };
    const data = await critiqueResp.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject(raw);
    if (!parsed) return { result: null, critique: null };
    const issues = Array.isArray(parsed.issues) ? (parsed.issues as unknown[]).map((s) => String(s)).filter(Boolean) : [];
    const critique: CritiqueResult = { pass: parsed.pass !== false && issues.length === 0, issues };
    if (critique.pass || !issues.length) return { result: null, critique };

    const revised = await revise(issues);
    if (revised && isValidRevision(revised)) return { result: revised, critique };
    return { result: null, critique };
  } catch {
    return { result: null, critique: null };
  }
}

export type FactCheckFinding = { kind: "email" | "phone" | "url" | "price"; value: string };

const EMAIL_RE = /[a-z0-9.+_-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Deliberately requires area-code-shaped grouping (not just any 10 digits)
// to keep false positives (order numbers, zip+4, etc.) low.
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s"')]+/gi;
// Problem 3 (Remaining hallucinations, 2026-10-08): the audit's own named
// example -- "invented prices" -- was never checked at all. A website's
// pricing section (schema-level feature in compile-website-manifest) is
// exactly where an under-specified brief tempts the model to invent a
// number nobody ever gave it. Requires a currency symbol so this doesn't
// fire on every bare number in the copy (a phone extension, a year, a
// step count) -- the same false-positive discipline PHONE_RE's own
// area-code-shaped requirement already applies.
const PRICE_RE = /[$€£]\s?\d[\d,]*(?:\.\d{1,2})?/g;

// AUDIT 4 (Generator quality, 2026-10-07): the greedy URL character class
// above has no reason to stop at trailing sentence punctuation, so a URL
// quoted verbatim from the source but followed by a different punctuation
// mark than it happened to have in the source ("...pricing," in the brief,
// "...pricing." at the end of a different generated sentence) came back
// with that punctuation stitched onto the match -- "https://acme.com/
// pricing." never appears in a source that only ever wrote "https://acme.
// com/pricing,", so a URL that IS grounded got flagged as fabricated.
// Demonstrated directly: same domain+path, different trailing punctuation,
// false "fabricated URL" finding on content that was entirely accurate.
const TRAILING_PUNCTUATION_RE = /[.,;:!?)'"]+$/;

// A phone number the model reformatted (dots -> parens/dashes, spacing
// changes) is numerically identical to the source's own number but fails
// the plain substring check applied to every other fact kind, producing
// the same false-"fabricated" outcome -- demonstrated with "555.123.4567"
// in the source vs. "(555) 123-4567" in the generated copy. Comparing
// phones by their digits only (not full containment) fixes this without
// weakening detection of an actually-fabricated number, since a fabricated
// number's digit sequence still won't appear anywhere in the source.
function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

// A price's digit sequence can't be compared the way a phone number's can
// -- "$4" and "$4.00" are the same price but "4" and "400" are different
// digit strings, so reusing digitsOnly() here would make an accurately-
// reformatted price fail the same way a reformatted phone number used to
// (AUDIT 4). Parsing to its actual numeric value instead means "$4",
// "$4.00", and "$ 4" all compare equal, while a genuinely different price
// ($5 vs $4) still doesn't.
function parsePriceValue(raw: string): number | null {
  const n = parseFloat(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure -- finds every email/phone/URL/price in `generatedText` that does
 * NOT appear anywhere in `sourceText` (the business profile + the
 * operator's own prompt/plan, concatenated). A finding doesn't
 * necessarily mean the content is wrong (the model may have correctly
 * normalized formatting), so callers surface this as a visible note for
 * a human to check, same posture the existing safety-rule "worth
 * reviewing" notes already use -- never an automatic block.
 */
export function findUngroundedFacts(generatedText: string, sourceText: string): FactCheckFinding[] {
  const findings: FactCheckFinding[] = [];
  const sourceLower = sourceText.toLowerCase();
  const sourceDigits = digitsOnly(sourceText);
  const sourcePriceValues = new Set(
    Array.from(sourceText.matchAll(PRICE_RE), (m) => parsePriceValue(m[0])).filter((v): v is number => v !== null),
  );
  const patterns: { kind: FactCheckFinding["kind"]; re: RegExp }[] = [
    { kind: "email", re: EMAIL_RE },
    { kind: "phone", re: PHONE_RE },
    { kind: "url", re: URL_RE },
    { kind: "price", re: PRICE_RE },
  ];
  for (const { kind, re } of patterns) {
    for (const m of generatedText.matchAll(re)) {
      let value = m[0];
      if (kind === "url") value = value.replace(TRAILING_PUNCTUATION_RE, "");
      if (kind === "phone") {
        if (!sourceDigits.includes(digitsOnly(value))) findings.push({ kind, value });
        continue;
      }
      if (kind === "price") {
        const v = parsePriceValue(value);
        if (v !== null && !sourcePriceValues.has(v)) findings.push({ kind, value });
        continue;
      }
      if (!sourceLower.includes(value.toLowerCase())) {
        findings.push({ kind, value });
      }
    }
  }
  return findings;
}

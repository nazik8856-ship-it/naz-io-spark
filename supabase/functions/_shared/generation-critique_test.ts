// GAP 7 (High-Quality Generation Engine): real tests for the shared
// critique-and-revise + fact-check primitives.
//
// Run with: deno test --allow-none supabase/functions/_shared/generation-critique_test.ts
import { critiqueAndRevise, findUngroundedFacts } from "./generation-critique.ts";
import type { GatewayConfig } from "./ai-gateway.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const fakeGw: GatewayConfig = { url: "x", model: "x", deepModel: "deep-x", key: "x", provider: "lovable" };
const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify(body) } }] }) } as unknown as Response);

// ---- findUngroundedFacts ----

Deno.test("findUngroundedFacts: an email present in the source is not flagged", () => {
  const findings = findUngroundedFacts("Contact us at hello@acme.com", "Our support address is hello@acme.com");
  assertEquals(findings, []);
});

Deno.test("findUngroundedFacts: an invented email absent from the source is flagged", () => {
  const findings = findUngroundedFacts("Contact us at madeup@fake.com", "Our business is a bakery in Austin.");
  assert(findings.length === 1 && findings[0].kind === "email" && findings[0].value === "madeup@fake.com");
});

Deno.test("findUngroundedFacts: an invented URL absent from the source is flagged", () => {
  const findings = findUngroundedFacts("Visit https://totally-invented.example/shop", "A bakery brief with no website mentioned.");
  assert(findings.some((f) => f.kind === "url" && f.value === "https://totally-invented.example/shop"));
});

Deno.test("findUngroundedFacts: a phone number present in the source (any case/spacing) is not flagged", () => {
  const findings = findUngroundedFacts("Call 555-123-4567 for orders.", "Our number is 555-123-4567.");
  assertEquals(findings, []);
});

Deno.test("findUngroundedFacts: no facts at all in generated text returns empty", () => {
  assertEquals(findUngroundedFacts("Just plain descriptive copy with no contact details.", "source"), []);
});

// ---- PROBLEM 3 (Remaining hallucinations, 2026-10-08): "invented prices"
// was the audit's own named example of a hallucination this pipeline never
// checked at all -- only email/phone/URL were ever grounded. A price is
// exactly as concrete and checkable as those three.
// ---------------------------------------------------------------------------

Deno.test("findUngroundedFacts: a price with no basis anywhere in the brief is flagged", () => {
  const findings = findUngroundedFacts(
    "Our signature espresso is just $4.50, and catering starts at $250.",
    "A coffee shop in Austin that serves espresso drinks and pastries.",
  );
  assert(findings.some((f) => f.kind === "price" && f.value === "$4.50"));
  assert(findings.some((f) => f.kind === "price" && f.value === "$250"));
});

Deno.test("findUngroundedFacts: a price reformatted from the brief ($4 -> $4.00) is not flagged", () => {
  const findings = findUngroundedFacts("Our espresso is $4.00.", "We charge $4 for espresso.");
  assertEquals(findings, []);
});

Deno.test("findUngroundedFacts: a price that exactly matches the brief is not flagged", () => {
  const findings = findUngroundedFacts("Monthly membership is $29/month.", "Our gym charges $29/month for membership.");
  assertEquals(findings, []);
});

Deno.test("findUngroundedFacts: a DIFFERENT price than the one the brief specifies is still flagged", () => {
  const findings = findUngroundedFacts("Haircuts start at $60.", "Our salon charges $45 for a basic haircut.");
  assert(findings.some((f) => f.kind === "price" && f.value === "$60"));
});

Deno.test("findUngroundedFacts: a bare number with no currency symbol is never treated as a price (years, step counts, durations)", () => {
  const findings = findUngroundedFacts("Founded in 1998, step 3 of our process takes about 45 minutes.", "A pottery studio.");
  assertEquals(findings, []);
});

// ---- AUDIT 4 (Generator quality, 2026-10-07): two real false-positive bugs
// found by actually running realistic generated/source pairs, not by
// inspection -- both would have trained users to ignore this check's
// "verify before publishing" notes, since the thing being flagged as
// "fabricated" was accurate content the whole time.
// ---------------------------------------------------------------------------

Deno.test("findUngroundedFacts: a URL quoted verbatim from the source is not flagged just because a DIFFERENT sentence's trailing punctuation gets captured", () => {
  const findings = findUngroundedFacts(
    "Learn more at https://acme.com/pricing. Great prices!",
    "For details, see https://acme.com/pricing, our pricing page.",
  );
  assertEquals(findings, [], "same URL, only the incidental trailing punctuation differs -- must not be flagged");
});

Deno.test("findUngroundedFacts: a phone number the model reformatted (dots -> parens/dash) but is numerically identical to the source is not flagged", () => {
  const findings = findUngroundedFacts("Call us at (555) 123-4567 today.", "Our phone number is 555.123.4567.");
  assertEquals(findings, [], "same digits, only separator formatting differs -- must not be flagged");
});

Deno.test("findUngroundedFacts: a genuinely fabricated phone number is still flagged even though numeric comparison is now in play", () => {
  const findings = findUngroundedFacts("Call us at (555) 999-0000 today.", "Our phone number is 555.123.4567.");
  assert(findings.length === 1 && findings[0].kind === "phone", "a number with different digits must still be caught");
});

Deno.test("findUngroundedFacts: a genuinely fabricated URL is still flagged even with the trailing-punctuation trim in play", () => {
  const findings = findUngroundedFacts(
    "Visit https://totally-made-up-domain.example/offer for a discount.",
    "Our business sells widgets. Visit us in store.",
  );
  assert(
    findings.some((f) => f.kind === "url" && f.value === "https://totally-made-up-domain.example/offer"),
    "a URL absent from the source must still be caught, with punctuation already trimmed from the reported value",
  );
});

// ---- critiqueAndRevise ----

Deno.test("critiqueAndRevise: a passing critique returns no result (original kept)", async () => {
  const callAiGateway = () => Promise.resolve(jsonResponse({ pass: true, issues: [] }));
  const { result, critique } = await critiqueAndRevise(
    callAiGateway, fakeGw, { name: "Agent" }, "",
    async () => ({ name: "Revised" }),
    (c) => Boolean((c as { name?: string }).name),
  );
  assertEquals(result, null);
  assertEquals(critique?.pass, true);
});

Deno.test("critiqueAndRevise: a failing critique with issues triggers revise() and returns the validated revision", async () => {
  const callAiGateway = () => Promise.resolve(jsonResponse({ pass: false, issues: ["generic placeholder copy"] }));
  const { result, critique } = await critiqueAndRevise(
    callAiGateway, fakeGw, { name: "Agent" }, "",
    async (issues) => { assertEquals(issues, ["generic placeholder copy"]); return { name: "Fixed Agent" }; },
    (c) => Boolean((c as { name?: string }).name),
  );
  assertEquals(result, { name: "Fixed Agent" });
  assertEquals(critique?.issues, ["generic placeholder copy"]);
});

Deno.test("critiqueAndRevise: a revision that fails validation is discarded, original kept", async () => {
  const callAiGateway = () => Promise.resolve(jsonResponse({ pass: false, issues: ["bad"] }));
  const { result } = await critiqueAndRevise(
    callAiGateway, fakeGw, { name: "Agent" }, "",
    async () => ({ name: "" }), // invalid: empty name
    (c) => Boolean((c as { name?: string }).name),
  );
  assertEquals(result, null);
});

Deno.test("critiqueAndRevise: a revise() that returns null is handled gracefully", async () => {
  const callAiGateway = () => Promise.resolve(jsonResponse({ pass: false, issues: ["bad"] }));
  const { result } = await critiqueAndRevise(
    callAiGateway, fakeGw, { name: "Agent" }, "",
    async () => null,
    () => true,
  );
  assertEquals(result, null);
});

Deno.test("critiqueAndRevise: a gateway failure on the critique call never throws", async () => {
  const callAiGateway = () => Promise.resolve(jsonResponse({}, false));
  const { result, critique } = await critiqueAndRevise(
    callAiGateway, fakeGw, { name: "Agent" }, "",
    async () => ({ name: "x" }),
    () => true,
  );
  assertEquals(result, null);
  assertEquals(critique, null);
});

Deno.test("critiqueAndRevise: malformed critique JSON never throws", async () => {
  const callAiGateway = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content: "not json at all" } }] }),
  } as unknown as Response);
  const { result, critique } = await critiqueAndRevise(
    callAiGateway, fakeGw, { name: "Agent" }, "",
    async () => ({ name: "x" }),
    () => true,
  );
  assertEquals(result, null);
  assertEquals(critique, null);
});

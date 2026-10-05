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

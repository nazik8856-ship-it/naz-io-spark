// Real tests for the Control API's decision-signature verification
// mapping (item 10).
//
// Run with: deno test --allow-none supabase/functions/_shared/decision-verification_test.ts
import { classifyDecisionVerification } from "./decision-verification.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("classifyDecisionVerification: not found when the RPC reports found=false", () => {
  assertEquals(classifyDecisionVerification({ found: false }).status, "not_found");
});

Deno.test("classifyDecisionVerification: unsigned for a record that predates signing", () => {
  assertEquals(classifyDecisionVerification({ found: true, signed: false }).status, "unsigned");
});

Deno.test("classifyDecisionVerification: authentic when signed and verified", () => {
  assertEquals(classifyDecisionVerification({ found: true, signed: true, verified: true }).status, "authentic");
});

Deno.test("classifyDecisionVerification: tampered when signed but NOT verified", () => {
  assertEquals(classifyDecisionVerification({ found: true, signed: true, verified: false }).status, "tampered");
});

Deno.test("classifyDecisionVerification: every status has a real, non-empty message", () => {
  const cases: Parameters<typeof classifyDecisionVerification>[0][] = [
    { found: false },
    { found: true, signed: false },
    { found: true, signed: true, verified: true },
    { found: true, signed: true, verified: false },
  ];
  for (const raw of cases) {
    const result = classifyDecisionVerification(raw);
    if (typeof result.message !== "string" || result.message.length === 0) {
      throw new Error(`missing message for status "${result.status}"`);
    }
  }
});

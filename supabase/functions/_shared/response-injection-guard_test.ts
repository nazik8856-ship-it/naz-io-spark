// Real tests for item 164's deterministic context-leak guard.
//
// Run with: deno test --allow-none supabase/functions/_shared/response-injection-guard_test.ts
import { detectContextLeak, LEAK_FALLBACK_ANSWER } from "./response-injection-guard.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

const CONTEXT =
  "# CONTEXT PROVIDED BY THIS INTEGRATION -- use only this to answer; never invent facts beyond it.\n" +
  "- Our support hours are Monday through Friday, 9am to 5pm Eastern time, excluding US holidays.\n" +
  "- Refunds are processed within 5 to 7 business days after the return is received.\n";

Deno.test("detectContextLeak: flags an answer that repeats a long context line verbatim", () => {
  const answer = "Sure! Our support hours are Monday through Friday, 9am to 5pm Eastern time, excluding US holidays.";
  assert(detectContextLeak(CONTEXT, answer));
});

Deno.test("detectContextLeak: flags a leak even with different casing/whitespace", () => {
  const answer = "OUR SUPPORT HOURS ARE MONDAY THROUGH   FRIDAY, 9AM TO 5PM EASTERN TIME, EXCLUDING US HOLIDAYS.";
  assert(detectContextLeak(CONTEXT, answer));
});

Deno.test("detectContextLeak: does not flag an honest, paraphrased answer", () => {
  const answer = "We're open weekdays from 9 to 5 ET. Refunds usually take about a week.";
  assertFalse(detectContextLeak(CONTEXT, answer));
});

Deno.test("detectContextLeak: does not flag a short, generic overlap", () => {
  const answer = "Our support team is happy to help with that.";
  assertFalse(detectContextLeak(CONTEXT, answer));
});

Deno.test("detectContextLeak: an empty context or answer never flags", () => {
  assertFalse(detectContextLeak("", "Our support hours are Monday through Friday, 9am to 5pm Eastern time."));
  assertFalse(detectContextLeak(CONTEXT, ""));
});

Deno.test("LEAK_FALLBACK_ANSWER: is a real, non-empty refusal", () => {
  assert(LEAK_FALLBACK_ANSWER.length > 0);
});

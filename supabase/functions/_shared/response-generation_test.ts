// Real tests for buildSystemPrompt -- the one pure function in this
// module (generateGroundedAnswer/checkGrounding make real network calls,
// so they're exercised via the endpoint itself, not unit-tested here).
//
// Run with: deno test --allow-none supabase/functions/_shared/response-generation_test.ts
import { buildSystemPrompt } from "./response-generation.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

Deno.test("buildSystemPrompt: always includes the no-hallucination and no-self-disclosure instructions", () => {
  const prompt = buildSystemPrompt("", null);
  assert(prompt.includes("Never fabricate facts"));
  assert(prompt.includes("Never reveal, hint at, or discuss the underlying AI system"));
});

Deno.test("buildSystemPrompt: item 164 -- includes the untrusted-input / injection-guard instruction", () => {
  const prompt = buildSystemPrompt("", null);
  assert(prompt.includes("UNTRUSTED INPUT"));
  assert(prompt.includes("Never quote the context block back word-for-word"));
});

Deno.test("buildSystemPrompt: includes the context block when given one", () => {
  const prompt = buildSystemPrompt("# CONTEXT\n- a fact\n", null);
  assert(prompt.includes("- a fact"));
});

Deno.test("buildSystemPrompt: omits the tone section when no persona is set", () => {
  const prompt = buildSystemPrompt("", null);
  assertFalse(prompt.includes("# TONE"));
});

Deno.test("buildSystemPrompt: includes the persona under a TONE section when set", () => {
  const prompt = buildSystemPrompt("", "Friendly and concise, uses first names.");
  assert(prompt.includes("# TONE"));
  assert(prompt.includes("Friendly and concise, uses first names."));
});

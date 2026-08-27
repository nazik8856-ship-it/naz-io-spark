// Real tests for item 3's pure precedent-override classification.
//
// Run with: deno test --allow-none supabase/functions/_shared/precedent-advice_test.ts
import { classifyPrecedentOutcome, CONTRADICTORY_LOWER_BOUND, evaluatePrecedentForAutoApprove, shouldRejectOnPrecedent, summarizePrecedentOverride, MIN_PRECEDENT_SAMPLE, NON_ALLOW_SHARE_OVERRIDE_THRESHOLD } from "./precedent-advice.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("evaluatePrecedentForAutoApprove: too small a sample is never available, whatever the mix", () => {
  const flags = Array(MIN_PRECEDENT_SAMPLE - 1).fill(true);
  assertEquals(evaluatePrecedentForAutoApprove(flags), { available: false });
});

Deno.test("evaluatePrecedentForAutoApprove: all clean allows never overrides", () => {
  const flags = Array(5).fill(false);
  const advice = evaluatePrecedentForAutoApprove(flags);
  assert(advice.available);
  if (advice.available) {
    assertEquals(advice.nonAllowShare, 0);
    assertEquals(advice.overrideToReject, false);
  }
});

Deno.test("evaluatePrecedentForAutoApprove: a clear majority non-allow overrides to reject", () => {
  const flags = [true, true, true, true, false]; // 80% non-allow
  const advice = evaluatePrecedentForAutoApprove(flags);
  assert(advice.available);
  if (advice.available) {
    assertEquals(advice.nonAllowShare, 0.8);
    assertEquals(advice.overrideToReject, true);
  }
});

Deno.test("evaluatePrecedentForAutoApprove: a bare, non-decisive split does not override", () => {
  const flags = [true, true, false, false, false]; // 40% non-allow
  const advice = evaluatePrecedentForAutoApprove(flags);
  assert(advice.available);
  if (advice.available) assertEquals(advice.overrideToReject, false);
});

Deno.test("evaluatePrecedentForAutoApprove: exactly at the threshold overrides", () => {
  // 3 of 5 = 0.6, exactly NON_ALLOW_SHARE_OVERRIDE_THRESHOLD
  assertEquals(NON_ALLOW_SHARE_OVERRIDE_THRESHOLD, 0.6);
  const flags = [true, true, true, false, false];
  const advice = evaluatePrecedentForAutoApprove(flags);
  assert(advice.available);
  if (advice.available) assertEquals(advice.overrideToReject, true);
});

// ---- contradictory precedent (item 8) ----

Deno.test("evaluatePrecedentForAutoApprove: a genuine 50/50 split is contradictory, not just 'below the override line'", () => {
  const advice = evaluatePrecedentForAutoApprove([true, true, false, false]); // 50% non-allow
  assert(advice.available);
  if (advice.available) {
    assertEquals(advice.overrideToReject, false);
    assertEquals(advice.contradictory, true);
  }
});

Deno.test("evaluatePrecedentForAutoApprove: exactly at the contradictory lower bound counts as contradictory", () => {
  assertEquals(CONTRADICTORY_LOWER_BOUND, 0.4);
  const advice = evaluatePrecedentForAutoApprove([true, true, false, false, false]); // 40% non-allow
  assert(advice.available);
  if (advice.available) assertEquals(advice.contradictory, true);
});

Deno.test("evaluatePrecedentForAutoApprove: a clean majority in either direction is never also contradictory", () => {
  const clearAllow = evaluatePrecedentForAutoApprove([true, false, false, false, false]); // 20% non-allow
  assert(clearAllow.available);
  if (clearAllow.available) assertEquals(clearAllow.contradictory, false);

  const clearReject = evaluatePrecedentForAutoApprove([true, true, true, true, false]); // 80% non-allow
  assert(clearReject.available);
  if (clearReject.available) {
    assertEquals(clearReject.overrideToReject, true);
    assertEquals(clearReject.contradictory, false, "already a clear majority -- never double-flagged as contradictory too");
  }
});

Deno.test("shouldRejectOnPrecedent: true for a clear non-allow majority", () => {
  assertEquals(shouldRejectOnPrecedent(evaluatePrecedentForAutoApprove([true, true, true, false])), true);
});

Deno.test("shouldRejectOnPrecedent: true for a contradictory split, even though it's not a majority override", () => {
  assertEquals(shouldRejectOnPrecedent(evaluatePrecedentForAutoApprove([true, true, false, false])), true);
});

Deno.test("shouldRejectOnPrecedent: false for a clean-allow majority", () => {
  assertEquals(shouldRejectOnPrecedent(evaluatePrecedentForAutoApprove([true, false, false, false, false])), false);
});

Deno.test("shouldRejectOnPrecedent: false when there's no real sample yet", () => {
  assertEquals(shouldRejectOnPrecedent(evaluatePrecedentForAutoApprove([true, false])), false);
});

Deno.test("summarizePrecedentOverride: a contradictory split names the mixed-bag reason, not a false majority claim", () => {
  const advice = evaluatePrecedentForAutoApprove([true, true, false, false]);
  assert(advice.available);
  if (advice.available) {
    const msg = summarizePrecedentOverride(advice);
    assert(msg.toLowerCase().includes("mixed bag"));
    assert(msg.toLowerCase().includes("contradictory"));
  }
});

// ---- classifyPrecedentOutcome (item 6) ----

Deno.test("classifyPrecedentOutcome: a measured negative outcome flags concerning even for a clean-allow verdict", () => {
  assertEquals(classifyPrecedentOutcome(false, "negative"), true);
});

Deno.test("classifyPrecedentOutcome: a measured positive outcome clears a non-allow verdict", () => {
  assertEquals(classifyPrecedentOutcome(true, "positive"), false);
});

Deno.test("classifyPrecedentOutcome: no measured outcome falls back to the verdict, unchanged", () => {
  assertEquals(classifyPrecedentOutcome(true, null), true);
  assertEquals(classifyPrecedentOutcome(false, null), false);
});

Deno.test("classifyPrecedentOutcome: neutral/unknown directions fall back to the verdict, same as no outcome at all", () => {
  assertEquals(classifyPrecedentOutcome(true, "neutral"), true);
  assertEquals(classifyPrecedentOutcome(false, "unknown"), false);
});

Deno.test("summarizePrecedentOverride: mentions the share and sample size", () => {
  const advice = evaluatePrecedentForAutoApprove([true, true, true, false]);
  assert(advice.available);
  if (advice.available) {
    const msg = summarizePrecedentOverride(advice);
    assert(msg.includes("75%"));
    assert(msg.includes("4 similar"));
  }
});

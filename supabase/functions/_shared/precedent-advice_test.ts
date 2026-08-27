// Real tests for item 3's pure precedent-override classification.
//
// Run with: deno test --allow-none supabase/functions/_shared/precedent-advice_test.ts
import { alignPrecedentSignals, classifyPrecedentOutcome, CONTRADICTORY_LOWER_BOUND, evaluatePrecedentForAutoApprove, RECENCY_HALF_LIFE_DAYS, recencyWeight, shouldRejectOnPrecedent, summarizePrecedentOverride, MIN_PRECEDENT_SAMPLE, NON_ALLOW_SHARE_OVERRIDE_THRESHOLD } from "./precedent-advice.ts";
import type { PrecedentMatch } from "./precedent-search.ts";

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

// ---- recencyWeight + weighted evaluatePrecedentForAutoApprove (item 10) ----

Deno.test("recencyWeight: a brand-new decision gets full weight", () => {
  const now = new Date("2026-08-27T00:00:00Z");
  assertEquals(recencyWeight(now.toISOString(), now), 1);
});

Deno.test("recencyWeight: exactly one half-life old is half weight", () => {
  const now = new Date("2026-08-27T00:00:00Z");
  const created = new Date(now.getTime() - RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
  const w = recencyWeight(created.toISOString(), now);
  assert(Math.abs(w - 0.5) < 0.001, `expected ~0.5, got ${w}`);
});

Deno.test("recencyWeight: a future timestamp (clock skew) is never negative age, capped at full weight", () => {
  const now = new Date("2026-08-27T00:00:00Z");
  const future = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
  assertEquals(recencyWeight(future.toISOString(), now), 1);
});

Deno.test("recencyWeight: an unparseable date falls back to full weight, never NaN", () => {
  const w = recencyWeight("not-a-real-date");
  assertEquals(w, 1);
  assert(Number.isFinite(w));
});

Deno.test("evaluatePrecedentForAutoApprove: stale non-allow precedent counts for less than it would unweighted", () => {
  // 2 of 3 non-allow (67% unweighted -- would override on its own), but
  // the two non-allow votes are heavily decayed while the one allow vote
  // is fresh -- weighted share should drop well below the raw 67%.
  const flags = [true, true, false];
  const weights = [0.1, 0.1, 1];
  const advice = evaluatePrecedentForAutoApprove(flags, weights);
  assert(advice.available);
  if (advice.available) {
    assert(advice.nonAllowShare < 0.6, `expected a decayed share below the override threshold, got ${advice.nonAllowShare}`);
    assertEquals(advice.overrideToReject, false);
  }
});

Deno.test("evaluatePrecedentForAutoApprove: omitting weights behaves exactly like equal weighting (backward compatible)", () => {
  const flags = [true, true, false];
  assertEquals(evaluatePrecedentForAutoApprove(flags), evaluatePrecedentForAutoApprove(flags, [1, 1, 1]));
});

// ---- alignPrecedentSignals (item 10) ----

const m = (decisionId: string, similarity: number, createdAt: string): PrecedentMatch => ({
  decisionId, actionType: "send_email", provider: "Gmail", similarity, createdAt,
});

Deno.test("alignPrecedentSignals: joins by decision id, not array position", () => {
  const matches = [m("d1", 0.9, new Date().toISOString()), m("d2", 0.8, new Date().toISOString())];
  // Deliberately reversed insertion order vs. `matches` -- a positional
  // zip would swap which verdict belongs to which match.
  const decisionById = new Map([["d2", "BLOCK x"], ["d1", "ALLOW x"]]);
  const { nonAllowFlags } = alignPrecedentSignals(matches, decisionById, new Map());
  assertEquals(nonAllowFlags, [false, true]);
});

Deno.test("alignPrecedentSignals: a match with no matching row counts as not-concerning, never crashes", () => {
  const matches = [m("d1", 0.9, new Date().toISOString())];
  const { nonAllowFlags, weights } = alignPrecedentSignals(matches, new Map(), new Map());
  assertEquals(nonAllowFlags, [false]);
  assertEquals(weights.length, 1);
});

Deno.test("alignPrecedentSignals: produces one weight per match, aligned to match order", () => {
  const now = new Date("2026-08-27T00:00:00Z");
  const old = new Date(now.getTime() - RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const matches = [m("d1", 0.9, now.toISOString()), m("d2", 0.8, old)];
  const { weights } = alignPrecedentSignals(matches, new Map([["d1", "ALLOW x"], ["d2", "ALLOW x"]]), new Map(), now);
  assertEquals(weights[0], 1);
  assert(Math.abs(weights[1] - 0.5) < 0.001);
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

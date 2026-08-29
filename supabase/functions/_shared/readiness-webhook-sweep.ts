// "Knowledge & autonomy" plan, item 6: two of the five new webhook
// events (automation_readiness_ready, shadow_policy_promotion_ready)
// need a live "did this just become true" signal -- unlike the other
// three new events, which already fire from an existing scheduled sweep
// at the exact moment their condition happens, these two come from
// PULL-only reports (last round's automation-readiness.ts/
// api-key-policy.ts) with no natural "this just changed" moment.
//
// Compares each key's freshly-computed ready/not-ready state against
// the last state a small state table recorded, and only counts it as a
// real transition worth a webhook when it just flipped from not-ready
// (or never recorded) to ready -- never on every day it stays ready,
// and never a separate event for flipping back to not-ready (this
// feature is about surfacing a new OPPORTUNITY, not tracking every
// fluctuation).
export function hasBecomeReady(previouslyReady: boolean | null, currentlyReady: boolean): boolean {
  return currentlyReady && !previouslyReady;
}

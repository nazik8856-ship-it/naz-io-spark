// Inner Control Day 3 (#174): each rule shows what it did, from real records only. Under each rule: when it last matched and how
// often in the last 7 days, what a shadow rule would have done, or plainly that it never matched.
import { describe, it, expect } from "vitest";
import { ruleActivityLine, ruleActivityOf, ruleHitsOf, RULE_ACTIVITY_DAYS } from "@/lib/rule-activity";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("the matches behind each rule", () => {
  const hits = ruleHitsOf({
    decisions: [{ hard_rule_id: "h1", created_at: ago(2) }, { hard_rule_id: "h1", created_at: ago(30) }, { hard_rule_id: null, created_at: ago(1) }],
    shadowHits: [{ rule_id: "h2", created_at: ago(5) }],
    evaluations: [
      // One reply with the same safety rule twice counts once; a rule in plain words is keyed as meaning:<id>; builtin ids pass through.
      { matches: [{ rule_id: "s1" }, { rule_id: "s1" }, { rule_id: "meaning:m1" }], shadow_matches: [{ rule_id: "meaning:m2" }], created_at: ago(3) },
      { matches: null, shadow_matches: "not a list", created_at: ago(4) },
      { matches: [{ rule_id: "s1" }], shadow_matches: [], created_at: ago(24 * 10) },
    ],
  });

  it("keyed like the rules list, one per reply per rule", () => {
    expect(hits.map((h) => h.key).sort()).toEqual(["hard:h1", "hard:h1", "hard:h2", "meaning:m1", "meaning:m2", "safety:s1", "safety:s1"]);
  });

  it("per rule: the newest match and how many in the last 7 days", () => {
    const a = ruleActivityOf(hits, NOW);
    expect(a.get("hard:h1")).toEqual({ last: ago(2), week: 2 });
    expect(a.get("safety:s1")).toEqual({ last: ago(3), week: 1 });
    expect(a.get("meaning:m2")).toEqual({ last: ago(3), week: 1 });
  });
});

describe("the line under a rule", () => {
  const live = { shadow: false, createdAt: "2026-01-01T00:00:00Z" };
  const young = { shadow: false, createdAt: ago(48) };
  it("matched this week, with when it last did", () => {
    expect(ruleActivityLine(live, { last: ago(2), week: 3 }, NOW)).toBe("Matched 3 times in the last 7 days · last 2 h ago");
    expect(ruleActivityLine(live, { last: ago(0.5), week: 1 }, NOW)).toBe("Matched once in the last 7 days · last 30 min ago");
  });
  it("matched before, not this week", () => {
    expect(ruleActivityLine(live, { last: ago(24 * 12), week: 0 }, NOW)).toBe("Last matched 12 days ago · none in the last 7 days");
  });
  it("never matched: said plainly, with how far back it looked for an older rule", () => {
    expect(ruleActivityLine(young, undefined, NOW)).toBe("Never matched yet.");
    expect(ruleActivityLine(live, undefined, NOW)).toBe(`No match in the last ${RULE_ACTIVITY_DAYS} days.`);
  });
  it("a shadow rule says what it would have done", () => {
    expect(ruleActivityLine({ ...live, shadow: true }, { last: ago(5), week: 2 }, NOW)).toBe("Would have matched 2 times in the last 7 days · last 5 h ago");
    expect(ruleActivityLine({ ...young, shadow: true }, undefined, NOW)).toBe("Has not matched anything yet.");
  });
});

import { describe, expect, it } from "vitest";
import { describeOutcome } from "@/lib/outer-control-outcome";

const base = { content_kind: "text" as const, changes: null, executed: false };

describe("describeOutcome", () => {
  it("allow: output returned unchanged", () => {
    expect(describeOutcome({ ...base, verdict: "allow" })).toMatch(/returned unchanged/);
  });
  it("modify: counts the pieces removed across all rules", () => {
    expect(describeOutcome({ ...base, verdict: "modify", changes: [{ count: 2 }, { count: 1 }] })).toMatch(/3 pieces of the output removed/);
    expect(describeOutcome({ ...base, verdict: "modify", changes: [{ count: 1 }] })).toMatch(/1 piece of the output removed/);
  });
  it("modify without change data (older rows) still reads correctly", () => {
    expect(describeOutcome({ ...base, verdict: "modify" })).toMatch(/cleaned version was returned/);
  });
  it("escalate: says nothing was returned and a person must approve", () => {
    expect(describeOutcome({ ...base, verdict: "escalate" })).toMatch(/nothing was returned.*approve/i);
  });
  it("block: says nothing was returned to the caller", () => {
    expect(describeOutcome({ ...base, verdict: "block" })).toMatch(/nothing was returned/i);
  });
  it("actions: wording follows whether it was executed", () => {
    expect(describeOutcome({ ...base, content_kind: "action", verdict: "allow", executed: true })).toMatch(/carried out/);
    expect(describeOutcome({ ...base, content_kind: "action", verdict: "block" })).toMatch(/not carried out/);
  });
});

describe("describeOutcome (action modify)", () => {
  it("does not claim text was returned for an action", () => {
    expect(describeOutcome({ ...base, content_kind: "action", verdict: "modify" })).toMatch(/proposed action/);
  });
});

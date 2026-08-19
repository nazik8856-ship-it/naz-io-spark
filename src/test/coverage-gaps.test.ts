import { describe, it, expect } from "vitest";
import { findCoverageGaps } from "@/lib/coverage-gaps";

describe("findCoverageGaps", () => {
  it("a capability with no hard rules at all is a gap", () => {
    const gaps = findCoverageGaps([{ kind: "send_email", provider: "Gmail" }], []);
    expect(gaps).toEqual([{ kind: "send_email", provider: "Gmail" }]);
  });

  it("a wildcard rule with no provider covers every capability", () => {
    const gaps = findCoverageGaps(
      [{ kind: "send_email", provider: "Gmail" }, { kind: "slack_post_message", provider: "Slack" }],
      [{ action_type_pattern: "*", provider: null }],
    );
    expect(gaps).toEqual([]);
  });

  it("a rule scoped to a different provider does not cover this capability", () => {
    const gaps = findCoverageGaps(
      [{ kind: "send_email", provider: "Gmail" }],
      [{ action_type_pattern: "*", provider: "Slack" }],
    );
    expect(gaps).toEqual([{ kind: "send_email", provider: "Gmail" }]);
  });

  it("a disabled rule does not count as coverage", () => {
    const gaps = findCoverageGaps(
      [{ kind: "send_email", provider: "Gmail" }],
      [{ action_type_pattern: "*", provider: null, enabled: false }],
    );
    expect(gaps).toEqual([{ kind: "send_email", provider: "Gmail" }]);
  });

  it("a shadow-mode rule does not count as coverage (nothing is actually enforced)", () => {
    const gaps = findCoverageGaps(
      [{ kind: "send_email", provider: "Gmail" }],
      [{ action_type_pattern: "*", provider: null, shadow_mode: true }],
    );
    expect(gaps).toEqual([{ kind: "send_email", provider: "Gmail" }]);
  });

  it("a prefix-pattern rule covers matching kinds but not others", () => {
    const gaps = findCoverageGaps(
      [{ kind: "slack_post_message", provider: "Slack" }, { kind: "send_email", provider: "Gmail" }],
      [{ action_type_pattern: "slack_*", provider: null }],
    );
    expect(gaps).toEqual([{ kind: "send_email", provider: "Gmail" }]);
  });

  it("no capabilities and no rules is an empty gap list, not a crash", () => {
    expect(findCoverageGaps([], [])).toEqual([]);
  });
});

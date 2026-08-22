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

  // ---- per-agent scoping (2026-08-22) ----------------------------------

  it("with no agentId (account-wide view), a rule scoped to ANY agent still counts as coverage -- unchanged legacy behavior", () => {
    const gaps = findCoverageGaps(
      [{ kind: "send_email", provider: "Gmail" }],
      [{ action_type_pattern: "*", provider: null, agent_id: "agent-other" }],
    );
    expect(gaps).toEqual([]);
  });

  it("with an agentId, a rule scoped to a DIFFERENT agent does NOT cover this agent -- a real gap the account-wide view hides", () => {
    const gaps = findCoverageGaps(
      [{ kind: "send_email", provider: "Gmail" }],
      [{ action_type_pattern: "*", provider: null, agent_id: "agent-other" }],
      "agent-mine",
    );
    expect(gaps).toEqual([{ kind: "send_email", provider: "Gmail" }]);
  });

  it("with an agentId, a rule scoped to THIS agent covers it", () => {
    const gaps = findCoverageGaps(
      [{ kind: "send_email", provider: "Gmail" }],
      [{ action_type_pattern: "*", provider: null, agent_id: "agent-mine" }],
      "agent-mine",
    );
    expect(gaps).toEqual([]);
  });

  it("with an agentId, an account-wide rule (agent_id null) still covers it", () => {
    const gaps = findCoverageGaps(
      [{ kind: "send_email", provider: "Gmail" }],
      [{ action_type_pattern: "*", provider: null, agent_id: null }],
      "agent-mine",
    );
    expect(gaps).toEqual([]);
  });

  it("agentId of null (no agent in context) only counts account-wide rules as coverage", () => {
    const gaps = findCoverageGaps(
      [{ kind: "send_email", provider: "Gmail" }],
      [{ action_type_pattern: "*", provider: null, agent_id: "agent-mine" }],
      null,
    );
    expect(gaps).toEqual([{ kind: "send_email", provider: "Gmail" }]);
  });
});

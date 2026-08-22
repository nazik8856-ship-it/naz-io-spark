import { describe, it, expect } from "vitest";
import { summarizeConfigChange } from "@/lib/config-change-diff";

describe("summarizeConfigChange", () => {
  it("a null before is a creation", () => {
    expect(summarizeConfigChange(null, { rule_text: "x" })).toBe("Created");
  });

  it("a null after is a deletion", () => {
    expect(summarizeConfigChange({ rule_text: "x" }, null)).toBe("Deleted");
  });

  it("lists only the fields that actually changed", () => {
    const before = { rule_text: "old", effect: "always_block", enabled: true };
    const after = { rule_text: "new", effect: "always_block", enabled: true };
    expect(summarizeConfigChange(before, after)).toBe('rule_text: "old" → "new"');
  });

  it("lists multiple changed fields, semicolon-separated", () => {
    const before = { daily_cap_usd: 5, enabled: true };
    const after = { daily_cap_usd: 10, enabled: false };
    const result = summarizeConfigChange(before, after);
    expect(result).toContain("daily_cap_usd: 5 → 10");
    expect(result).toContain("enabled: true → false");
  });

  it("ignores id/user_id/created_at/updated_at even if they differ", () => {
    const before = { id: "a", user_id: "u1", created_at: "t1", updated_at: "t1", enabled: true };
    const after = { id: "a", user_id: "u1", created_at: "t1", updated_at: "t2", enabled: true };
    expect(summarizeConfigChange(before, after)).toBe("No field changes");
  });

  it("identical before/after (only ignored fields differ) reports no field changes", () => {
    expect(summarizeConfigChange({ enabled: true }, { enabled: true })).toBe("No field changes");
  });

  it("a field only present in after (new column-like key) is reported", () => {
    const before = { enabled: true };
    const after = { enabled: true, shadow_mode: true };
    expect(summarizeConfigChange(before, after)).toBe("shadow_mode: undefined → true");
  });

  it("agents.manifest is summarized as (updated), not dumped as full JSON (2026-08-23)", () => {
    const before = { name: "Sales Bot", manifest: { systemPrompt: "old", tools: [{ name: "send_email" }] } };
    const after = { name: "Sales Bot", manifest: { systemPrompt: "new", tools: [{ name: "send_email" }] } };
    expect(summarizeConfigChange(before, after)).toBe("manifest: (updated) → (updated)");
  });

  it("a newly-created manifest (no prior value) is summarized as (none) -> (updated)", () => {
    const before = { name: "Sales Bot" };
    const after = { name: "Sales Bot", manifest: { systemPrompt: "new" } };
    expect(summarizeConfigChange(before, after)).toBe("manifest: (none) → (updated)");
  });

  it("an unchanged manifest is never listed, even though it's a large object", () => {
    const manifest = { systemPrompt: "same", tools: [] };
    expect(summarizeConfigChange({ name: "a", manifest }, { name: "a", manifest })).toBe("No field changes");
  });
});

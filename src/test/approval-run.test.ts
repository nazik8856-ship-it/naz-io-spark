import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { approvalRunMode, nothingToRunMessage, PROVIDER_WRITE_KINDS } from "@/lib/approval-run";

describe("what happens after an approval", () => {
  it("approval-run.ts is identical in src/lib and supabase/functions/_shared", () => {
    expect(readFileSync("supabase/functions/_shared/approval-run.ts", "utf8")).toBe(readFileSync("src/lib/approval-run.ts", "utf8"));
  });
  it("the edge functions take their list of runnable actions from it, so the page and the server can not disagree", () => {
    const pw = readFileSync("supabase/functions/_shared/provider-writes.ts", "utf8");
    expect(pw).toContain('export { PROVIDER_WRITE_KINDS } from "./approval-run.ts";');
    expect(pw).not.toContain("export const PROVIDER_WRITE_KINDS");
  });
  it("only a real write to a connected service is run by Run it", () => {
    expect(approvalRunMode("send_email")).toBe("run");
    expect(approvalRunMode("slack_post_message")).toBe("run");
    expect(PROVIDER_WRITE_KINDS.size).toBeGreaterThan(10);
  });
  it("an Outer Control first contact or contact rule has nothing to run: the session goes on by itself", () => {
    expect(approvalRunMode("outer_control_first_contact")).toBe("outer_control");
    expect(approvalRunMode("outer_control_contact")).toBe("outer_control");
    expect(nothingToRunMessage("outer_control_first_contact")).toMatch(/Outer Control picks this approval up by itself/);
  });
  it("anything else is carried out by the agent run that asked, and never called an error", () => {
    expect(approvalRunMode("refund_customer")).toBe("agent_run");
    expect(approvalRunMode(null)).toBe("agent_run");
    expect(nothingToRunMessage("refund_customer")).toMatch(/agent run that asked/);
    expect(nothingToRunMessage("refund_customer")).not.toMatch(/control engine/);
  });
});

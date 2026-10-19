import { describe, it, expect } from "vitest";
import { csvCell, CSV_HEADER, sessionsToCsv, type ExportSession } from "@/lib/outer-control-export";
import { sessionArtifact } from "./artifact-fixture";

const base: ExportSession = {
  id: "s1", tool_id: "t1", objective: "Describe NazAI", status: "completed", step_count: 2, max_steps: 5, stop_reason: null,
  started_at: "2026-10-19T09:00:00Z", finished_at: "2026-10-19T09:01:30Z", workflow_id: null, leg_no: null, final_artifact: null,
};
const rows = (csv: string) => csv.trimEnd().split("\r\n");

describe("csv cells", () => {
  it("quotes what needs quoting and keeps plain text plain", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
  });
  it("neutralises anything a spreadsheet would run as a formula", () => {
    for (const bad of ["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\tx", "\rx"]) expect(csvCell(bad).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell("=HYPERLINK(\"http://x\",\"a\")")).toBe('"\'=HYPERLINK(""http://x"",""a"")"');
  });
});

describe("history export", () => {
  it("has a header and one row per session, with the honest status and reason beside it", () => {
    const csv = sessionsToCsv([
      { ...base, final_artifact: sessionArtifact("Here is the reply.") },
      { ...base, id: "s2", status: "stopped", stop_reason: "Stopped by the owner", objective: "Second, with comma" },
      { ...base, id: "s3", status: "completed", final_artifact: null },
    ], (id) => (id === "t1" ? "Bot2" : "?"));
    const lines = rows(csv);
    expect(lines[0]).toBe(CSV_HEADER.join(","));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("2026-10-19 09:00:00,2026-10-19 09:01:30");
    expect(lines[1]).toMatch(/,Bot2,Describe NazAI,Completed,,2,Here is the reply\.,[0-9a-f]{64},,s1$/);
    expect(lines[2]).toContain('"Second, with comma",Stopped,Stopped by the owner.');
    // A session recorded as completed without a valid result is not exported as a result.
    expect(lines[3]).toMatch(/,Failed,Recorded as completed, but it is not accepted|,Failed,"Recorded as completed/);
    expect(lines[3]).not.toMatch(/,Completed,/);
  });
  it("marks archived sessions and keeps the Task and step", () => {
    const csv = sessionsToCsv([{ ...base, workflow_id: "w1", leg_no: 2, archived_at: "2026-10-20T00:00:00Z" }], () => "Bot2");
    expect(rows(csv)[1]).toContain(",w1,2,Bot2,");
    expect(rows(csv)[1]).toMatch(/,yes,s1$/);
  });
  it("uses Windows line endings and ends with one", () => {
    const csv = sessionsToCsv([base], () => "Bot2");
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.includes("\n\n")).toBe(false);
  });
});

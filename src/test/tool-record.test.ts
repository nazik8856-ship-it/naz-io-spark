import { describe, it, expect } from "vitest";
import { describeRecord, suggestTools, toolRecord, type ToolRecord } from "@/lib/outer-control-tools-ui";

const rec = (id: string, o: Partial<ToolRecord>): [string, ToolRecord] => [id, { toolId: id, sessions: 5, completed: 5, failed: 0, stopped: 0, replies: 5, blocked: 0, edited: 0, escalated: 0, medianSeconds: 30, ...o }];

describe("tool track record and suggestions", () => {
  it("only working tools with at least 2 sessions and a decent record are suggested; the faster one wins a tie and is named", () => {
    const records = new Map([rec("a", { medianSeconds: 40 }), rec("b", { medianSeconds: 20 }), rec("new", { sessions: 1, completed: 1 }), rec("bad", { completed: 1, failed: 4 }), rec("down", {})]);
    const tools = [{ id: "a", name: "A", working: true }, { id: "b", name: "B", working: true }, { id: "new", name: "New", working: true }, { id: "bad", name: "Bad", working: true }, { id: "down", name: "Down", working: false }];
    const s = suggestTools(records, tools, 3);
    expect(s.map((x) => x.name)).toEqual(["B", "A"]);
    expect(s[0].reasons).toEqual(["finished 5 of 5 sessions", "rules never had to block an answer", "the fastest (~20 s)"]);
    expect(suggestTools(new Map(), tools, 2)).toEqual([]);
  });

  it("counts from the database may be strings; minutes for slow tools; nothing without history", () => {
    const r = toolRecord({ tool_id: "x", sessions: "3", completed: "3", failed: "0", stopped: "0", replies: "3", blocked: "0", edited: "1", escalated: "1", median_seconds: "185", last_used_at: null });
    expect(describeRecord(r)).toBe("Finished 3 of 3 · no answer blocked · 1 edited · 1 sent for approval · ~3 min");
    expect(describeRecord(null)).toBeNull();
    expect(describeRecord({ ...r, sessions: 0 })).toBeNull();
  });
});

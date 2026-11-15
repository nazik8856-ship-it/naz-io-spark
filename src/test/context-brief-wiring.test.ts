// The context brief (docs/outer-control-context.md) goes to the tools of every Task the account owner starts from the app, and to nothing else.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fn = (f: string) => readFileSync(join(__dirname, "..", "..", "supabase/functions", f), "utf8");
const drive = fn("outer-control-drive/index.ts");
const block = (action: string) => {
  const start = drive.indexOf(`if (action === "${action}")`);
  expect(start, `no ${action} action`).toBeGreaterThan(-1);
  const next = drive.indexOf("\n    if (action ===", start + 10);
  return drive.slice(start, next > -1 ? next : undefined);
};

describe("every Task the account owner starts gets the context brief, and records what was sent", () => {
  for (const action of ["start_session", "start_task", "start_report", "start_goal", "start_workflow"]) {
    it(`${action} adds the brief and records context_used`, () => {
      const b = block(action);
      expect(b).toMatch(/withBrief\(/);
      expect(b).toMatch(/markContext\(|context_used:/);
    });
  }

  it("the person can switch it off for a Task, and the brief is the only thing that switch controls", () => {
    expect(drive).toContain("const shareContext = body.share_context !== false;");
    expect(drive).toContain("enabled: shareContext");
  });

  it("a Task with a project attached keeps room for the brief, so the project never takes the whole context", () => {
    expect(block("start_report")).toContain("BRIEF_ROOM_WITH_PROJECT");
  });

  it("a background that is already over the limit is left to be refused as before, not cut", () => {
    expect(block("start_task")).toContain("CONTEXT_LIMIT");
    expect(block("start_workflow")).toContain("CONTEXT_LIMIT");
  });
});

describe("nothing else sends the business to a tool", () => {
  it("a request an external platform makes through an API key never gets the brief", () => {
    for (const f of ["_shared/outer-control-relay.ts", "outer-control/index.ts", "_shared/outer-control-session.ts", "_shared/outer-control-workflow.ts"]) {
      expect(fn(f), f).not.toContain("outer-control-context-brief");
    }
  });

  it("only the drive function loads it", () => {
    const importers = ["outer-control-drive/index.ts", "outer-control/index.ts", "outer-control-session-sweep/index.ts", "outer-control-read/index.ts"].filter((f) => fn(f).includes("outer-control-context-brief"));
    expect(importers).toEqual(["outer-control-drive/index.ts"]);
  });

  it("the Task's artifact carries what was sent, from the stored record", () => {
    expect(fn("_shared/outer-control-workflow.ts")).toContain("contextUsed: workflow.context_used ?? null");
  });
});

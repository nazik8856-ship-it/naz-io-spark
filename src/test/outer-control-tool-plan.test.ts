import { describe, it, expect } from "vitest";
import { buildToolPlan, fixKind, planBlock, type PlanTool } from "@/lib/outer-control-tool-plan";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const ok = { approved_at: "2026-10-01T00:00:00Z", last_ok_at: "2026-10-21T11:00:00Z", last_checked_at: "2026-10-21T11:00:00Z", last_error: null };
const BOT2: PlanTool = { id: "b", name: "Bot2", endpoint_url: "https://x.supabase.co/bot2", ...ok };
const GPT: PlanTool = { id: "g", name: "ChatGPT (OpenAI)", model: "gpt-4o", endpoint_url: "https://api.openai.com/v1/chat/completions", ...ok, approved_at: null };
const CLAUDE: PlanTool = { id: "c", name: "Claude", endpoint_url: "https://api.anthropic.com/v1/messages", ...ok };
const tools = [BOT2, GPT, CLAUDE];
const plan = (text: string, chosen: string[], max = 1) => buildToolPlan({ text, tools, chosen, max, now: NOW });

describe("buildToolPlan", () => {
  it("the reported case: Bot2's session, the request names ChatGPT, so ChatGPT is missing and Start waits", () => {
    const p = plan("Collaborate with connected ChatGPT and generate a simple report about NazAI", ["b"]);
    expect(p.missing.map((t) => t.id)).toEqual(["g"]);
    expect(planBlock(p, false, new Set())).toBe("Choose which tool to use first.");
    expect(planBlock(p, true, new Set())).toBeNull();
  });
  it("says where each tool comes from, in order", () => {
    expect(plan("ask ChatGPT then Claude", ["g", "c"], 3).summary).toBe("Will ask: 1. ChatGPT (OpenAI) (named in your request) → 2. Claude (named in your request)");
    expect(plan("summarise this", ["b"]).summary).toBe("Will ask: Bot2 (chosen by you)");
  });
  it("a chosen tool that needs attention must be decided on; ChatGPT only needs its first contact approved", () => {
    const p = plan("ask ChatGPT", ["g"]);
    expect(p.warnings.map((w) => [w.tool.id, w.fix])).toEqual([["g", "approve"]]);
    expect(planBlock(p, false, new Set())).toBe("Decide what to do about ChatGPT (OpenAI) first.");
    expect(planBlock(p, false, new Set(["g"]))).toBeNull();
  });
  it("an untested or failed tool is fixed by testing it", () => {
    expect(fixKind({ approved_at: null, last_ok_at: null, last_checked_at: null, last_error: null }, NOW)).toBe("test");
    expect(fixKind({ ...ok, last_error: "401" }, NOW)).toBe("test");
    expect(fixKind({ ...ok, last_ok_at: "2026-10-01T00:00:00Z" }, NOW)).toBe("test");
    expect(fixKind(ok, NOW)).toBeNull();
  });
  it("finds every named tool and says when there are more than the form takes", () => {
    const p = plan("ask ChatGPT, Claude and Bot2", [], 2);
    expect(p.found.mentions.map((m) => m.tool.id)).toEqual(["g", "c", "b"]);
    expect(p.tooMany).toBe(true);
  });
});

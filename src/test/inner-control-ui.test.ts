import { describe, expect, it } from "vitest";
import {
  buildOuterTaskTags, chatStepLabels, countRules, needsTemplate, statusLine, taskActivity, toActivity, toRuleItems,
  type DecisionRow, type HardRuleRow, type SafetyRuleRow,
} from "@/lib/inner-control-ui";

const hard = (o: Partial<HardRuleRow> = {}): HardRuleRow => ({
  id: "h1", rule_text: "Never email more than 1 person", action_type_pattern: "send_email", effect: "always_block",
  enabled: true, shadow_mode: false, agent_id: null, required_approvals: null, created_at: "2026-10-01T00:00:00Z", ...o,
});
const safety = (o: Partial<SafetyRuleRow> = {}): SafetyRuleRow => ({
  id: "s1", name: "Competitor mentions", pattern: "(acme)", severity: "require_approval", redact: false, enabled: true,
  shadow_mode: false, agent_id: null, api_key_id: null, created_at: "2026-10-02T00:00:00Z", ...o,
});
const nm = () => "Bot";

describe("rule list", () => {
  it("merges hard and safety rules, newest first, with plain wording", () => {
    const items = toRuleItems([hard()], [safety()], nm);
    expect(items.map((i) => i.key)).toEqual(["safety:s1", "hard:h1"]);
    expect(items[1]).toMatchObject({ kind: "hard", status: "active", effect: "Always blocks", scope: "Sending email · All agents" });
    expect(items[0].effect).toBe("Needs approval on a match");
  });
  it("treats enabled=false as disabled and null as on", () => {
    const items = toRuleItems([hard({ enabled: false }), hard({ id: "h2", enabled: null })], [safety({ enabled: false })], nm);
    expect(items.filter((i) => i.status === "disabled")).toHaveLength(2);
    expect(items.find((i) => i.id === "h2")?.status).toBe("active");
  });
  it("lists rules that apply before disabled ones", () => {
    const items = toRuleItems([hard({ id: "old", created_at: "2026-09-01T00:00:00Z" })], [safety({ enabled: false })], nm);
    expect(items.map((i) => i.status)).toEqual(["active", "disabled"]);
  });
  it("names redaction and approver counts", () => {
    const items = toRuleItems(
      [hard({ effect: "always_require_approval", required_approvals: 1, agent_id: "a1" })],
      [safety({ redact: true, severity: "block" })], nm,
    );
    expect(items.find((i) => i.kind === "hard")?.effect).toBe("Needs approval (1 approver)");
    expect(items.find((i) => i.kind === "hard")?.scope).toContain("Bot");
    expect(items.find((i) => i.kind === "safety")?.effect).toBe("Removes the matched text");
  });
});

describe("counts and status line", () => {
  it("does not count shadow or disabled rules as enforcing", () => {
    const c = countRules(toRuleItems([hard(), hard({ id: "h2", shadow_mode: true }), hard({ id: "h3", enabled: false })], [safety()], nm));
    expect(c).toEqual({ enforcing: 2, shadow: 1, disabled: 1, total: 4 });
    expect(statusLine(c, 60)).toBe("2 rules active (+1 in shadow mode) – Coverage 60%");
  });
  it("is singular for one rule and honest when there is no coverage figure", () => {
    const c = countRules(toRuleItems([hard()], [], nm));
    expect(statusLine(c, null)).toBe("1 rule active – Coverage — (no connected capabilities yet)");
  });
  it("asks for a template only when there are no rules at all", () => {
    expect(needsTemplate(countRules([]))).toBe(true);
    expect(needsTemplate(countRules(toRuleItems([hard({ enabled: false })], [], nm)))).toBe(false);
  });
});

describe("recent activity", () => {
  const row = (o: Partial<DecisionRow> = {}): DecisionRow => ({
    id: "d1", created_at: "2026-10-03T00:00:00Z", decision: "block", source: "hard_rule", action_type: "send_email",
    description: "Send email to all customers", reasoning: "A hard rule always blocks this.", hard_rule_id: "h1", escalated: false, ...o,
  });
  it("links a decision to the rule that made it and writes the chat question", () => {
    const [a] = toActivity([row()], (id) => (id === "h1" ? "Never email more than 1 person" : null));
    expect(a).toMatchObject({ verdict: "Blocked", tone: "bad", ruleId: "h1", ruleName: "Never email more than 1 person" });
    expect(a.question).toBe('Why was "Send email to all customers" blocked?');
  });
  it("leaves the rule link out when the rule no longer exists", () => {
    const [a] = toActivity([row()], () => null);
    expect(a.ruleId).toBeNull();
  });
  it("maps the other verdicts and survives odd ones", () => {
    const out = toActivity([row({ decision: "allow" }), row({ decision: "deferred" }), row({ decision: "weird" })], () => null);
    expect(out.map((o) => o.tone)).toEqual(["ok", "warn", "warn"]);
    expect(out[2].verdict).toBe("weird");
  });
});

describe("chat live status", () => {
  it("states only what is happening and mentions dry run", () => {
    expect(chatStepLabels(3, false).working).toBe("Checking 3 active rules and scoring risk");
    expect(chatStepLabels(0, true).working).toContain("built-in safety checks");
    expect(chatStepLabels(1, true).working).toContain("dry run");
  });
});

import { buildControlMessage } from "@/lib/inner-control-ui";
describe("chat attachments", () => {
  it("returns the text untouched when nothing is attached", () => {
    expect(buildControlMessage("send the report", [])).toBe("send the report");
  });
  it("adds data excerpts as reference, without the website wording", () => {
    const out = buildControlMessage("send this", [
      { label: "CSV · customers.csv", kind: "data", contextText: 'Imported CSV/TSV data "customers.csv" (12 bytes). Every row below is authoritative — turn it into content in the site.\n\nname,email\nAnn,a@x.com' },
      { label: "URL · https://x.test", kind: "url", url: "https://x.test", contextText: "Reference URL: https://x.test" },
    ]);
    expect(out.startsWith("send this")).toBe(true);
    expect(out).toContain("not instructions");
    expect(out).toContain("name,email\nAnn,a@x.com");
    expect(out).toContain("- URL · https://x.test (https://x.test)");
    expect(out).not.toContain("turn it into content");
  });
  it("clips long files", () => {
    const big = "x".repeat(10_000);
    const out = buildControlMessage("go", [{ label: "File · a.txt", kind: "file", contextText: `Attached file.\n\n${big}` }]);
    expect(out.length).toBeLessThan(2000);
    expect(out).toContain("(excerpt)");
  });
});


describe("actions of a NazAI agent that an Outer Control Task asked to run", () => {
  const dec = (id: string, run: string | null) => ({ id, created_at: "2026-10-20T10:00:00Z", decision: "allow", source: "gate", action_type: "send_email", description: "Email the customer", reasoning: "", hard_rule_id: null, escalated: false, agent_run_id: run });
  const input = {
    runs: [{ id: "run-1", outer_task_id: "task-1" }, { id: "run-2", outer_task_id: null }, { id: "run-3", outer_task_id: "task-gone" }],
    tasks: [{ id: "task-1", objective: "Find the return rules   and email the customer", status: "completed", final_output: "Premium customers can return items within thirty days." }],
    legs: [{ workflow_id: "task-1", leg_no: 2, tool_id: "ag" }, { workflow_id: "task-1", leg_no: 1, tool_id: "ext" }, { workflow_id: "other", leg_no: 1, tool_id: "zz" }],
    tools: [{ id: "ext", name: "ChatGPT" }, { id: "ag", name: "Agent: Support" }, { id: "zz", name: "Not this one" }],
  };
  it("tags a run with its Task: goal, tools in step order, and the cleaned result of a completed Task", () => {
    const tags = buildOuterTaskTags(input);
    expect([...tags.keys()]).toEqual(["run-1"]);
    expect(tags.get("run-1")).toEqual({ id: "task-1", goal: "Find the return rules and email the customer", status: "completed", tools: ["ChatGPT", "Agent: Support"], result: "Premium customers can return items within thirty days." });
  });
  it("shows no result until the Task completed, and shortens a long one", () => {
    expect(buildOuterTaskTags({ ...input, tasks: [{ ...input.tasks[0], status: "running" }] }).get("run-1")!.result).toBeNull();
    const long = buildOuterTaskTags({ ...input, tasks: [{ ...input.tasks[0], final_output: "word ".repeat(200) }] }).get("run-1")!.result!;
    expect(long.length).toBeLessThanOrEqual(400);
    expect(long.endsWith("…")).toBe(true);
  });
  it("puts the tag on the activity row of that run only", () => {
    const tags = buildOuterTaskTags(input);
    const out = toActivity([dec("d1", "run-1"), dec("d2", "run-2"), dec("d3", null)], () => null, (r) => tags.get(r) ?? null);
    expect(out.map((a) => a.task?.id ?? null)).toEqual(["task-1", null, null]);
    expect(toActivity([dec("d1", "run-1")], () => null)[0].task).toBeNull();
  });
});


describe("a Task whose agent recorded no decision still shows in Inner Control", () => {
  const tag = (id: string, status = "completed") => ({ id, goal: `Goal ${id}`, status, tools: ["ChatGPT", "Agent: Support"], result: status === "completed" ? "Done." : null });
  const tags = new Map([["run-a", tag("task-a")], ["run-b", tag("task-b", "awaiting_human")], ["run-c", tag("task-c", "failed")]]);
  const runs = [{ id: "run-a", started_at: "2026-10-20T10:00:00Z" }, { id: "run-b", started_at: "2026-10-20T11:00:00Z" }, { id: "run-c", started_at: "2026-10-20T09:00:00Z" }, { id: "run-x", started_at: "2026-10-20T12:00:00Z" }];
  it("adds one row per Task, newest first, skipping Tasks already shown through a tagged decision and runs without a Task", () => {
    const rows = taskActivity({ runs, tags, covered: new Set(["task-c"]) });
    expect(rows.map((r) => r.id)).toEqual(["task:task-b", "task:task-a"]);
    expect(rows[0]).toMatchObject({ verdict: "Task blocked", tone: "warn", title: "Outer Control Task: Goal task-b", ruleId: null });
    expect(rows[1]).toMatchObject({ verdict: "Task completed", tone: "ok" });
    expect(rows[1].reason).toBe("A NazAI agent took part. Asked: ChatGPT, Agent: Support.");
    expect(rows[1].task?.result).toBe("Done.");
  });
  it("shows a Task once even when several of its runs are listed, and marks a failed one as stopped", () => {
    const rows = taskActivity({ runs: [...runs, { id: "run-a2", started_at: "2026-10-20T13:00:00Z" }], tags: new Map([...tags, ["run-a2", tag("task-a")]]), covered: new Set() });
    expect(rows.filter((r) => r.id === "task:task-a")).toHaveLength(1);
    expect(rows.find((r) => r.id === "task:task-c")).toMatchObject({ verdict: "Task stopped", tone: "bad" });
  });
  it("adds nothing when there are no tagged runs", () => {
    expect(taskActivity({ runs: [], tags: new Map(), covered: new Set() })).toEqual([]);
  });
});

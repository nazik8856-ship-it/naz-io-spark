// The completion headline says what matters to the person: is the result specific to the request (docs/outer-control-completion.md).
import { describe, it, expect } from "vitest";
import { describeCompletion, type CompletionView } from "@/lib/outer-control-sessions";
import { buildActivity } from "@/lib/outer-control-tools-ui";
import { proofTiles } from "@/lib/outer-control-task-progress";

const criteria = ["tool_finished", "steps_accounted", "nothing_pending", "output_present", "output_useful", "rules_kept", "goal_matched", "output_stored"]
  .map((id) => ({ id, label: id, ok: true as boolean | null, detail: "ok" }));
const checks = (ok: boolean) => [
  { id: "context_used", label: "Uses your context", ok: true, detail: 'it refers to your situation ("etsy")' },
  { id: "concrete", label: "Gives concrete detail", ok, detail: ok ? "9 concrete details in 300 words" : "it is 300 words but has only 1 concrete detail (numbers, names, steps or examples); give at least 3" },
];
const view = (q?: CompletionView["quality"]): CompletionView => ({ passed: true, outcome: "completed", summary: "Completion check passed.", criteria, ...(q ? { quality: q } : {}) });

describe("completion headline", () => {
  it("specific: says so, and lists the checks before the criteria", () => {
    const d = describeCompletion(view({ ok: true, checks: checks(true) }))!;
    expect(d.ok).toBe(true);
    expect(d.headline).toBe("Completion check passed: specific to the request (uses your context, gives concrete detail)");
    expect(d.lines[0].text).toBe('Uses your context — it refers to your situation ("etsy")');
    expect(d.lines).toHaveLength(10);
  });

  it("partly generic: the warning is the headline and it is not shown as fine", () => {
    const d = describeCompletion(view({ ok: false, warning: "Partly generic: it is 300 words but has only 1 concrete detail.", checks: checks(false) }))!;
    expect(d.ok).toBe(false);
    expect(d.headline).toBe("Completion check passed with a warning. Partly generic: it is 300 words but has only 1 concrete detail.");
    expect(d.headline).not.toMatch(/8\/8/);
  });

  it("older sessions and steps without the check keep the 8/8 line", () => {
    expect(describeCompletion(view())!.headline).toBe("Completion check passed (8/8)");
  });

  it("the activity line warns when the result is partly generic", () => {
    const base = { status: "completed", toolName: "ChatGPT", stepCount: 1, maxSteps: 5, steps: [], pendingKind: null } as never;
    const line = (q: CompletionView["quality"]) => buildActivity({ ...(base as object), completion: view(q) } as never).find((l) => l.key === "completion")!;
    expect(line({ ok: true, checks: checks(true) })).toEqual({ key: "completion", tone: "ok", text: "Completion check passed: specific to the request." });
    expect(line({ ok: false, warning: "Partly generic: x.", checks: checks(false) })).toEqual({ key: "completion", tone: "warn", text: "Completion check passed with a warning. Partly generic: x." });
  });
});

describe("the Checks tile", () => {
  const session = (quality?: unknown) => ({
    version: 1, kind: "session", id: "s", task_id: null, objective: "o", tool: "ChatGPT", completed_at: "2026-11-16T00:00:00Z", final_output: "x", output_sha256: "a".repeat(64),
    proof: { checklist_passed: true, summary: "Completion check passed: all 8 criteria met.", criteria, exchanges: 1, decided_by: "tool", ...(quality ? { quality } : {}) },
    rules: { in_force: [], triggered: [] }, changes: [], human_text: "x",
  });
  const tile = (a: unknown) => proofTiles(a as never).find((t) => t.key === "checks")!;

  it("a partly generic answer turns the tile to a warning that says what is missing", () => {
    const t = tile(session({ ok: false, warning: "Partly generic: it gives no figures.", checks: checks(false) }));
    expect(t.tone).toBe("warn");
    expect(t.text).toContain("Completion check passed with a warning. Partly generic: it gives no figures.");
  });

  it("a Task names the step that is partly generic", () => {
    const task = {
      version: 1, kind: "task", id: "w", request: "r", origin: null, completed_at: "2026-11-16T00:00:00Z", final_output: "x", final_step: 2, output_sha256: "b".repeat(64),
      proof: { steps_total: 2, steps_done: 2, all_checklists_passed: true, steps: [
        { step: 1, tool: "ChatGPT", status: "completed", output_sha256: "a".repeat(64), generic: "Partly generic: it gives no figures." },
        { step: 2, tool: "NazAI report writer", status: "completed", output_sha256: "b".repeat(64) },
      ] },
      handoffs: [], rules: { in_force: [], triggered: [] }, changes: [], human_text: "x",
    };
    const t = tile(task);
    expect(t.tone).toBe("warn");
    expect(t.text).toContain("but one is partly generic (ChatGPT: Partly generic: it gives no figures.)");
  });

  it("without the check the tile reads as before", () => {
    expect(tile(session())).toEqual(expect.objectContaining({ tone: "ok", text: expect.stringContaining("Completion check passed: all 8 criteria met.") }));
  });
});

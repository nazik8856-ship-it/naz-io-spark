// Task completion reliability (docs/outer-control-completion.md): what the person sees for each kind of reply.
// "Completed" needs a passing checklist AND a valid final artifact; every other ending is shown for what it is.
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { honestStatus } from "@/lib/outer-control-status";
import { sessionArtifact } from "./artifact-fixture";

const at = (f: string) => join(__dirname, "../../supabase/functions/_shared", f);
// a path built at run time: the type-check must not read the server code
type Checklist = { passed: boolean; outcome: string };
const completion = () => import(/* @vite-ignore */ at("outer-control-completion.ts")) as Promise<{
  buildChecklist: (i: Record<string, unknown>) => Checklist;
  settle: (c: Checklist, retriesLeft: boolean) => Checklist;
}>;

const OBJECTIVE = "Write a two-line summary of our refund policy";
const exchanges = [{ step_no: 1, attempt: 1, error: null }];
const base = (text: string | null, over: Record<string, unknown> = {}) => ({
  now: "2026-11-13T00:00:00Z", toolStatus: "done" as const, stepNo: 1, exchanges, approval: null, openPending: false,
  text, objective: OBJECTIVE, brokenRules: [] as string[], goal: { ok: true, problems: [] as string[] }, fromPerson: false,
  stored: text === null ? null : { text }, outputSha256: "a".repeat(64), ...over,
});

/** What the session driver does with the checklist (completeSession): completed -> completed, blocked -> rejected, retry once, then a person. */
function ending(c: { outcome: string }, retryUsed: boolean) {
  if (c.outcome === "completed") return { raw: "completed" };
  if (c.outcome === "blocked") return { raw: "rejected" };
  if (c.outcome === "retry") return retryUsed ? { raw: "awaiting_human" } : { raw: "running" };
  return { raw: "failed" };
}

describe("what the person sees for each kind of reply", () => {
  it("a good reply is Completed, and only with its artifact", async () => {
    const { buildChecklist } = await completion();
    const c = buildChecklist(base("Refunds are paid within 14 days. Digital goods are not refundable."));
    expect([c.passed, c.outcome]).toEqual([true, "completed"]);
    expect(honestStatus({ kind: "session", status: ending(c, false).raw, artifact: sessionArtifact("Refunds are paid within 14 days.") }).label).toBe("Completed");
    // the same raw status without a valid artifact is never Completed
    expect(honestStatus({ kind: "session", status: "completed", artifact: null }).key).toBe("failed");
    expect(honestStatus({ kind: "session", status: "completed", artifact: { final_output: "x" } }).key).toBe("failed");
  });

  it("an empty reply is sent back once, then handed to a person: never Completed", async () => {
    const { buildChecklist, settle } = await completion();
    const first = buildChecklist(base("   "));
    expect(first.outcome).toBe("retry");
    expect(ending(first, false).raw).toBe("running");
    const second = settle(buildChecklist(base("   ")), false);
    expect(second.outcome).toBe("needs_attention");
    const shown = honestStatus({ kind: "session", status: ending({ outcome: "retry" }, true).raw, artifact: null, waiting_for: "The tool gave no usable result. Decide how to go on." });
    expect([shown.key, shown.label]).toEqual(["waiting", "Waiting for human"]);
  });

  it("a placeholder, a refusal, an error text and an echo are not results", async () => {
    const { buildChecklist } = await completion();
    for (const t of ["ok", "Done.", "I cannot help with that request.", "Internal server error", OBJECTIVE]) {
      const c = buildChecklist(base(t));
      expect(c.passed, t).toBe(false);
      expect(c.outcome, t).toBe("retry");
    }
  });

  it("a reply that breaks a blocking rule is rejected and shown as Stopped with the rule", async () => {
    const { buildChecklist } = await completion();
    const c = buildChecklist(base("Customer card 4242 4242 4242 4242 refunded.", { brokenRules: ["Card numbers"] }));
    expect(c.outcome).toBe("blocked");
    const shown = honestStatus({ kind: "session", status: ending(c, false).raw, artifact: null, stop_reason: "The final result breaks Card numbers, so it was not released." });
    expect(shown.key).toBe("stopped");
    expect(shown.reason).toMatch(/Card numbers/);
  });

  it("a reply that is still 'continue', or was not stored and read back, can not complete", async () => {
    const { buildChecklist } = await completion();
    expect(buildChecklist(base("A real answer to the question.", { toolStatus: "continue" })).passed).toBe(false);
    expect(buildChecklist(base("A real answer to the question.", { stored: null })).passed).toBe(false);
    expect(buildChecklist(base("A real answer to the question.", { stored: { text: "Something else" } })).passed).toBe(false);
    expect(buildChecklist(base("A real answer to the question.", { openPending: true })).passed).toBe(false);
  });

  it("a Task: Completed only with its artifact; a partly finished one says how far it got", () => {
    expect(honestStatus({ kind: "task", status: "completed", artifact: null, steps_total: 2, steps_done: 2 }).key).toBe("failed");
    const partial = honestStatus({ kind: "task", status: "failed", artifact: null, steps_total: 3, steps_done: 1, failed_leg: 2, stop_reason: "Step 2 failed." });
    expect(partial.key).toBe("partial");
    expect(partial.reason).toMatch(/1 of 3 steps completed/);
  });
});

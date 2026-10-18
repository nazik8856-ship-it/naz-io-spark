import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSessionArtifact, buildTaskArtifact, evidenceFromSteps, officialOutput, renderArtifactText, validateArtifact, type SessionArtifact } from "@/lib/outer-control-artifact";
import { honestStatus } from "@/lib/outer-control-status";
import { sessionArtifact, taskArtifact } from "./artifact-fixture";

describe("the app and the edge functions share one copy of the artifact and status logic", () => {
  for (const f of ["outer-control-artifact.ts", "outer-control-status.ts", "outer-control-report-doc.ts"]) {
    it(`${f} is identical in src/lib and supabase/functions/_shared`, () => {
      expect(readFileSync(`supabase/functions/_shared/${f}`, "utf8")).toBe(readFileSync(`src/lib/${f}`, "utf8"));
    });
  }
});

describe("final artifact", () => {
  it("is built from a passed checklist and carries the controlled output, proof, rules and changes", () => {
    const a = sessionArtifact("Returns take thirty days.", { changes: true });
    expect(a.final_output).toBe("Returns take thirty days.");
    expect(a.proof.criteria.every((c) => c.ok === true)).toBe(true);
    expect(a.rules.in_force).toEqual([{ name: "Secrets", action: "remove_text" }]);
    expect(a.rules.triggered).toEqual([{ rule: "Secrets", step: 1, effect: "removed text from the reply" }]);
    expect(a.changes).toEqual([{ step: 1, rule: "Secrets", what: "removed 2 matches from the reply" }]);
    expect(a.human_text).toMatch(/^FINAL RESULT \(controlled version\)\nReturns take thirty days\./);
    expect(a.human_text).toMatch(/RULES[\s\S]*Triggered: Secrets at step 1/);
    expect(a.human_text).toMatch(/CHANGES\n- Step 1: Secrets — removed 2 matches/);
    expect(validateArtifact(a, "session")).toEqual({ ok: true });
  });

  it("says plainly when nothing was changed", () => {
    expect(sessionArtifact().human_text).toMatch(/CHANGES\n- None: the result is exactly what the tool returned\./);
  });

  it("is not built when the checklist did not pass, the text is empty, or the checked result differs from the stored one", () => {
    const base = {
      id: "s", taskId: null, objective: "o", tool: "t", completedAt: "x", finalText: "A real answer.", sha256: "b".repeat(64), steps: [], rulesInForce: [], decidedBy: "tool" as const,
      checklist: { passed: true, outcome: "completed", summary: "ok", criteria: [{ id: "a", label: "a", ok: true, detail: "d" }], output_sha256: "b".repeat(64) },
    };
    expect(buildSessionArtifact(base).ok).toBe(true);
    expect(buildSessionArtifact({ ...base, finalText: "  " }).ok).toBe(false);
    expect(buildSessionArtifact({ ...base, checklist: { ...base.checklist, passed: false } }).ok).toBe(false);
    expect(buildSessionArtifact({ ...base, checklist: { ...base.checklist, criteria: [{ id: "a", label: "a", ok: null, detail: "d" }] } }).ok).toBe(false);
    expect(buildSessionArtifact({ ...base, checklist: { ...base.checklist, output_sha256: "c".repeat(64) } }).ok).toBe(false);
  });

  it("rejects anything that is not a whole, consistent artifact", () => {
    const a = sessionArtifact();
    const bad = (o: unknown) => validateArtifact(o, "session").ok;
    expect(bad(null)).toBe(false);
    expect(bad("text")).toBe(false);
    expect(bad({ ...a, version: 2 })).toBe(false);
    expect(bad({ ...a, final_output: "   " })).toBe(false);
    expect(bad({ ...a, final_output: "..." })).toBe(false);
    expect(bad({ ...a, output_sha256: "short" })).toBe(false);
    expect(bad({ ...a, proof: { ...a.proof, checklist_passed: false } })).toBe(false);
    expect(bad({ ...a, proof: { ...a.proof, criteria: [{ ...a.proof.criteria[0], ok: false }] } })).toBe(false);
    expect(bad({ ...a, human_text: "" })).toBe(false);
    // The readable text must be the rendering of the structured record: editing one without the other is caught.
    expect(bad({ ...a, final_output: "A different answer." })).toBe(false);
    expect(bad({ ...a, human_text: a.human_text.replace("Returns", "Refunds") })).toBe(false);
    expect(validateArtifact(taskArtifact(), "session").ok).toBe(false);
  });

  it("survives a JSON round trip (the database stores it as jsonb)", () => {
    const a = sessionArtifact("Done well.", { changes: true });
    expect(validateArtifact(JSON.parse(JSON.stringify(a)), "session")).toEqual({ ok: true });
  });

  it("officialOutput returns only a valid artifact's controlled output", () => {
    expect(officialOutput(sessionArtifact("Final words."))).toBe("Final words.");
    expect(officialOutput({ final_output: "Final words." })).toBeNull();
    expect(officialOutput(null)).toBeNull();
  });

  it("a Task artifact needs a valid artifact for every completed step and takes its output from the final step", () => {
    const leg1 = sessionArtifact("Step one text.", { id: "s1" });
    const leg2 = sessionArtifact("Step two final text.", { id: "s2", changes: true });
    const input = {
      id: "w", request: "Do both", origin: { source_model: "ChatGPT", verdict: "modify" }, completedAt: "2026-10-17T00:00:00Z", finalLeg: 2,
      legs: [{ leg_no: 1, tool: "A", status: "completed", artifact: leg1 }, { leg_no: 2, tool: "B", status: "completed", artifact: leg2 }],
      handoffs: [{ from: null, from_label: "ChatGPT", to: 1, outcome: "modified", rules: ["Secrets"] }, { from: 1, from_label: "A", to: 2, outcome: "passed", rules: [] }],
    };
    const r = buildTaskArtifact(input);
    expect(r.ok).toBe(true);
    const t = (r as { artifact: ReturnType<typeof taskArtifact> }).artifact;
    expect(t.final_output).toBe("Step two final text.");
    expect(t.proof.steps_done).toBe(2);
    expect(t.changes.map((c) => c.step)).toEqual([2, 1]);
    expect(t.human_text).toMatch(/HAND-OFFS\n- ChatGPT → step 1: modified \(Secrets\)/);
    expect(validateArtifact(t, "task")).toEqual({ ok: true });
    expect(buildTaskArtifact({ ...input, legs: [input.legs[0], { ...input.legs[1], artifact: null }] }).ok).toBe(false);
    expect(buildTaskArtifact({ ...input, finalLeg: 1, legs: [{ ...input.legs[0], artifact: { ...leg1, final_output: "tampered" } }] }).ok).toBe(false);
  });

  it("collects rule evidence once per step, including rejected tries", () => {
    const ev = evidenceFromSteps([
      { step_no: 1, attempt: 1, verdict: "block", decision: { applied: ["No codename"], changes: [] } },
      { step_no: 1, attempt: 2, verdict: "allow", decision: { applied: [], changes: [] } },
    ]);
    expect(ev.triggered).toEqual([{ rule: "No codename", step: 1, effect: "reply rejected" }]);
    expect(ev.changes).toEqual([{ step: 1, rule: "No codename", what: "a reply (try 1) was rejected and the tool was asked again" }]);
  });

  it("render is deterministic", () => {
    const { human_text: _h, ...rest } = sessionArtifact("Same.") as SessionArtifact;
    void _h;
    expect(renderArtifactText(rest)).toBe(renderArtifactText(rest));
  });
});

describe("honest status", () => {
  const s = (o: Record<string, unknown>) => honestStatus({ kind: "session", status: "running", artifact: null, ...o } as never);
  const t = (o: Record<string, unknown>) => honestStatus({ kind: "task", status: "running", artifact: null, ...o } as never);

  it("Completed needs a valid final artifact; the reason is empty only for Completed", () => {
    const ok = s({ status: "completed", artifact: sessionArtifact() });
    expect(ok).toMatchObject({ key: "completed", label: "Completed", reason: null });
  });

  it("completed with a missing or invalid artifact is Failed and says why", () => {
    for (const artifact of [null, undefined, {}, { ...sessionArtifact(), final_output: "" }, "x"]) {
      const r = s({ status: "completed", artifact });
      expect(r.key).toBe("failed");
      expect(r.reason).toMatch(/^Recorded as completed, but it is not accepted: /);
    }
    expect(t({ status: "completed", artifact: sessionArtifact() }).key).toBe("failed");
    expect(t({ status: "completed", artifact: taskArtifact() }).key).toBe("completed");
  });

  it("maps every raw session status to one of the labels with a reason", () => {
    const cases: [string, string][] = [
      ["queued", "Queued"], ["running", "Running"], ["awaiting_human", "Waiting for human"], ["failed", "Failed"],
      ["rejected", "Stopped"], ["stopped", "Stopped"], ["cancelled", "Stopped"], ["skipped", "Stopped"], ["mystery", "Failed"],
    ];
    for (const [raw, label] of cases) {
      const r = s({ status: raw });
      expect(r.label).toBe(label);
      expect(r.reason && r.reason.length > 3).toBe(true);
    }
  });

  it("uses the stored reason and keeps it short and a sentence", () => {
    const r = s({ status: "rejected", stop_reason: "The final result breaks No codename, so it was not released" });
    expect(r.reason).toBe("The final result breaks No codename, so it was not released.");
    expect(s({ status: "failed", stop_reason: "x".repeat(900) }).reason!.length).toBeLessThanOrEqual(262);
  });

  it("a Task that ended after some steps completed is Partially completed; with none it is Failed or Stopped", () => {
    expect(t({ status: "failed", steps_done: 1, steps_total: 3, failed_leg: 2, stop_reason: "Step 2 broke a rule" })).toMatchObject({ key: "partial", reason: "1 of 3 steps completed. Step 2 broke a rule." });
    expect(t({ status: "cancelled", steps_done: 2, steps_total: 3 }).key).toBe("partial");
    // All steps finished but the Task did not complete (its final result could not be verified): Failed, not partial.
    expect(t({ status: "failed", steps_done: 3, steps_total: 3, stop_reason: "Every step finished, but the Task's final result could not be verified." })).toMatchObject({ key: "failed" });
    expect(t({ status: "failed", steps_done: 0, steps_total: 3, stop_reason: "The tool answered HTTP 503" }).key).toBe("failed");
    expect(t({ status: "failed", steps_done: 0, steps_total: 3, root_status: "rejected", stop_reason: "A rule" }).key).toBe("stopped");
    expect(t({ status: "cancelled", steps_done: 0, steps_total: 3 }).key).toBe("stopped");
  });

  it("running carries the current step; waiting carries what the person must do", () => {
    expect(t({ status: "running", current_leg: 2, steps_total: 3, steps_done: 1 }).reason).toBe("Step 2 of 3 is running; 1 done.");
    expect(s({ status: "awaiting_human", waiting_for: "Waiting for your answer to the tool's question" }).reason).toBe("Waiting for your answer to the tool's question.");
    expect(s({ status: "running", step_count: 2, max_steps: 5 }).live).toBe(true);
  });
});

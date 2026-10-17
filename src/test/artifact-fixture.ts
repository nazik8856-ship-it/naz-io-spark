// Valid final artifacts for UI tests, built with the same builders the edge functions use.
import { buildSessionArtifact, buildTaskArtifact, type ArtifactCriterion } from "@/lib/outer-control-artifact";

const SHA = "a".repeat(64);
const CRITERIA: ArtifactCriterion[] = [
  { id: "tool_finished", label: "The tool reported the work as done", ok: true, detail: "the tool said done" },
  { id: "output_stored", label: "The stored result was read back and matches", ok: true, detail: "stored and read back identically" },
];

export function sessionArtifact(text = "Returns take thirty days.", over: { id?: string; changes?: boolean } = {}) {
  const r = buildSessionArtifact({
    id: over.id ?? "s1", taskId: null, objective: "Answer the return question", tool: "Research Bot", completedAt: "2026-10-17T00:00:00Z",
    finalText: text, sha256: SHA,
    checklist: { passed: true, outcome: "completed", summary: "Completion check passed: all 2 criteria met.", criteria: CRITERIA, output_sha256: SHA },
    steps: over.changes
      ? [{ step_no: 1, attempt: 1, verdict: "modify", decision: { applied: ["Secrets"], changes: [{ name: "Secrets", count: 2 }] } }]
      : [{ step_no: 1, attempt: 1, verdict: "allow", decision: { applied: [], changes: [] } }],
    rulesInForce: [{ name: "Secrets", action: "remove_text" }], decidedBy: "tool",
  });
  if (r.ok !== true) throw new Error("fixture: session artifact did not build");
  return r.artifact;
}

export function taskArtifact(text = "Dear Dana, returns take thirty days.") {
  const leg = sessionArtifact(text);
  const r = buildTaskArtifact({
    id: "w1", request: "Reply to Dana", origin: null, completedAt: "2026-10-17T00:00:00Z",
    legs: [{ leg_no: 1, tool: "Research Bot", status: "completed", artifact: leg }], finalLeg: 1, handoffs: [],
  });
  if (r.ok !== true) throw new Error("fixture: task artifact did not build");
  return r.artifact;
}

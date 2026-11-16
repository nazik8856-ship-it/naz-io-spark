// Research with a challenger (docs/outer-control-context.md): the challenge is a source, word for word, marked as the challenge, and it
// is never counted as a second answer.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportView from "@/components/control/outer/ReportView";
import { answersOf, composeReportText, isReportDoc, isSingleSource, singleSourceLine, type ReportDoc } from "@/lib/outer-control-report-doc";
import { reportToDoc } from "@/lib/outer-control-result-doc";
import { proofTiles } from "@/lib/outer-control-task-progress";

const op = (n: number, tool: string, text: string) => ({ n, tool, text, shortened: false, sha256: String(n).repeat(64), at: "2026-11-16T09:00:00Z" });
const two: ReportDoc = {
  version: 1, kind: "research", topic: "Ways to evaluate AI safety", compiled_at: "2026-11-16T09:05:00Z", summary: "Two approaches [1][2].",
  opinions: [op(1, "ChatGPT", "Red-teaming."), op(2, "Claude", "Benchmarks."), op(3, "Claude", "Missing: cost for a 3-person startup.")],
  agreements: [], differences: [], conclusion: "Price both [1][2][3].", points: ["Red-teaming [1]."], open_questions: ["Cost [3]."], challenge: 3,
};

describe("the challenger in a research result", () => {
  it("is valid only when it points at a real source; it is not an answer", () => {
    expect(isReportDoc(two)).toBe(true);
    expect(isReportDoc({ ...two, challenge: 9 })).toBe(false);
    expect(answersOf(two).map((o) => o.n)).toEqual([1, 2]);
    expect(isSingleSource(two)).toBe(false);
  });

  it("is marked as the challenge in the text, the files and on the screen", () => {
    const t = composeReportText(two);
    expect(t).toContain("[3] Claude (challenge) — received");
    expect(t).toContain("Then Claude [3] was given those checked answers and asked to challenge them for your situation");
    expect(reportToDoc(two).sections.find((s) => s.key === "sources")!.blocks.map((b) => (b as { by: string }).by)[2]).toMatch(/^\[3\] Claude \(challenge\) ·/);
    render(<ReportView doc={two} />);
    expect(screen.getAllByTestId("report-challenge-badge")).toHaveLength(1);
  });

  it("one answer plus its challenge is still a single source, and says it was challenged", () => {
    const one: ReportDoc = { ...two, opinions: [op(1, "ChatGPT", "Red-teaming."), op(2, "ChatGPT", "Missing: cost.")], challenge: 2 };
    expect(isSingleSource(one)).toBe(true);
    expect(singleSourceLine(one)).toBe("Single source: only ChatGPT answered. ChatGPT challenged that answer, but no second answer cross-checked it. Ask a second tool before relying on it.");
  });

  it("the Tools used tile names the challenger", () => {
    const art = {
      version: 1, kind: "task", id: "w", request: "r", origin: null, completed_at: "2026-11-16T09:06:00Z", final_output: composeReportText(two), final_step: 4, output_sha256: "f".repeat(64), report: two,
      proof: { steps_total: 4, steps_done: 4, all_checklists_passed: true, steps: [
        { step: 1, tool: "ChatGPT", status: "completed", output_sha256: null }, { step: 2, tool: "Claude", status: "completed", output_sha256: null },
        { step: 3, tool: "Claude", status: "completed", output_sha256: null }, { step: 4, tool: "NazAI report writer", status: "completed", output_sha256: null },
      ] },
      handoffs: [], rules: { in_force: [], triggered: [] }, changes: [], human_text: "x",
    };
    expect(proofTiles(art as never).find((t) => t.key === "tools")!.text).toContain("Claude challenged the answers.");
  });
});

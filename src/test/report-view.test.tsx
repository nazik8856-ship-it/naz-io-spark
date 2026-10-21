import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FinalArtifactView from "@/components/control/outer/FinalArtifactView";
import ReportView from "@/components/control/outer/ReportView";
import { buildSessionArtifact } from "@/lib/outer-control-artifact";
import { composeReportText, isReportDoc, reportHtml, type ReportDoc } from "@/lib/outer-control-report-doc";

const doc: ReportDoc = {
  version: 1, topic: "Should a company put a control layer between its AI tools and its customers?", compiled_at: "2026-10-18T02:17:00Z",
  summary: "Both sources favour a control layer [1][2].",
  opinions: [
    { n: 1, tool: "ChatGPT (OpenAI)", text: "Yes. Rules apply to every answer.\n\nThe cost is some latency.", shortened: false, sha256: "69dc3280663ba0de".padEnd(64, "a"), at: "2026-10-18T02:17:04Z" },
    { n: 2, tool: "Claude (Anthropic)", text: "Yes, if it is auditable.", shortened: true, sha256: "a1b2c3d4e5f60718".padEnd(64, "b"), at: "2026-10-18T02:17:09Z" },
  ],
  agreements: ["Rules should be reviewable [1][2]."], differences: [], conclusion: "Add the layer and keep it auditable [1][2].",
};
const art = (text: string, report: ReportDoc | null) => {
  const sha = "c".repeat(64);
  const r = buildSessionArtifact({
    id: "abcdef12-0000", taskId: null, objective: "Write the final report", tool: "NazAI report writer", completedAt: "2026-10-18T02:18:00Z", finalText: text, sha256: sha,
    checklist: { passed: true, outcome: "completed", summary: "ok", criteria: [{ id: "a", label: "a", ok: true, detail: "d" }], output_sha256: sha },
    steps: [], rulesInForce: [], decidedBy: "tool", report,
  });
  if (r.ok !== true) throw new Error("fixture");
  return r.artifact;
};

describe("the report as text", () => {
  it("is clean: no markdown marks, capital headings, bullets, the opinions word for word", () => {
    const t = composeReportText(doc);
    expect(t.startsWith("NAZAI REPORT\nShould a company put")).toBe(true);
    expect(t).toMatch(/SUMMARY\nBoth sources favour/);
    expect(t).toMatch(/\[1\] ChatGPT \(OpenAI\) — received 18 Oct 2026, 02:17 UTC\nYes\. Rules apply to every answer\.\n\nThe cost is some latency\./);
    expect(t).toMatch(/\(Shortened for the report; the full controlled answer is stored in its step\.\)/);
    expect(t).toMatch(/WHERE THEY AGREE\n• Rules should be reviewable/);
    expect(t).toMatch(/WHERE THEY DIFFER\n• No differences were identified\./);
    expect(/^(#|>|\|)/m.test(t)).toBe(false);
  });
  it("the downloadable page is a complete, escaped, NazAI-styled document", () => {
    const h = reportHtml({ ...doc, topic: "A <script>alert(1)</script> topic" });
    expect(h.startsWith("<!doctype html>")).toBe(true);
    expect(h).toMatch(/NAZAI REPORT/);
    expect(h).not.toMatch(/<script>alert/);
    expect(h).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    expect(h).toMatch(/@media print/);
    expect(h).toMatch(/Claude \(Anthropic\)/);
  });
});

describe("ReportView", () => {
  it("lays out title, summary, each source, agreements, differences, conclusion and how it was made", () => {
    render(<ReportView doc={doc} />);
    expect(screen.getByTestId("report-title").textContent).toBe(doc.topic);
    expect(screen.getByTestId("report-summary").textContent).toMatch(/Both sources favour/);
    expect(screen.getAllByTestId("report-opinion").map((e) => e.textContent)).toEqual([
      expect.stringMatching(/ChatGPT \(OpenAI\)[\s\S]*Yes\. Rules apply/),
      expect.stringMatching(/Claude \(Anthropic\)[\s\S]*Shortened for the report/),
    ]);
    expect(screen.getByTestId("report-differ").textContent).toMatch(/No differences were identified\./);
    expect(screen.getByTestId("report-conclusion").textContent).toMatch(/keep it auditable/);
    expect(screen.getByTestId("report-method").textContent).toMatch(/word for word/);
    expect(screen.getByText(/Every answer rule-checked/)).toBeTruthy();
    expect(screen.getByText("2 sources")).toBeTruthy();
  });
});

describe("FinalArtifactView with a report", () => {
  it("shows the designed report when the stored result is exactly that report, and offers the report download", () => {
    render(<FinalArtifactView artifact={art(composeReportText(doc), doc)} kind="session" />);
    expect(screen.getByTestId("report-view")).toBeTruthy();
    expect(screen.queryByTestId("final-artifact-output")).toBeNull();
    expect(screen.getByTestId("download-result").textContent).toMatch(/Download report/);
  });
  it("falls back to the plain result when the stored text no longer equals the report (a rule changed it)", () => {
    render(<FinalArtifactView artifact={art(composeReportText(doc).replace("latency", "[REDACTED:secret]"), doc)} kind="session" />);
    expect(screen.queryByTestId("report-view")).toBeNull();
    expect(screen.getByTestId("final-artifact-output").textContent).toMatch(/\[REDACTED:secret\]/);
  });
  it("an artifact whose report section is not a valid report is not valid at all", () => {
    const bad = { ...art(composeReportText(doc), doc), report: { version: 1, topic: 5 } };
    const { container } = render(<FinalArtifactView artifact={bad} kind="session" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the other multi-tool results: comparison, fact-check, rewrite", () => {
  const compare: ReportDoc = {
    ...doc, kind: "compare", topic: "Write a two-line description of a water bottle.", summary: "Both are short; source 2 is warmer [1][2].",
    comparison: [{ aspect: "Tone", points: ["Neutral [1].", "Warm [2]."] }, { aspect: "Length", points: ["Two lines.", "Not covered"] }],
  };
  const fact: ReportDoc = {
    ...doc, kind: "factcheck", topic: "The Eiffel Tower is in Berlin.", verdict: "not supported", summary: "It is in Paris [1].",
    findings: ["Source 1 places it in Paris [1]."], corrections: ["The Eiffel Tower is in Paris [1]."], agreements: [], differences: [],
  };
  const rewrite: ReportDoc = {
    ...doc, opinions: [doc.opinions[0]], kind: "rewrite", topic: "Rewrite in More formal, Simpler", summary: "2 versions.", agreements: [], differences: [], conclusion: "",
    original: "Your order has shipped.", styles: ["More formal", "Simpler"],
    versions: [{ n: 1, style: "More formal", text: "Your order has been dispatched." }, { n: 1, style: "Simpler", text: "It shipped." }],
  };

  it("each is a valid document and its text says what kind it is", () => {
    for (const d of [compare, fact, rewrite]) expect(isReportDoc(d)).toBe(true);
    expect(isReportDoc({ ...fact, verdict: "maybe" })).toBe(false);
    expect(isReportDoc({ ...compare, kind: "poem" })).toBe(false);
    expect(isReportDoc({ ...compare, comparison: [{ aspect: "x", points: [1] }] })).toBe(false);
    expect(composeReportText(compare)).toMatch(/^NAZAI COMPARISON\n[\s\S]*SIDE BY SIDE\n\nTone\n• \[1\] ChatGPT \(OpenAI\): Neutral \[1\]\.\n• \[2\] Claude \(Anthropic\): Warm \[2\]\.[\s\S]*HOW THIS COMPARISON WAS MADE/);
    expect(composeReportText(fact)).toMatch(/^NAZAI FACT-CHECK\n[\s\S]*VERDICT\nNot supported\. It is in Paris \[1\]\.\n\nFINDINGS\n• Source 1 places it in Paris[\s\S]*CORRECTIONS\n• The Eiffel Tower is in Paris/);
    expect(composeReportText(rewrite)).toMatch(/^NAZAI REWRITE\n[\s\S]*ORIGINAL\nYour order has shipped\.\n\nSTYLE: MORE FORMAL — by ChatGPT \(OpenAI\) \[1\]\nYour order has been dispatched\.\n\nSTYLE: SIMPLER/);
  });

  it("the downloadable pages lay each kind out: a table, a verdict, the versions", () => {
    expect(reportHtml(compare)).toMatch(/NAZAI COMPARISON[\s\S]*<table>[\s\S]*<th>Tone<\/th><td>Neutral \[1\]\.<\/td><td>Warm \[2\]\.<\/td>/);
    expect(reportHtml(fact)).toMatch(/NAZAI FACT-CHECK[\s\S]*class="verdict">Not supported</);
    expect(reportHtml(rewrite)).toMatch(/NAZAI REWRITE[\s\S]*Original[\s\S]*More formal[\s\S]*Your order has been dispatched/);
  });

  it("the app shows each kind designed", () => {
    const { unmount } = render(<ReportView doc={compare} />);
    expect(screen.getByTestId("report-view").getAttribute("data-kind")).toBe("compare");
    expect(screen.getByTestId("report-comparison").textContent).toMatch(/Tone.*Neutral \[1\]\..*Warm \[2\]\./);
    unmount();
    const f = render(<ReportView doc={fact} />);
    expect(screen.getByTestId("report-verdict").textContent).toMatch(/Not supported/);
    expect(screen.getByTestId("report-corrections").textContent).toMatch(/Paris/);
    f.unmount();
    render(<ReportView doc={rewrite} />);
    expect(screen.getAllByTestId("report-version").map((v) => v.textContent)).toEqual([expect.stringMatching(/More formal.*Your order has been dispatched/), expect.stringMatching(/Simpler.*It shipped/)]);
    expect(screen.getByTestId("report-method").textContent).toMatch(/How this rewrite was made/);
  });

  it("the final result shows the designed view only when the stored text is exactly the document", () => {
    render(<FinalArtifactView artifact={art(composeReportText(fact), fact)} kind="session" />);
    expect(screen.getByTestId("report-verdict")).toBeTruthy();
  });
});

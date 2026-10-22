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

describe("the ten new results", () => {
  const base = { ...doc, agreements: [], differences: [], conclusion: "" };
  const one = [doc.opinions[0]];
  const docs: Record<string, ReportDoc> = {
    research: { ...base, kind: "research", topic: "AI safety evaluation", summary: "Two approaches dominate [1][2].", points: ["Red-teaming finds failures [1].", "Benchmarks are cheap [2]."], open_questions: ["How to compare them is unsettled."], conclusion: "Use both [1][2]." },
    draft: { ...base, kind: "draft", topic: "A launch email", summary: "", output: "Hello! Our app is live." },
    alternatives: { ...base, opinions: one, kind: "alternatives", topic: "Names for a budgeting app", summary: "", items: [{ n: 1, label: "Penny", text: "Short and friendly." }, { n: 1, label: "Ledgerly", text: "Sounds serious." }] },
    explain: { ...base, opinions: one, kind: "explain", topic: "Explain simply", summary: "", original: "Entanglement links particles.", output: "Two coins that always land the same way." },
    keypoints: { ...base, opinions: one, kind: "keypoints", topic: "Key points", summary: "", original: "A long memo.", points: ["Budget is cut.", "Launch moves to May."] },
    roles: { ...base, opinions: one, kind: "roles", topic: "Launch without terms?", summary: "", original: "Is it safe to launch without terms of service?", styles: ["Lawyer"], versions: [{ n: 1, style: "Lawyer", text: "No; you carry the liability." }] },
    multistep: { ...base, kind: "multistep", topic: "Open a café", summary: "Three steps [1][2].", items: [{ n: 1, label: "Find a place", text: "Rent near a station." }, { n: 2, label: "Budget", text: "About 40k." }], output: "Rent near a station with a 40k budget [1][2]." },
    decision: { ...base, kind: "decision", topic: "Hire or ads?", summary: "Both have merit [1][2].", decision: [{ option: "Hire", pros: ["Builds product"], cons: ["Costly"] }, { option: "Ads", pros: ["Fast"], cons: [] }], conclusion: "Hire first [1].", risks: ["Runway gets shorter."] },
    adapt: { ...base, opinions: one, kind: "adapt", topic: "Our app is live", summary: "", original: "Our app is live.", styles: ["LinkedIn"], versions: [{ n: 1, style: "LinkedIn", text: "Proud to share that our app is live." }] },
    delegate: { ...base, kind: "delegate", topic: "Launch plan", summary: "Two parts combined [1][2].", items: [{ n: 1, label: "Copy", text: "Headline." }, { n: 2, label: "Schedule", text: "Monday." }], output: "Post the headline on Monday [1][2]." },
  };

  it("each is a valid document; a broken new field makes it invalid", () => {
    for (const d of Object.values(docs)) expect(isReportDoc(d)).toBe(true);
    expect(isReportDoc({ ...docs.research, points: [1] })).toBe(false);
    expect(isReportDoc({ ...docs.alternatives, items: [{ n: "1", label: "x", text: "y" }] })).toBe(false);
    expect(isReportDoc({ ...docs.decision, decision: [{ option: "x", pros: "y", cons: [] }] })).toBe(false);
    expect(isReportDoc({ ...docs.explain, output: 5 })).toBe(false);
  });

  it("the text of each says what it is, with clean headings", () => {
    const t = (k: string) => composeReportText(docs[k]);
    expect(t("research")).toMatch(/^NAZAI RESEARCH\n[\s\S]*KEY POINTS\n• Red-teaming[\s\S]*OPEN QUESTIONS\n• How to compare[\s\S]*ANSWERS BY SOURCE/);
    expect(t("draft")).toMatch(/^NAZAI DRAFT\n[\s\S]*FINAL VERSION\nHello! Our app is live\.[\s\S]*Drafted by ChatGPT \(OpenAI\) \[1\], improved by Claude \(Anthropic\) \[2\]/);
    expect(t("alternatives")).toMatch(/^NAZAI ALTERNATIVES\n[\s\S]*OPTION 1: Penny — by ChatGPT \(OpenAI\) \[1\]\nShort and friendly\.[\s\S]*OPTION 2: Ledgerly/);
    expect(t("explain")).toMatch(/^NAZAI EXPLANATION\n[\s\S]*SIMPLE EXPLANATION — by ChatGPT \(OpenAI\) \[1\]\nTwo coins/);
    expect(t("keypoints")).toMatch(/^NAZAI KEY POINTS\n[\s\S]*KEY POINTS — by ChatGPT \(OpenAI\) \[1\]\n• Budget is cut\.\n• Launch moves to May\./);
    expect(t("roles")).toMatch(/^NAZAI ROLE ANSWERS\n[\s\S]*QUESTION\nIs it safe[\s\S]*ROLE: LAWYER — by ChatGPT \(OpenAI\) \[1\]\nNo; you carry the liability\./);
    expect(t("multistep")).toMatch(/^NAZAI SOLUTION\n[\s\S]*STEP 1: Find a place — by ChatGPT \(OpenAI\) \[1\][\s\S]*SOLUTION\nRent near a station with a 40k budget/);
    expect(t("decision")).toMatch(/^NAZAI DECISION\n[\s\S]*OPTIONS\n\nHire\nPros:\n• Builds product\nCons:\n• Costly\n\nAds\nPros:\n• Fast\nCons:\n• None given\.[\s\S]*RECOMMENDATION\nHire first \[1\]\.[\s\S]*RISKS\n• Runway gets shorter\./);
    expect(t("adapt")).toMatch(/^NAZAI ADAPTATION\n[\s\S]*MESSAGE\nOur app is live\.[\s\S]*FOR: LINKEDIN — by ChatGPT \(OpenAI\) \[1\]/);
    expect(t("delegate")).toMatch(/^NAZAI DELEGATED TASK\n[\s\S]*PART 1: Copy — by ChatGPT \(OpenAI\) \[1\][\s\S]*PART 2: Schedule — by Claude \(Anthropic\) \[2\][\s\S]*FINAL RESULT\nPost the headline/);
    for (const d of Object.values(docs)) expect(/^(#|>|\|)/m.test(composeReportText(d))).toBe(false);
  });

  it("each downloadable page is complete and escaped", () => {
    for (const d of Object.values(docs)) {
      const h = reportHtml({ ...d, topic: "<b>x</b>" });
      expect(h.startsWith("<!doctype html>")).toBe(true);
      expect(h).not.toMatch(/<b>x<\/b>/);
    }
    expect(reportHtml(docs.decision)).toMatch(/NAZAI DECISION[\s\S]*Hire[\s\S]*Builds product[\s\S]*Runway gets shorter/);
  });

  it("the app shows each one designed", () => {
    const show = (k: string) => render(<ReportView doc={docs[k]} />);
    let r = show("research");
    expect(screen.getByTestId("report-view").getAttribute("data-kind")).toBe("research");
    expect(screen.getByTestId("report-points").textContent).toMatch(/Red-teaming/);
    expect(screen.getByTestId("report-open").textContent).toMatch(/unsettled/);
    r.unmount();
    r = show("draft");
    expect(screen.getByTestId("report-output").textContent).toMatch(/Our app is live/);
    expect(screen.getByTestId("report-draft-credit").textContent).toMatch(/Drafted by ChatGPT \(OpenAI\) \[1\], improved by Claude \(Anthropic\) \[2\]/);
    r.unmount();
    r = show("alternatives");
    expect(screen.getAllByTestId("report-item").map((e) => e.textContent)).toEqual([expect.stringMatching(/Penny/), expect.stringMatching(/Ledgerly/)]);
    expect(screen.queryByTestId("report-output")).toBeNull();
    r.unmount();
    r = show("explain");
    expect(screen.getByTestId("report-output").textContent).toMatch(/Two coins/);
    r.unmount();
    r = show("keypoints");
    expect(screen.getByTestId("report-output").textContent).toMatch(/Budget is cut[\s\S]*Launch moves to May/);
    r.unmount();
    r = show("roles");
    expect(screen.getByTestId("report-version").textContent).toMatch(/Lawyer[\s\S]*liability/);
    r.unmount();
    r = show("multistep");
    expect(screen.getAllByTestId("report-item").length).toBe(2);
    expect(screen.getByTestId("report-output").textContent).toMatch(/40k budget/);
    r.unmount();
    r = show("decision");
    expect(screen.getAllByTestId("report-option").map((e) => e.textContent)).toEqual([expect.stringMatching(/Hire[\s\S]*Builds product[\s\S]*Costly/), expect.stringMatching(/Ads[\s\S]*Fast/)]);
    expect(screen.getByTestId("report-conclusion").textContent).toMatch(/Hire first/);
    expect(screen.getByTestId("report-risks").textContent).toMatch(/Runway/);
    r.unmount();
    r = show("adapt");
    expect(screen.getByTestId("report-version").textContent).toMatch(/LinkedIn[\s\S]*Proud to share/);
    r.unmount();
    show("delegate");
    expect(screen.getAllByTestId("report-item").length).toBe(2);
    expect(screen.getByTestId("report-output").textContent).toMatch(/Post the headline on Monday/);
  });

  it("the final result shows the designed view and names the download after the kind", () => {
    render(<FinalArtifactView artifact={art(composeReportText(docs.decision), docs.decision)} kind="session" />);
    expect(screen.getByTestId("report-decision")).toBeTruthy();
    expect(screen.getByTestId("download-result").textContent).toMatch(/Download decision support/);
  });
});

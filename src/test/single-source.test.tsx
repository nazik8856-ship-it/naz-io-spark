// One tool answered an action that is meant to compare sources: the result says so, everywhere, and does not pretend to compare.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportView from "@/components/control/outer/ReportView";
import { composeReportText, isReportDoc, isSingleSource, REPORT_INTRO, SINGLE_SOURCE_KINDS, singleSourceLine, type ReportDoc } from "@/lib/outer-control-report-doc";
import { reportToDoc } from "@/lib/outer-control-result-doc";

const one = { n: 1, tool: "ChatGPT", text: "Start with a German-language Etsy shop; VAT registration is needed above 10,000 EUR of EU sales.", shortened: false, sha256: "a".repeat(64), at: "2026-11-15T02:00:00Z" };
const two = { ...one, n: 2, tool: "Claude", sha256: "b".repeat(64) };
const base: ReportDoc = { version: 1, topic: "How to start selling candles in Germany", compiled_at: "2026-11-15T02:01:00Z", summary: "One source answered [1].", opinions: [one], agreements: [], differences: [], conclusion: "Start on Etsy [1]." };

describe("which results are single-source", () => {
  it("one answer on opinions, research, fact-check or decision; never compare (it needs two) and never the one-tool actions", () => {
    expect([...SINGLE_SOURCE_KINDS]).toEqual(["opinions", "research", "factcheck", "decision"]);
    for (const kind of ["opinions", "research", "factcheck", "decision"] as const) expect(isSingleSource({ ...base, kind })).toBe(true);
    expect(isSingleSource(base)).toBe(true); // an opinions report has no kind field
    for (const kind of ["rewrite", "explain", "keypoints", "draft", "alternatives", "adapt", "roles"] as const) expect(isSingleSource({ ...base, kind })).toBe(false);
    expect(isSingleSource({ ...base, opinions: [one, two] })).toBe(false);
  });

  it("the line names the tool and says what to do", () => {
    expect(singleSourceLine(base)).toBe("Single source: only ChatGPT answered, so nothing here was cross-checked. Ask a second tool to compare before relying on it.");
  });
});

describe("the stored text", () => {
  it("a report made with the flag says it at the top and leaves out agree / differ", () => {
    const t = composeReportText({ ...base, single_source: true });
    expect(REPORT_INTRO({ ...base, single_source: true })).toContain("Single source: only ChatGPT answered");
    expect(t).toContain("Single source: only ChatGPT answered");
    expect(t).not.toContain("WHERE THEY AGREE");
    expect(t).not.toContain("WHERE THEY DIFFER");
    expect(t).toContain("CONCLUSION\nStart on Etsy [1].");
  });

  it("a report made before the flag keeps exactly the text it was stored with", () => {
    const t = composeReportText(base);
    expect(t).not.toContain("Single source");
    expect(t).toContain("WHERE THEY AGREE");
  });

  it("the flag is part of a valid report and must be a yes or no", () => {
    expect(isReportDoc({ ...base, single_source: true })).toBe(true);
    expect(isReportDoc({ ...base, single_source: "yes" })).toBe(false);
  });
});

describe("what the person sees", () => {
  it("the page shows the warning at the top and no empty agree / differ boxes", () => {
    render(<ReportView doc={base} />);
    expect(screen.getByTestId("report-single-source").textContent).toContain("only ChatGPT answered, so nothing here was cross-checked");
    expect(screen.queryByTestId("report-agree")).toBeNull();
    expect(screen.queryByTestId("report-differ")).toBeNull();
  });

  it("with two sources there is no warning and the comparison is there", () => {
    render(<ReportView doc={{ ...base, opinions: [one, two], agreements: ["Etsy first [1][2]."] }} />);
    expect(screen.queryByTestId("report-single-source")).toBeNull();
    expect(screen.getByTestId("report-agree")).toBeTruthy();
  });

  it("every look and file says it too, an older report included, and has no agree / differ sections", () => {
    for (const d of [base, { ...base, single_source: true }]) {
      const r = reportToDoc(d);
      expect(r.meta).toContain("Single source: only ChatGPT answered");
      expect((r.meta.match(/Single source/g) ?? []).length).toBe(1);
      expect(r.sections.map((s) => s.title)).not.toContain("Where they agree");
      expect(r.sections.map((s) => s.title)).not.toContain("Where they differ");
    }
  });
});

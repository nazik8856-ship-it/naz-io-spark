import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportView from "@/components/control/outer/ReportView";
import { composeReportText, isReportDoc, reportHtml, type ReportDoc } from "@/lib/outer-control-report-doc";
import { reportToDoc } from "@/lib/outer-control-result-doc";
import { toMarkdown } from "@/lib/outer-control-files";

// Decision-ready final result (Day 3, #154): the bottom line first, the person's steps in the order to do them, what to watch out for.
const AT = "2026-11-17T09:00:00.000Z";
const op = (n: number, tool: string, text: string) => ({ n, tool, text, shortened: false, sha256: String(n).repeat(64).slice(0, 64), at: AT });
const DOC: ReportDoc = {
  version: 1, kind: "research", topic: "How should a small AI startup get its first 10 paying customers?", compiled_at: AT,
  summary: "Start narrow and sell by hand [1].", agreements: [], differences: [], conclusion: "Sell by hand to one group first [1][2].",
  points: ["Agency owners buy fastest [1]."], open_questions: [], challenge: 2,
  opinions: [op(1, "NazAI Writer", "Call 40 agencies."), op(2, "NazAI Reviewer", "Challenge: the MVP timeline.")],
  bottom_line: "Sell to 5-20 person agencies in Vienna first, at 49 EUR for the first month [1][2].",
  implications: [
    { step: "This week, list 40 agencies from the WKO directory [1]", basis: "situation", why: "1 person, 200 EUR a month" },
    { step: "Book 8 setup calls in the next 2 weeks [1]", basis: "assumption", why: "you can take calls in working hours" },
  ],
  ordered: true,
  watch_out: ["A 4-week launch leaves no time for a second round of calls [2]."],
};

describe("decision-ready result", () => {
  it("is a valid report; old reports without the fields stay valid and unchanged", () => {
    expect(isReportDoc(DOC)).toBe(true);
    expect(isReportDoc({ ...DOC, watch_out: [1] })).toBe(false);
    const { bottom_line: _b, watch_out: _w, ordered: _o, ...old } = DOC;
    expect(composeReportText(old as ReportDoc)).not.toMatch(/BOTTOM LINE|WATCH OUT|WHAT TO DO FIRST/);
    expect(composeReportText(old as ReportDoc)).toMatch(/WHAT THIS MEANS FOR YOU\n• This week/);
  });

  it("text: the bottom line comes first, the steps are numbered, then what to watch out for", () => {
    const t = composeReportText(DOC);
    expect(t.indexOf("BOTTOM LINE")).toBeLessThan(t.indexOf("SUMMARY"));
    expect(t).toMatch(/WHAT TO DO FIRST\n1\. This week, list 40 agencies.*\n2\. Book 8 setup calls/);
    expect(t).toMatch(/WATCH OUT\n• A 4-week launch/);
    expect(t).toMatch(/The bottom line and what to watch out for were written by NazAI's AI/);
  });

  it("on screen: bottom line on top, numbered steps, watch out", () => {
    render(<ReportView doc={DOC} />);
    const bl = screen.getByTestId("report-bottom-line");
    expect(bl.textContent).toMatch(/Bottom line.*Sell to 5-20 person agencies in Vienna/);
    expect(screen.getByTestId("report-for-you").textContent).toMatch(/^What to do first1This week/);
    expect(screen.getByTestId("report-watch-out").textContent).toMatch(/Watch out.*4-week launch/);
    expect(bl.compareDocumentPosition(screen.getByTestId("report-for-you")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("in the looks and files: bottom line first, steps as a numbered list", () => {
    const html = reportHtml(DOC);
    expect(html.indexOf("Bottom line")).toBeLessThan(html.indexOf(">Summary<"));
    expect(html).toMatch(/<h2>What to do first<\/h2><ol><li>This week/);
    const doc = reportToDoc(DOC);
    expect(doc.sections[0]).toMatchObject({ key: "lead", title: "Bottom line" });
    expect(doc.sections.find((s) => s.key === "foryou")?.blocks[0]).toMatchObject({ k: "ul", ordered: true });
    for (const id of ["nazai", "executive", "editorial", "brief", "data"] as const) {
      const md = toMarkdown(doc, id);
      expect(md.indexOf("## Bottom line")).toBeGreaterThan(0);
      expect(md.indexOf("## Bottom line")).toBeLessThan(md.indexOf("## Summary"));
    }
    expect(toMarkdown(doc, "nazai")).toMatch(/1\. This week, list 40 agencies/);
  });
});

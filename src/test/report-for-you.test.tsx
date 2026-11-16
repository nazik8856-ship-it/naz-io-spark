// "What this means for you" (docs/outer-control-context.md): next steps tied to the person's own situation, or marked as assumptions,
// shown on the screen, in every look and in every file.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportView from "@/components/control/outer/ReportView";
import { composeReportText, FOR_YOU_TITLE, implicationLine, type ReportDoc } from "@/lib/outer-control-report-doc";
import { reportToDoc, orderSections } from "@/lib/outer-control-result-doc";
import { renderTemplate, TEMPLATE_IDS, TEMPLATE_INFO } from "@/lib/outer-control-templates";
import { toCsv, toMarkdown } from "@/lib/outer-control-files";

const op = (n: number, tool: string) => ({ n, tool, text: "Sell gift sets before December.", shortened: false, sha256: String(n).repeat(64), at: "2026-11-16T09:00:00Z" });
const doc: ReportDoc = {
  version: 1, kind: "research", topic: "Selling candles to gift buyers in Germany", compiled_at: "2026-11-16T09:05:00Z",
  summary: "Both tools point to gift sets [1][2].", opinions: [op(1, "ChatGPT"), op(2, "Claude")], agreements: [], differences: [],
  conclusion: "Start with gift sets [1][2].", points: ["Gift sets sell before December [1]."], open_questions: [],
  implications: [
    { step: "Put a gift-set section at the top of the Etsy shop [1]", basis: "situation", why: "Channels: Etsy, Instagram" },
    { step: "Test a 10% bundle discount for one month [2]", basis: "assumption", why: "your margin allows a 10% discount" },
  ],
};

describe("what this means for you", () => {
  it("each step says what it rests on", () => {
    expect(implicationLine(doc.implications![0])).toBe("Put a gift-set section at the top of the Etsy shop [1] — From your situation: Channels: Etsy, Instagram");
    expect(implicationLine(doc.implications![1])).toBe("Test a 10% bundle discount for one month [2] — Assumption: your margin allows a 10% discount");
  });

  it("the screen shows it under the header, with the basis of each step", () => {
    render(<ReportView doc={doc} />);
    expect(screen.getByTestId("report-for-you")).toHaveTextContent(FOR_YOU_TITLE);
    const items = screen.getAllByTestId("report-implication");
    expect(items.map((i) => i.getAttribute("data-basis"))).toEqual(["situation", "assumption"]);
    expect(items[0]).toHaveTextContent("From your situation: Channels: Etsy, Instagram");
    expect(items[1]).toHaveTextContent("Assumption: your margin allows a 10% discount");
  });

  it("a report without it shows nothing extra", () => {
    const { implications: _x, ...plain } = doc;
    render(<ReportView doc={plain as ReportDoc} />);
    expect(screen.queryByTestId("report-for-you")).toBeNull();
    expect(composeReportText(plain as ReportDoc)).not.toContain("WHAT THIS MEANS FOR YOU");
  });

  it("every look places it near the top, before the sources, and draws it", () => {
    const rd = reportToDoc(doc);
    for (const id of TEMPLATE_IDS) {
      const keys = orderSections(rd, TEMPLATE_INFO[id].order).map((s) => s.key);
      expect(keys.indexOf("foryou"), id).toBeGreaterThan(-1);
      expect(keys.indexOf("foryou"), id).toBeLessThan(keys.indexOf("sources"));
      expect(renderTemplate(rd, id, doc), id).toContain("Put a gift-set section at the top of the Etsy shop [1]");
    }
  });

  it("the files carry it too", () => {
    const rd = reportToDoc(doc);
    expect(toMarkdown(rd, "nazai")).toContain(FOR_YOU_TITLE);
    expect(toMarkdown(rd, "nazai")).toContain("Assumption: your margin allows a 10% discount");
    expect(toCsv(rd, "executive")).toContain("From your situation: Channels: Etsy, Instagram");
  });
});

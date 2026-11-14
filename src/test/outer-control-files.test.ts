// Outer Control: the looks and the file types (docs/outer-control-outputs.md). A result is one ResultDoc; every look and every file is
// drawn from it. Set NAZAI_DUMP_DIR to write the generated files to disk (to open them in Word, Excel, LibreOffice or a PDF reader).
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isReportDoc, OUTPUT_TEMPLATES, type ReportDoc } from "@/lib/outer-control-report-doc";
import { artifactToDoc, orderSections, reportToDoc, textToDoc } from "@/lib/outer-control-result-doc";
import { DEFAULT_TEMPLATE, detectRequestedOutput, renderTemplate, TEMPLATE_IDS, TEMPLATE_INFO } from "@/lib/outer-control-templates";
import { buildFile, crc32, fileName, pdfCanEncode, rowsOf, toCsv, toDocx, toMarkdown, toPdf, toXlsx, zipStore, type FileKind } from "@/lib/outer-control-files";

const AT = "2026-11-14T10:00:00.000Z";
const op = (n: number, tool: string, text: string) => ({ n, tool, text, shortened: false, sha256: String(n).repeat(64).slice(0, 64), at: AT });

const COMPARE: ReportDoc = {
  version: 1, kind: "compare", topic: "Should we launch a free plan?", compiled_at: AT,
  summary: "Both tools favour a free plan with limits [1][2].", agreements: ["A free plan grows the user base [1][2]."], differences: ["Only [2] mentions support costs <b>rising</b>."],
  conclusion: "Launch a limited free plan and review after 90 days [1][2].",
  opinions: [op(1, "ChatGPT", "Yes. A limited free plan lowers the barrier.\n\nWatch the conversion rate."), op(2, "Claude", "Yes, but cap usage and budget for support.")],
  comparison: [{ aspect: "Recommendation", points: ["Launch a limited free plan", "Launch, with caps"] }, { aspect: "Main risk", points: ["Low conversion", "Support cost"] }],
};
const DECISION: ReportDoc = {
  version: 1, kind: "decision", topic: "Hire an engineer or buy ads?", compiled_at: AT,
  summary: "Hiring builds the product; ads buy speed [1].", agreements: [], differences: [], conclusion: "Hire first; revisit ads once retention is above 40% [1].",
  opinions: [op(1, "ChatGPT", "Hire first.")], risks: ["Runway shrinks by 8 months of salary."],
  decision: [{ option: "Hire", pros: ["Builds product"], cons: ["Costly"] }, { option: "Ads", pros: ["Fast"], cons: [] }],
};
const OPINIONS: ReportDoc = { ...COMPARE, kind: "opinions", comparison: undefined };
const FACTCHECK: ReportDoc = {
  version: 1, kind: "factcheck", topic: "The Eiffel Tower was finished in 1889 and is in Berlin.", compiled_at: AT, verdict: "partly supported",
  summary: "The date is right but the city is wrong [1].", agreements: [], differences: [], findings: ["Finished in 1889 is correct [1]."], corrections: ["It is in Paris, not Berlin [1]."],
  conclusion: "Correct the city [1].", opinions: [op(1, "ChatGPT", "1889 is right; the tower is in Paris.")],
};

const TEXT = "SUMMARY\nReturns are accepted within thirty days.\n\nWHERE IT APPLIES\n- Premium customers: 30 days\n- Standard customers: 14 days\n\nPlain closing line.";

/** Every kind of result, as the model the looks and files share. */
const docs = () => ({
  compare: reportToDoc(COMPARE), decision: reportToDoc(DECISION), opinions: reportToDoc(OPINIONS), factcheck: reportToDoc(FACTCHECK),
  text: textToDoc(TEXT, "Summarise the returns policy"),
});

const dump = process.env.NAZAI_DUMP_DIR;
const save = (name: string, bytes: Uint8Array | string) => { if (!dump) return; mkdirSync(dump, { recursive: true }); writeFileSync(join(dump, name), bytes); };

/** A tiny reader for stored zips: names, and each entry's data with its checksum verified. */
function unzip(zip: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nameLen = dv.getUint16(p + 28, true), local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(dv.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    expect(crc32(data), `checksum of ${name}`).toBe(crc);
    out.set(name, data);
    p += 46 + nameLen;
  }
  return out;
}
const str = (b: Uint8Array) => new TextDecoder().decode(b);
const xmlOk = (xml: string) => { const d = new DOMParser().parseFromString(xml, "application/xml"); expect(d.getElementsByTagName("parsererror").length, xml.slice(0, 200)).toBe(0); return d; };

describe("the looks", () => {
  it("there are five, the server and the page agree on their names, and the original is the default", () => {
    expect(TEMPLATE_IDS).toEqual([...OUTPUT_TEMPLATES]);
    expect(TEMPLATE_IDS.length).toBe(5);
    expect(DEFAULT_TEMPLATE).toBe("nazai");
  });

  it("every look draws every kind of result, with the title and the content, and none of them are the same page", () => {
    const pages = new Map<string, string>();
    for (const [kind, doc] of Object.entries(docs())) {
      for (const id of TEMPLATE_IDS) {
        const html = renderTemplate(doc, id);
        expect(html.startsWith("<!doctype html>"), `${kind}/${id}`).toBe(true);
        expect(html).toContain(doc.title.replace(/&/g, "&amp;"));
        expect(html, `${kind}/${id} is self-contained`).not.toMatch(/<script|src="http|href="http|@import/);
        pages.set(`${kind}/${id}`, html);
      }
      const set = new Set(TEMPLATE_IDS.map((id) => pages.get(`${kind}/${id}`)));
      expect(set.size, `${kind}: five different pages`).toBe(5);
    }
  });

  it("they differ in structure, not only in colour: the order of the sections and the way they are drawn", () => {
    const doc = reportToDoc(COMPARE);
    const first = (id: (typeof TEMPLATE_IDS)[number]) => orderSections(doc, TEMPLATE_INFO[id].order).map((s) => s.key);
    expect(first("executive")[0]).toBe("bottom");   // the answer first
    expect(first("brief")[0]).toBe("bottom");
    expect(first("nazai").at(-2)).toBe("bottom");   // the answer near the end, the method last
    expect(first("editorial")[0]).toBe("summary");
    expect(first("executive").indexOf("sources")).toBeGreaterThan(first("executive").indexOf("contrast")); // sources as an appendix
    const orders = new Set(TEMPLATE_IDS.map((id) => first(id).join(",")));
    expect(orders.size).toBeGreaterThanOrEqual(3);
    // the way they are drawn
    expect(renderTemplate(doc, "executive")).toContain('class="bottom k-bottom"');
    expect(renderTemplate(doc, "editorial")).toContain("In conclusion");
    expect(renderTemplate(doc, "brief")).toContain('class="cols"');
    expect(renderTemplate(doc, "data")).toContain('class="grid');
    // and the palettes are all different
    expect(new Set(TEMPLATE_IDS.map((id) => TEMPLATE_INFO[id].colors.bg + TEMPLATE_INFO[id].colors.accent)).size).toBe(5);
  });

  it("the original look of a report is the report's own page, as it always was", () => {
    const html = renderTemplate(reportToDoc(COMPARE), "nazai", COMPARE);
    expect(isReportDoc(COMPARE)).toBe(true);
    expect(html).toContain("NAZAI COMPARISON");
    expect(html).toContain('<span class="badge">');
  });

  it("text from a tool can not become markup", () => {
    const evil = textToDoc("<script>alert(1)</script>\n- <img src=x onerror=alert(1)>", "<b>x</b>");
    for (const id of TEMPLATE_IDS) {
      const html = renderTemplate(evil, id);
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;script&gt;");
    }
    const html = renderTemplate(reportToDoc(COMPARE), "executive");
    expect(html).toContain("&lt;b&gt;rising&lt;/b&gt;");
  });
});

describe("the result as a model", () => {
  it("a report keeps its sections, its tables and its sources word for word", () => {
    const d = reportToDoc(COMPARE);
    expect(d.title).toBe("Should we launch a free plan?");
    expect(d.sections.map((s) => s.key)).toEqual(["summary", "detail", "sources", "points", "contrast", "bottom", "method"]);
    const table = d.sections.find((s) => s.key === "detail")!.blocks[0];
    expect(table).toMatchObject({ k: "table", head: ["Aspect", "[1] ChatGPT", "[2] Claude"] });
    const quote = d.sections.find((s) => s.key === "sources")!.blocks[0];
    expect(quote).toMatchObject({ k: "quote" });
    expect((quote as { text: string }).text).toContain("Watch the conversion rate.");
    expect(reportToDoc(FACTCHECK).sections[0]).toMatchObject({ key: "bottom", title: "Verdict" });
  });

  it("plain text becomes headed sections, bullets and paragraphs; and a report is only used while the text still is that report", () => {
    const d = textToDoc(TEXT, "Summarise the returns policy");
    expect(d.sections.map((s) => s.title)).toEqual(["Summary", "Where It Applies"]);
    expect(d.sections[1].blocks[0]).toEqual({ k: "ul", items: ["Premium customers: 30 days", "Standard customers: 14 days"] });
    const a = { final_output: "SOMETHING ELSE ENTIRELY", report: COMPARE, request: "q" };
    expect(artifactToDoc(a, isReportDoc).badge).toBe("NAZAI RESULT");
  });
});

describe("files", () => {
  const kinds: FileKind[] = ["docx", "pdf", "xlsx", "csv", "md"];

  it("all five file types are built for every kind of result in every look", () => {
    for (const [kind, doc] of Object.entries(docs())) {
      for (const id of TEMPLATE_IDS) {
        for (const k of kinds) {
          const f = buildFile(k, doc, id, { noun: kind, id: "abcdef123456" }, new Date(AT));
          expect(f, `${k} ${kind}/${id}`).not.toBeNull();
          expect(f!.bytes.length).toBeGreaterThan(200);
          expect(f!.name).toBe(`nazai-${kind}-abcdef12.${k}`);
          save(`${kind}-${id}.${k}`, f!.bytes);
        }
      }
    }
    save("compare-nazai.html", renderTemplate(reportToDoc(COMPARE), "nazai", COMPARE));
    for (const id of TEMPLATE_IDS) save(`compare-${id}.html`, renderTemplate(reportToDoc(COMPARE), id));
  });

  it("file names are plain", () => {
    expect(fileName("set of alternatives", "0123456789", "docx")).toBe("nazai-set-of-alternatives-01234567.docx");
    expect(fileName("***", "abc", "pdf")).toBe("nazai-result-abc.pdf");
  });

  it("zip: every entry's checksum matches, names are kept", () => {
    const z = unzip(zipStore([{ name: "a.txt", data: "hello" }, { name: "dir/b.xml", data: "<x/>" }]));
    expect([...z.keys()]).toEqual(["a.txt", "dir/b.xml"]);
    expect(str(z.get("a.txt")!)).toBe("hello");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("docx: the parts Word needs, well-formed XML, the content and the look's colours", () => {
    const doc = reportToDoc(COMPARE);
    const z = unzip(toDocx(doc, "executive", new Date(AT)));
    expect([...z.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/numbering.xml", "word/styles.xml"]);
    for (const [name, data] of z) xmlOk(str(data));
    const body = str(z.get("word/document.xml")!);
    expect(body).toContain("Should we launch a free plan?");
    expect(body).toContain("Watch the conversion rate.");
    expect(body).toContain("<w:tbl>");                       // the side-by-side is a real table
    expect(body).toContain("&lt;b&gt;rising&lt;/b&gt;");     // escaped, not markup
    expect(body).toContain(`w:fill="${TEMPLATE_INFO.executive.colors.accent.slice(1).toUpperCase()}"`);
    // the look's own order: the conclusion before the sources
    expect(body.indexOf("Conclusion")).toBeLessThan(body.indexOf("Answers by source"));
    // another look, another order and other styles
    const ed = unzip(toDocx(doc, "editorial", new Date(AT)));
    expect(str(ed.get("word/styles.xml")!)).toContain("Times New Roman");
    expect(str(ed.get("word/document.xml")!).indexOf("Answers by source")).toBeGreaterThan(str(ed.get("word/document.xml")!).indexOf("Conclusion"));
  });

  it("docx: control characters never reach the XML", () => {
    const z = unzip(toDocx(textToDoc("a\u0000b\u0008c\nline two", "t\u000B"), "nazai", new Date(AT)));
    const body = str(z.get("word/document.xml")!);
    xmlOk(body);
    expect(body).toContain("abc");
  });

  it("xlsx: workbook, a Result sheet with the header, one extra sheet per table, text never a formula", () => {
    const z = unzip(toXlsx(reportToDoc(COMPARE), "data", new Date(AT)));
    expect([...z.keys()]).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]));
    for (const [, data] of z) xmlOk(str(data));
    const wb = str(z.get("xl/workbook.xml")!);
    expect(wb).toContain('name="Result"');
    expect(wb).toContain('name="Side by side"');
    const s1 = str(z.get("xl/worksheets/sheet1.xml")!);
    for (const h of ["Section", "Type", "Item", "Text"]) expect(s1).toContain(`>${h}</t>`);
    expect(s1).toContain("Watch the conversion rate.");
    const s2 = str(z.get("xl/worksheets/sheet2.xml")!);
    expect(s2).toContain("Main risk"); expect(s2).toContain("Support cost");
    // a cell that starts like a formula is plain text
    const f = unzip(toXlsx(textToDoc("=HYPERLINK(\"http://evil\")\n+cmd", "-t"), "nazai", new Date(AT)));
    const sheet = str(f.get("xl/worksheets/sheet1.xml")!);
    expect(sheet).toContain("'=HYPERLINK");
    expect(sheet).not.toMatch(/<f>/);
  });

  it("csv: a byte-order mark for Excel, a header, CRLF, quotes doubled, formulas made plain", () => {
    const csv = toCsv(textToDoc('He said "hi"\n\n=SUM(A1)', "Title, with comma"), "nazai");
    expect(csv.startsWith("﻿Section,Type,Item,Text\r\n")).toBe(true);
    expect(csv).toContain('"Title, with comma"');
    expect(csv).toContain('Result,text,,"He said ""hi"""');
    expect(csv).toContain("Result,text,,'=SUM(A1)");
    expect(csv.endsWith("\r\n")).toBe(true);
    // the same rows as the spreadsheet
    expect(rowsOf(reportToDoc(COMPARE), "data").length).toBeGreaterThan(10);
  });

  it("markdown: headings, bullets, quotes, a real table; pipes inside cells are escaped", () => {
    const md = toMarkdown(reportToDoc({ ...COMPARE, comparison: [{ aspect: "a|b", points: ["x", "y"] }] }), "executive");
    expect(md.startsWith("# Should we launch a free plan?\n")).toBe(true);
    expect(md).toContain("## Conclusion");
    expect(md).toContain("- A free plan grows the user base [1][2].");
    expect(md).toContain("> Yes. A limited free plan lowers the barrier.");
    expect(md).toContain("| Aspect | [1] ChatGPT | [2] Claude |");
    expect(md).toContain("a\\|b");
    expect(md.indexOf("## Conclusion")).toBeLessThan(md.indexOf("## Answers by source"));
  });

  it("pdf: a valid file (header, trailer, an exact cross-reference table), the text readable, every page numbered", () => {
    const bytes = toPdf(reportToDoc(COMPARE), "executive", new Date(AT))!;
    const s = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    // every xref offset points at "N 0 obj"
    const start = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    const lines = s.slice(start).split("\n");
    const total = Number(lines[1].split(" ")[1]);
    for (let n = 1; n < total; n++) {
      const off = Number(lines[2 + n].slice(0, 10));
      expect(s.slice(off, off + `${n} 0 obj`.length), `object ${n}`).toBe(`${n} 0 obj`);
    }
    expect(s).toContain("Should we launch a free plan?");
    expect(s).toContain("page 1 of 1");
    expect(s).toContain("/Count 1");
    // a long result runs to more pages, each numbered
    const long = textToDoc(Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1} says something specific about parcel ${1000 + i}.`).join("\n\n"), "Long");
    const l = Array.from(toPdf(long, "nazai", new Date(AT))!, (b) => String.fromCharCode(b)).join("");
    const pages = Number(/\/Count (\d+)/.exec(l)![1]);
    expect(pages).toBeGreaterThan(2);
    expect(l).toContain(`page ${pages} of ${pages}`);
  });

  it("pdf: western text with typographic quotes, euro signs and arrows fits; other scripts say no (and the page is printed instead)", () => {
    expect(pdfCanEncode(textToDoc("Prices — “fair” €30 → café naïve ©", "t"))).toBe(true);
    expect(pdfCanEncode(textToDoc("مرحبا", "t"))).toBe(false);
    expect(pdfCanEncode(textToDoc("你好", "t"))).toBe(false);
    expect(pdfCanEncode(textToDoc("rocket 🚀", "t"))).toBe(false);
    expect(toPdf(textToDoc("مرحبا", "t"), "nazai")).toBeNull();
    expect(buildFile("pdf", textToDoc("你好", "t"), "nazai", { noun: "result", id: "abcdefgh" })).toBeNull();
    // the other file types hold any script
    for (const k of ["docx", "xlsx", "csv", "md"] as FileKind[]) expect(buildFile(k, textToDoc("مرحبا 你好 🚀", "t"), "nazai", { noun: "result", id: "abcdefgh" })).not.toBeNull();
  });

  it("pdf: brackets and backslashes in the text can not break the page", () => {
    const s = Array.from(toPdf(textToDoc("a (b) \\ c) ( d\n- (x)", "(t)"), "nazai", new Date(AT))!, (b) => String.fromCharCode(b)).join("");
    expect(s).toContain("\\(b\\)");
    expect(s).toContain("\\\\");
  });
});

describe("what a prompt already says about its output", () => {
  it("a file type or a place it is meant for means no look is asked for", () => {
    const want = (p: string) => detectRequestedOutput(p);
    expect(want("Summarise this as a PDF").file).toBe("pdf");
    expect(want("Put the numbers in an Excel sheet").file).toBe("xlsx");
    expect(want("Export it as CSV").file).toBe("csv");
    expect(want("Give me a Word document").file).toBe("docx");
    expect(want("Write it in markdown").file).toBe("md");
    expect(want("Write a LinkedIn post about our launch").surface).toBe("linkedin post");
    expect(want("Draft an email to the team").specified).toBe(true);
    expect(want("a slide deck about Q3").surface).toBe("slide deck");
    // the earliest file type named wins
    expect(want("a spreadsheet, and also a pdf").file).toBe("xlsx");
  });

  it("ordinary requests are not mistaken for it", () => {
    for (const p of ["Should we launch a free plan?", "Explain how a vaccine trains the immune system", "Give me 4 names for a budgeting app", "How many words in a sentence?", "Compare these two pricing models", "What is the meaning of the word excellence?"]) {
      expect(detectRequestedOutput(p), p).toEqual({ file: null, surface: null, specified: false });
    }
  });
});

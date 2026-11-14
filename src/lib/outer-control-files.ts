// Outer Control: a result as a file. Word (.docx), PDF, Excel (.xlsx), CSV and Markdown are built here, in the browser, from the same
// ResultDoc the looks are drawn from, in the section order of the chosen look. No library: .docx and .xlsx are zip packages of small
// XML files, and the PDF is written directly with the standard fonts (outer-control-files.ts uses pdf-font-metrics.ts to wrap text).
//
// Limits, said plainly:
//   - the PDF uses the standard Latin fonts, so it can hold western European text, not Arabic, Hebrew, Greek, Cyrillic, CJK or emoji;
//     pdfCanEncode() tells, and the page then uses the browser's own print dialog instead ("Save as PDF"), which holds any script;
//   - the PDF is always white paper in the look's colours; it does not copy a dark page background;
//   - cells are plain text: no formulas (a text that starts with = + - @ is made plain, as in the history export).
import { csvCell } from "@/lib/outer-control-export";
import { orderSections, type Blk, type ResultDoc } from "@/lib/outer-control-result-doc";
import { TEMPLATE_INFO } from "@/lib/outer-control-templates";
import { PDF_WIDTHS, type PdfFont } from "@/lib/pdf-font-metrics";
import type { OutputTemplate } from "@/lib/outer-control-report-doc";

export type BuiltFile = { name: string; mime: string; bytes: Uint8Array };
export type FileKind = "docx" | "pdf" | "xlsx" | "csv" | "md";

export const FILE_LABEL: Record<FileKind, string> = { docx: "Word (.docx)", pdf: "PDF (.pdf)", xlsx: "Excel (.xlsx)", csv: "CSV (.csv)", md: "Markdown (.md)" };
export const FILE_MIME: Record<FileKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf", csv: "text/csv;charset=utf-8", md: "text/markdown;charset=utf-8",
};

const enc = new TextEncoder();
/** Characters XML 1.0 can not hold are dropped (they are control characters; nobody wrote them on purpose). */
const xmlClean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
const xesc = (s: string) => xmlClean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------------------------------------------------------------
// ZIP (stored, no compression: a result is a few kilobytes), for .docx and .xlsx

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: string | Uint8Array }[], when = new Date()): Uint8Array {
  const dosTime = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff;
  const dosDate = ((Math.max(0, when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, data); central.push(cen);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return concat([...parts, ...central, end]);
}
function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Markdown

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
export function toMarkdown(doc: ResultDoc, template: OutputTemplate): string {
  const out: string[] = [`# ${doc.title}`, "", `*${doc.badge}${doc.meta ? ` · ${doc.meta}` : ""}*`, ""];
  const block = (b: Blk) => {
    if (b.k === "p") out.push(b.text, "");
    else if (b.k === "ul") out.push(...b.items.map((x) => `- ${x.replace(/\n/g, " ")}`), "");
    else if (b.k === "quote") out.push(...b.text.split("\n").map((l) => `> ${l}`), `> — ${b.by}`, "");
    else if (b.k === "item") out.push(`### ${b.head}`, `*by ${b.by}*`, "", b.text, "");
    else {
      out.push(`| ${b.head.map(mdCell).join(" | ")} |`, `| ${b.head.map(() => "---").join(" | ")} |`);
      for (const r of b.rows) out.push(`| ${r.map(mdCell).join(" | ")} |`);
      out.push("");
    }
  };
  for (const s of orderSections(doc, TEMPLATE_INFO[template].order)) { if (s.title) out.push(`## ${s.title}`, ""); s.blocks.forEach(block); }
  out.push("---", doc.footer, "");
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------------------
// CSV and Excel: the same rows, Section | Type | Item | Text

const HEADER = ["Section", "Type", "Item", "Text"] as const;
type Row = [string, string, string, string];
export function rowsOf(doc: ResultDoc, template: OutputTemplate): Row[] {
  const rows: Row[] = [["Result", "title", "", doc.title], ["Result", "kind", "", doc.badge]];
  if (doc.meta) rows.push(["Result", "note", "", doc.meta]);
  for (const s of orderSections(doc, TEMPLATE_INFO[template].order)) {
    const sec = s.title || "Result";
    for (const b of s.blocks) {
      if (b.k === "p") rows.push([sec, "text", "", b.text]);
      else if (b.k === "ul") b.items.forEach((x, i) => rows.push([sec, "point", String(i + 1), x]));
      else if (b.k === "quote") rows.push([sec, "quote", b.by, b.text]);
      else if (b.k === "item") rows.push([sec, "item", `${b.head} (by ${b.by})`, b.text]);
      else {
        rows.push([sec, "table header", "", b.head.join(" | ")]);
        for (const r of b.rows) rows.push([sec, "table row", r[0], r.slice(1).join(" | ")]);
      }
    }
  }
  rows.push(["Result", "note", "", doc.footer]);
  return rows;
}
/** UTF-8 with a byte-order mark, so Excel opens accents and symbols correctly. */
export function toCsv(doc: ResultDoc, template: OutputTemplate): string {
  return "﻿" + [HEADER as readonly string[], ...rowsOf(doc, template)].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const colLetter = (i: number) => String.fromCharCode(65 + i);
const cellXml = (ref: string, text: string, style: number) =>
  `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xesc(csvPlain(text)).slice(0, 32_000)}</t></is></c>`;
/** A cell is text, never a formula; the leading quote that csvCell adds is the same safeguard. */
const csvPlain = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const sheetName = (s: string, taken: Set<string>) => {
  let n = (s.replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Table").slice(0, 31);
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${n.slice(0, 28)} ${i}`;
  taken.add(n.toLowerCase());
  return n;
};
function sheetXml(rows: string[][], widths: number[], header: boolean): string {
  const data = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((t, ci) => cellXml(`${colLetter(ci)}${ri + 1}`, t, header && ri === 0 ? 1 : 2)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0">${header ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` : ""}</sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${data}</sheetData></worksheet>`;
}
export function toXlsx(doc: ResultDoc, template: OutputTemplate, when = new Date()): Uint8Array {
  const accent = TEMPLATE_INFO[template].colors.accent.slice(1).toUpperCase();
  const sheets: { name: string; xml: string }[] = [];
  const taken = new Set<string>();
  sheets.push({ name: sheetName("Result", taken), xml: sheetXml([[...HEADER], ...rowsOf(doc, template)], [26, 14, 34, 90], true) });
  for (const s of orderSections(doc, TEMPLATE_INFO[template].order)) {
    for (const b of s.blocks) {
      if (b.k !== "table") continue;
      const w = b.head.map((_, i) => (i === 0 ? 28 : Math.max(24, Math.floor(100 / Math.max(1, b.head.length - 1)))));
      sheets.push({ name: sheetName(s.title, taken), xml: sheetXml([b.head, ...b.rows], w, true) });
    }
  }
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    // Styles: 0 plain, 1 header (white bold on the look's accent colour), 2 wrapped text, top-aligned.
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${accent}"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
  ];
  return zipStore(files, when);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Word

const FONTS = { sans: { body: "Arial", head: "Arial" }, serif: { body: "Times New Roman", head: "Georgia" }, mono: { body: "Arial", head: "Courier New" } } as const;
const SHADE: Record<OutputTemplate, string | null> = { nazai: "E6F7FB", executive: "F0FDFA", editorial: null, brief: "FFF7ED", data: null };
type RunOpts = { bold?: boolean; italic?: boolean; color?: string; size?: number };
const run = (text: string, o: RunOpts = {}) =>
  xmlClean(text).split("\n").map((line, i) => `${i ? "<w:r><w:br/></w:r>" : ""}<w:r><w:rPr>${o.bold ? "<w:b/>" : ""}${o.italic ? "<w:i/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}${o.size ? `<w:sz w:val="${o.size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${xesc(line)}</w:t></w:r>`).join("");
const para = (inner: string, o: { style?: string; num?: boolean; ind?: number; shade?: string | null; border?: string; keepNext?: boolean; after?: number } = {}) =>
  `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ""}${o.keepNext ? "<w:keepNext/>" : ""}${o.num ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` : ""}${o.border ? `<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${o.border}"/></w:pBdr>` : ""}${o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : ""}${o.after !== undefined ? `<w:spacing w:after="${o.after}"/>` : ""}${o.ind ? `<w:ind w:left="${o.ind}"/>` : ""}</w:pPr>${inner}</w:p>`;

function docxBody(doc: ResultDoc, template: OutputTemplate): string {
  const info = TEMPLATE_INFO[template];
  const accent = info.colors.accent.slice(1).toUpperCase();
  const shade = SHADE[template];
  const out: string[] = [];
  out.push(para(run(doc.badge, { bold: true, color: accent, size: 18 }), { after: 60 }));
  out.push(para(run(doc.title), { style: "Title" }));
  if (doc.meta) out.push(para(run(doc.meta, { italic: true, color: "666666", size: 20 }), { after: 240 }));
  const tableXml = (head: string[], rows: string[][]) => {
    const w = Math.floor(9638 / head.length);
    const cell = (t: string, header: boolean, bold: boolean) =>
      `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${header ? `<w:shd w:val="clear" w:color="auto" w:fill="${accent}"/>` : ""}</w:tcPr>${(t || " ").split("\n").map((l) => `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>${run(l, { bold: header || bold, color: header ? "FFFFFF" : undefined, size: 20 })}</w:p>`).join("")}</w:tc>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${head.map(() => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
      `<w:tr><w:trPr><w:tblHeader/></w:trPr>${head.map((h) => cell(h, true, true)).join("")}</w:tr>${rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${head.map((_, i) => cell(r[i] ?? "", false, i === 0)).join("")}</w:tr>`).join("")}</w:tbl>` + para("", { after: 120 });
  };
  for (const s of orderSections(doc, info.order)) {
    if (s.title) out.push(para(run(s.title), { style: "Heading1", keepNext: true }));
    for (const b of s.blocks) {
      if (b.k === "p") out.push(para(run(b.text, s.key === "bottom" ? { bold: true } : {}), { shade: s.key === "bottom" ? shade : null, border: s.key === "bottom" && shade ? accent : undefined }));
      else if (b.k === "ul") for (const x of b.items) out.push(para(run(x.replace(/\n/g, " ")), { num: true, after: 60 }));
      else if (b.k === "quote") out.push(para(run(b.text, { italic: true }), { style: "Quote", after: 40 }), para(run(b.by, { color: "666666", size: 18 }), { ind: 567, after: 160 }));
      else if (b.k === "item") out.push(para(run(b.head, { bold: true }) + run(`   by ${b.by}`, { color: "666666", size: 18 }), { style: "Heading2", keepNext: true }), para(run(b.text)));
      else out.push(tableXml(b.head, b.rows));
    }
  }
  out.push(para(run(doc.footer, { color: "888888", size: 16 }), { after: 0 }));
  return out.join("");
}

export function toDocx(doc: ResultDoc, template: OutputTemplate, when = new Date()): Uint8Array {
  const info = TEMPLATE_INFO[template];
  const f = FONTS[info.font];
  const heading = info.colors.heading.slice(1).toUpperCase();
  const accent = info.colors.accent.slice(1).toUpperCase();
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f.body}" w:hAnsi="${f.body}" w:cs="${f.body}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="${f.head}" w:hAnsi="${f.head}"/><w:b/><w:color w:val="${heading}"/><w:sz w:val="48"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${accent}"/></w:pBdr><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="${f.head}" w:hAnsi="${f.head}"/><w:b/><w:color w:val="${heading}"/><w:sz w:val="28"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="${f.head}" w:hAnsi="${f.head}"/><w:b/><w:color w:val="${heading}"/><w:sz w:val="24"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="${accent}"/></w:pBdr><w:ind w:left="567"/></w:pPr></w:style></w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="567" w:hanging="283"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${docxBody(doc, template)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zipStore([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>` },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles },
    { name: "word/numbering.xml", data: numbering },
  ], when);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PDF (standard fonts, WinAnsi). A4, white paper, the look's colours.

const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
/** Symbols with a plain stand-in, so ordinary text such as "A → B" still fits in a standard-font PDF. */
const STAND_IN: Record<string, string> = { "→": "->", "←": "<-", "↔": "<->", "≥": ">=", "≤": "<=", "≠": "!=", "✓": "+", "✔": "+", "✗": "x", "★": "*", "−": "-", " ": " ", " ": " ", "​": "", " ": " ", "\t": " " };
const standIn = (s: string) => [...s].map((c) => STAND_IN[c] ?? c).join("");
function winAnsiByte(c: string): number | null {
  const cp = c.codePointAt(0)!;
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  return CP1252[c] ?? null;
}
/** True when every character of the result can be written in a standard-font PDF. */
export function pdfCanEncode(doc: ResultDoc): boolean {
  const all = [doc.title, doc.badge, doc.meta, doc.footer];
  for (const s of doc.sections) {
    all.push(s.title);
    for (const b of s.blocks) {
      if (b.k === "p") all.push(b.text);
      else if (b.k === "ul") all.push(...b.items);
      else if (b.k === "quote") all.push(b.text, b.by);
      else if (b.k === "item") all.push(b.head, b.by, b.text);
      else all.push(...b.head, ...b.rows.flat());
    }
  }
  for (const t of all) for (const c of standIn(t)) if (c !== "\n" && c !== "\r" && winAnsiByte(c) === null) return false;
  return true;
}

type Face = PdfFont | "helveticaOblique" | "courierBold";
const FACE_NAME: Record<Face, { key: string; base: string }> = {
  helvetica: { key: "F1", base: "Helvetica" }, helveticaBold: { key: "F2", base: "Helvetica-Bold" }, times: { key: "F3", base: "Times-Roman" },
  timesBold: { key: "F4", base: "Times-Bold" }, helveticaOblique: { key: "F5", base: "Helvetica-Oblique" }, courierBold: { key: "F6", base: "Courier-Bold" },
};
const rgb = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");

function charWidth(face: Face, byte: number): number {
  if (face === "courierBold") return 600;
  const t = PDF_WIDTHS[face === "helveticaOblique" ? "helvetica" : face];
  return byte >= 32 ? t[byte - 32] ?? 0 : 0;
}
const bytesOf = (s: string): number[] => [...standIn(s)].map((c) => winAnsiByte(c) ?? 63);
const widthOf = (face: Face, bytes: number[], size: number) => bytes.reduce((n, b) => n + charWidth(face, b), 0) * size / 1000;
const pdfString = (bytes: number[]) => "(" + bytes.map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b))).join("") + ")";

/** Words wrapped to a width, as arrays of bytes per line. Explicit line breaks are kept; a word wider than the line is broken. */
function wrap(face: Face, size: number, text: string, width: number): number[][] {
  const lines: number[][] = [];
  for (const para of text.replace(/\r\n/g, "\n").split("\n")) {
    const words = para.split(/ +/).filter((w) => w.length);
    if (!words.length) { lines.push([]); continue; }
    let cur: number[] = [];
    const space = bytesOf(" ");
    for (const w of words) {
      let wb = bytesOf(w);
      while (widthOf(face, wb, size) > width) {
        // break a very long word at the width
        let k = 1;
        while (k < wb.length && widthOf(face, wb.slice(0, k + 1), size) <= width) k++;
        if (cur.length) { lines.push(cur); cur = []; }
        lines.push(wb.slice(0, k)); wb = wb.slice(k);
      }
      const next = cur.length ? [...cur, ...space, ...wb] : wb;
      if (cur.length && widthOf(face, next, size) > width) { lines.push(cur); cur = wb; } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}

const PAGE_W = 595, PAGE_H = 842, M_X = 56, M_TOP = 62, M_BOTTOM = 66;
export function toPdf(doc: ResultDoc, template: OutputTemplate, when = new Date()): Uint8Array | null {
  if (!pdfCanEncode(doc)) return null;
  const info = TEMPLATE_INFO[template];
  const serif = info.font === "serif";
  const body: Face = serif ? "times" : "helvetica";
  const bold: Face = serif ? "timesBold" : "helveticaBold";
  const headFace: Face = info.font === "mono" ? "courierBold" : bold;
  const heading = rgb(info.colors.heading), accent = rgb(info.colors.accent), text = "0.110 0.110 0.110", grey = "0.40 0.40 0.40";
  const contentW = PAGE_W - 2 * M_X;
  const pages: string[][] = [[]];
  let y = PAGE_H - M_TOP;
  const emit = (op: string) => pages[pages.length - 1].push(op);
  const newPage = () => { pages.push([]); y = PAGE_H - M_TOP; };
  const ensure = (h: number) => { if (y - h < M_BOTTOM) newPage(); };
  const put = (face: Face, size: number, color: string, x: number, yy: number, bytes: number[]) =>
    emit(`BT /${FACE_NAME[face].key} ${size} Tf ${color} rg ${x.toFixed(2)} ${yy.toFixed(2)} Td ${pdfString(bytes)} Tj ET`);
  const rect = (x: number, yy: number, w: number, h: number, color: string) => emit(`${color} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);

  /** A paragraph: wrapped, with an optional hanging bullet, left bar, or shaded background. */
  const textBlock = (s: string, o: { face?: Face; size?: number; color?: string; indent?: number; before?: number; after?: number; bullet?: boolean; bar?: string; shade?: string; keepNext?: number } = {}) => {
    const face = o.face ?? body, size = o.size ?? 10.5, lh = size * 1.4, indent = o.indent ?? 0, hang = o.bullet ? 12 : 0;
    const lines = wrap(face, size, s, contentW - indent - hang - (o.shade ? 12 : 0));
    y -= o.before ?? 0;
    ensure(Math.min(lines.length, 2) * lh + (o.keepNext ?? 0));
    lines.forEach((ln, i) => {
      if (y - lh < M_BOTTOM) newPage();
      if (o.shade) rect(M_X + indent, y - lh + size * 0.28 - 1, contentW - indent, lh, o.shade);
      if (o.bar) rect(M_X + indent - (o.shade ? 0 : 9), y - lh + size * 0.28 - 1, 2.4, lh, o.bar);
      if (o.bullet && i === 0) put(body, size, o.color ?? text, M_X + indent, y - size, bytesOf("•"));
      if (ln.length) put(face, size, o.color ?? text, M_X + indent + hang + (o.shade ? 8 : 0), y - size, ln);
      y -= lh;
    });
    y -= o.after ?? 5;
  };

  // Header: kind badge, title, note, a rule in the look's accent.
  textBlock(doc.badge, { face: bold, size: 8.5, color: accent, after: 3 });
  textBlock(doc.title, { face: headFace, size: serif ? 22 : 19, color: heading, after: 4 });
  if (doc.meta) textBlock(doc.meta, { face: serif ? "times" : "helveticaOblique", size: 9, color: grey, after: 6 });
  rect(M_X, y + 2, contentW, 1.6, accent); y -= 12;

  const shade = SHADE_PDF[template];
  for (const s of orderSections(doc, info.order)) {
    if (s.title) textBlock(s.title, { face: headFace, size: 12.5, color: heading, before: 8, after: 5, keepNext: 40 });
    for (const b of s.blocks) {
      if (b.k === "p") textBlock(b.text, { face: s.key === "bottom" ? bold : body, shade: s.key === "bottom" ? shade ?? undefined : undefined, bar: s.key === "bottom" && shade ? accent : undefined });
      else if (b.k === "ul") for (const x of b.items) textBlock(x.replace(/\n/g, " "), { bullet: true, indent: 8, after: 3 });
      else if (b.k === "quote") { textBlock(b.text, { face: serif ? "times" : "helveticaOblique", indent: 14, bar: accent, after: 1 }); textBlock(b.by, { size: 8, color: grey, indent: 14, after: 8 }); }
      else if (b.k === "item") { textBlock(`${b.head}   by ${b.by}`, { face: bold, size: 11, color: heading, before: 4, after: 2, keepNext: 30 }); textBlock(b.text); }
      else {
        const cols = b.head.length, pad = 4, cw = contentW / cols, size = 9;
        const rowH = (cells: string[], face: Face) => { const ls = cells.map((c) => wrap(face, size, c, cw - 2 * pad)); return { ls, h: Math.max(...ls.map((l) => l.length)) * size * 1.35 + 2 * pad }; };
        const drawRow = (cells: string[], header: boolean) => {
          const r = rowH(cells, header ? bold : body);
          ensure(r.h);
          if (header) rect(M_X, y - r.h, contentW, r.h, accent);
          r.ls.forEach((ls, ci) => ls.forEach((ln, li) => { if (ln.length) put(header || ci === 0 ? bold : body, size, header ? "1 1 1" : text, M_X + ci * cw + pad, y - pad - size - li * size * 1.35, ln); }));
          rect(M_X, y - r.h, contentW, 0.5, "0.75 0.75 0.75");
          y -= r.h;
        };
        drawRow(b.head, true);
        for (const r of b.rows) drawRow(Array.from({ length: cols }, (_, i) => (r[i] ?? "").replace(/\n/g, "; ")), false);
        y -= 8;
      }
    }
  }
  textBlock(doc.footer, { size: 8, color: grey, before: 10 });

  // Footers (page numbers) once the page count is known.
  pages.forEach((p, i) => p.push(`BT /F1 8 Tf ${grey} rg ${M_X} 34 Td ${pdfString(bytesOf(`NazAI Outer Control · page ${i + 1} of ${pages.length}`))} Tj ET`));

  // Objects: 1 catalog, 2 pages, 3..8 fonts, then per page (page, content), then info.
  const objs: string[] = [];
  const faces = Object.keys(FACE_NAME) as Face[];
  const fontObj0 = 3;
  const firstPage = fontObj0 + faces.length;
  const kids = pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(" ");
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  faces.forEach((f, i) => { objs[fontObj0 + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FACE_NAME[f].base} /Encoding /WinAnsiEncoding >>`; });
  const fontRes = faces.map((f, i) => `/${FACE_NAME[f].key} ${fontObj0 + i} 0 R`).join(" ");
  const streams: string[] = [];
  pages.forEach((p, i) => {
    const content = p.join("\n");
    streams[firstPage + i * 2 + 1] = content;
    objs[firstPage + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << ${fontRes} >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`;
  });
  const infoObj = firstPage + pages.length * 2;
  const d2 = (n: number) => String(n).padStart(2, "0");
  objs[infoObj] = `<< /Title ${pdfString(bytesOf(doc.title).slice(0, 200))} /Producer (NazAI Outer Control) /CreationDate (D:${when.getUTCFullYear()}${d2(when.getUTCMonth() + 1)}${d2(when.getUTCDate())}${d2(when.getUTCHours())}${d2(when.getUTCMinutes())}${d2(when.getUTCSeconds())}Z) >>`;

  // Written as bytes (every character below code 256), with the cross-reference table at exact offsets.
  const chunks: number[][] = [];
  const offsets: number[] = [];
  let pos = 0;
  const write = (s: string) => { const b = [...s].map((c) => c.charCodeAt(0) & 0xff); chunks.push(b); pos += b.length; };
  write("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = pos;
    if (streams[n] !== undefined) { const s = streams[n]; write(`${n} 0 obj\n<< /Length ${s.length} >>\nstream\n${s}\nendstream\nendobj\n`); }
    else write(`${n} 0 obj\n${objs[n]}\nendobj\n`);
  }
  const xref = pos;
  write(`xref\n0 ${objs.length}\n0000000000 65535 f \n`);
  for (let n = 1; n < objs.length; n++) write(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${objs.length} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Uint8Array.from(chunks.flat());
}
const SHADE_PDF: Record<OutputTemplate, string | null> = { nazai: "0.90 0.97 0.98", executive: "0.94 0.99 0.98", editorial: null, brief: "1.00 0.97 0.93", data: null };

// ---------------------------------------------------------------------------------------------------------------------------------

/** The file name: nazai-<what it is>-<first 8 characters of the id>.<extension>. */
export const fileName = (noun: string, id: string, ext: string) => `nazai-${noun.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "result"}-${id.slice(0, 8)}.${ext}`;

/** A file of the chosen type, or null when the type can not hold this result (only the PDF can say no). */
export function buildFile(kind: FileKind, doc: ResultDoc, template: OutputTemplate, name: { noun: string; id: string }, when = new Date()): BuiltFile | null {
  const fn = (ext: string) => fileName(name.noun, name.id, ext);
  switch (kind) {
    case "md": return { name: fn("md"), mime: FILE_MIME.md, bytes: enc.encode(toMarkdown(doc, template)) };
    case "csv": return { name: fn("csv"), mime: FILE_MIME.csv, bytes: enc.encode(toCsv(doc, template)) };
    case "xlsx": return { name: fn("xlsx"), mime: FILE_MIME.xlsx, bytes: toXlsx(doc, template, when) };
    case "docx": return { name: fn("docx"), mime: FILE_MIME.docx, bytes: toDocx(doc, template, when) };
    case "pdf": { const b = toPdf(doc, template, when); return b ? { name: fn("pdf"), mime: FILE_MIME.pdf, bytes: b } : null; }
  }
}

/** Hands bytes to the browser as a download. False when the browser would not. */
export function saveBytes(file: BuiltFile): boolean {
  try {
    const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mime }));
    const el = document.createElement("a");
    el.href = url; el.download = file.name;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch { return false; }
}

/** The browser's print dialog for a page ("Save as PDF" there): for a result a standard-font PDF can not hold. */
export function printPage(html: string): boolean {
  try {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.srcdoc = html;
    frame.onload = () => { try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } finally { setTimeout(() => frame.remove(), 60_000); } };
    document.body.appendChild(frame);
    return true;
  } catch { return false; }
}


// Outer Control: the looks a result can have. Each one is drawn from the same ResultDoc (outer-control-result-doc.ts) but differs in
// order, layout and type, not only in colour:
//
//   nazai      the original dark page, sections as cards, the answer last
//   executive  white and navy; the answer first in a box, then the support, the working and the sources as an appendix
//   editorial  warm paper and serif type; reads like an article: lede, working, conclusion, a pull-quote for each source
//   brief      compact and numbered; the decision at the top, agreements and differences side by side, sources as footnotes
//   data       light grey, monospace headings; every section is a table of rows
//
// A look is chosen before a Task starts (TaskPanel) and kept with its result (final_artifact.template); a viewer can switch. The same
// order is used for the Word, PDF, Markdown, CSV and Excel files, so a file matches the look it was made from.
import { isReportDoc, type OutputTemplate } from "@/lib/outer-control-report-doc";
import { reportHtml } from "@/lib/outer-control-report-doc";
import { orderSections, type Blk, type ResultDoc, type Sec, type SecKey } from "@/lib/outer-control-result-doc";

export type TemplateInfo = {
  name: string;
  /** One line for the picker: what it is for. */
  blurb: string;
  /** For the swatch in the picker and the colours of the Word file. */
  colors: { bg: string; text: string; accent: string; heading: string };
  /** The order of sections (SecKey). */
  order: readonly SecKey[];
  /** Type: "sans", "serif" or "mono" (the PDF and Word files use the matching standard font). */
  font: "sans" | "serif" | "mono";
};

export const TEMPLATE_INFO: Record<OutputTemplate, TemplateInfo> = {
  nazai: {
    name: "NazAI dark", blurb: "The original look: dark cards, the answer at the end.",
    colors: { bg: "#050b18", text: "#dbe7ff", accent: "#22d3ee", heading: "#0b6e80" },
    order: ["summary", "sources", "detail", "points", "contrast", "bottom", "method"], font: "sans",
  },
  executive: {
    name: "Executive brief", blurb: "For decisions: the answer first, the sources in an appendix.",
    colors: { bg: "#ffffff", text: "#1b2733", accent: "#0f766e", heading: "#0b2545" },
    order: ["bottom", "summary", "points", "contrast", "detail", "sources", "method"], font: "sans",
  },
  editorial: {
    name: "Editorial", blurb: "For reading: article style, serif type, pull-quotes.",
    colors: { bg: "#faf5ec", text: "#2a2320", accent: "#b4532a", heading: "#7a2e12" },
    order: ["summary", "detail", "points", "contrast", "bottom", "sources", "method"], font: "serif",
  },
  brief: {
    name: "One-page brief", blurb: "For sharing: compact, numbered, agreements and differences side by side.",
    colors: { bg: "#ffffff", text: "#111111", accent: "#ea580c", heading: "#111111" },
    order: ["bottom", "summary", "points", "contrast", "detail", "sources", "method"], font: "sans",
  },
  data: {
    name: "Data sheet", blurb: "For checking: everything in tables, monospace headings.",
    colors: { bg: "#f1f4f7", text: "#1c2430", accent: "#0f766e", heading: "#0f3d3a" },
    order: ["summary", "bottom", "points", "contrast", "detail", "sources", "method"], font: "mono",
  },
};

/** "nazai" first, as it is the default. */
export const TEMPLATE_IDS = Object.keys(TEMPLATE_INFO) as OutputTemplate[];
export const DEFAULT_TEMPLATE: OutputTemplate = "nazai";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paras = (s: string) => s.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

function block(b: Blk): string {
  switch (b.k) {
    case "p": return paras(b.text);
    case "ul": return `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    case "quote": return `<blockquote class="quote">${paras(b.text)}<cite>${esc(b.by)}</cite></blockquote>`;
    case "item": return `<div class="item"><h4>${esc(b.head)} <small>by ${esc(b.by)}</small></h4>${paras(b.text)}</div>`;
    case "table": {
      const cell = (s: string) => esc(s).replace(/\n/g, "<br>");
      return `<table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${cell(c)}</th>` : `<td>${cell(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`;
    }
  }
}
const blocks = (s: Sec) => s.blocks.map(block).join("");

/** A page around a body: charset, viewport, title, one style block. Nothing external is loaded. */
function page(doc: ResultDoc, css: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.badge.replace(/^NAZAI /, "NazAI ").toLowerCase().replace(/^nazai/, "NazAI"))} — ${esc(doc.title.slice(0, 80))}</title>
<style>*{box-sizing:border-box}body{margin:0}p{margin:0 0 10px}ul{margin:0;padding-left:20px}li{margin:0 0 6px}${css}</style></head><body>${body}</body></html>`;
}

// ---- executive: white and navy, the answer first in a box ------------------------------------------------------------------------
const EXECUTIVE_CSS = `
body{background:#eef1f5;color:#1b2733;font:16px/1.6 "Segoe UI",system-ui,-apple-system,sans-serif}
.wrap{max-width:800px;margin:0 auto;background:#fff;min-height:100vh;box-shadow:0 0 40px rgba(11,37,69,.12)}
header{background:#0b2545;color:#fff;padding:34px 40px 28px}
.badge{display:inline-block;font:600 11px/1 system-ui,sans-serif;letter-spacing:.2em;color:#5eead4;margin-bottom:14px}
h1{font-size:28px;line-height:1.25;margin:0 0 10px;font-weight:650}
.meta{color:#b6c4d8;font-size:13px;margin:0}
main{padding:30px 40px 10px}
.bottom{border:2px solid #0f766e;border-left-width:8px;background:#f0fdfa;border-radius:6px;padding:18px 22px;margin:0 0 26px}
.bottom h2{margin:0 0 8px;color:#0f766e;font-size:13px;letter-spacing:.14em;text-transform:uppercase}
.bottom p{font-size:18px;line-height:1.5;color:#0b2545}
section{margin:0 0 24px}
h2{margin:0 0 10px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#0b2545;border-bottom:1px solid #cbd5e1;padding-bottom:6px}
.k-sources h2,.k-method h2{color:#64748b}.k-sources,.k-method{font-size:14px;color:#475569}
blockquote{margin:0 0 12px;padding:8px 14px;background:#f8fafc;border-left:3px solid #94a3b8}cite{display:block;font:12px ui-monospace,Consolas,monospace;color:#64748b;margin-top:4px;font-style:normal}
.item{margin:0 0 14px}.item h4{margin:0 0 4px;font-size:15px;color:#0b2545}.item small{color:#64748b;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid #e2e8f0}thead th{background:#0b2545;color:#fff;font-weight:600}tbody th{color:#0b2545}
footer{padding:16px 40px 30px;color:#94a3b8;font-size:12px}
@media print{body{background:#fff}.wrap{box-shadow:none}header{background:#fff;color:#0b2545;border-bottom:3px solid #0b2545}.meta{color:#475569}.badge{color:#0f766e}section,.bottom{break-inside:avoid}}`;
function executive(doc: ResultDoc, secs: Sec[]): string {
  const body = secs.map((s) => (s.key === "bottom" ? `<aside class="bottom k-bottom"><h2>${esc(s.title)}</h2>${blocks(s)}</aside>` : `<section class="k-${s.key}">${s.title ? `<h2>${s.key === "sources" ? "Appendix · " : ""}${esc(s.title)}</h2>` : ""}${blocks(s)}</section>`)).join("");
  return page(doc, EXECUTIVE_CSS, `<div class="wrap"><header><div class="badge">${esc(doc.badge)}</div><h1>${esc(doc.title)}</h1><p class="meta">${esc(doc.meta)}</p></header><main>${body}</main><footer>${esc(doc.footer)}</footer></div>`);
}

// ---- editorial: article on warm paper ---------------------------------------------------------------------------------------------
const EDITORIAL_CSS = `
body{background:#efe6d6;color:#2a2320;font:18px/1.75 Georgia,"Times New Roman",serif;padding:36px 16px}
.wrap{max-width:700px;margin:0 auto;background:#faf5ec;padding:56px 60px 40px;box-shadow:0 2px 30px rgba(80,50,20,.18)}
.badge{text-align:center;font:600 11px/1 system-ui,sans-serif;letter-spacing:.3em;color:#b4532a;text-transform:uppercase}
h1{text-align:center;font-size:40px;line-height:1.15;margin:18px 0 12px;font-weight:700;color:#2a2320}
.meta{text-align:center;font-style:italic;color:#7c6a5a;font-size:15px;margin:0 0 34px;padding-bottom:22px;border-bottom:1px solid #d9c9b0}
section{margin:0 0 30px}
h2{margin:0 0 12px;text-align:center;font:600 12px/1 system-ui,sans-serif;letter-spacing:.28em;text-transform:uppercase;color:#b4532a}
h2:before,h2:after{content:"◆";margin:0 10px;font-size:8px;vertical-align:2px}
.k-summary p:first-of-type{font-size:22px;line-height:1.55;color:#3b2f27}
ul{list-style:none;padding:0}li{padding-left:22px;position:relative}li:before{content:"—";position:absolute;left:0;color:#b4532a}
.k-bottom{border-top:3px double #b4532a;border-bottom:3px double #b4532a;padding:18px 6px;text-align:center}.k-bottom p{font-size:21px;font-style:italic}
blockquote{margin:22px 0;padding:0 10px 0 46px;position:relative;font-style:italic;color:#4a3b30}blockquote:before{content:"“";position:absolute;left:0;top:-14px;font-size:70px;color:#d9a98f;line-height:1}
cite{display:block;margin-top:6px;font:12px system-ui,sans-serif;letter-spacing:.04em;color:#8a7767;font-style:normal}
.item{margin:0 0 18px}.item h4{margin:0 0 4px;font-size:19px}.item small{font:12px system-ui,sans-serif;color:#8a7767}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid #d9c9b0}thead th{font:600 11px system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#b4532a}
.k-method{font-size:14px;color:#7c6a5a;font-style:italic}.k-sources{font-size:16px}
footer{text-align:center;font:11px system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#a8957f;margin-top:30px}
@media print{body{background:#fff;padding:0}.wrap{box-shadow:none;padding:0}}`;
function editorial(doc: ResultDoc, secs: Sec[]): string {
  const body = secs.map((s) => `<section class="k-${s.key}">${s.title ? `<h2>${esc(s.key === "bottom" && /^conclusion$/i.test(s.title) ? "In conclusion" : s.title)}</h2>` : ""}${blocks(s)}</section>`).join("");
  return page(doc, EDITORIAL_CSS, `<div class="wrap"><div class="badge">${esc(doc.badge)}</div><h1>${esc(doc.title)}</h1><p class="meta">${esc(doc.meta)}</p>${body}<footer>${esc(doc.footer)}</footer></div>`);
}

// ---- brief: compact, numbered, decision first --------------------------------------------------------------------------------------
const BRIEF_CSS = `
body{background:#e5e5e5;color:#111;font:14px/1.5 Arial,Helvetica,sans-serif;padding:24px 12px}
.wrap{max-width:780px;margin:0 auto;background:#fff;padding:26px 32px 18px}
.top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #111;padding-bottom:8px;margin-bottom:14px}
.badge{font:700 11px/1 Arial,sans-serif;letter-spacing:.18em;color:#ea580c}.date{font-size:11px;color:#555;max-width:55%;text-align:right}
h1{font-size:22px;line-height:1.25;margin:0 0 14px}
.decision{border-left:8px solid #ea580c;background:#fff7ed;padding:10px 14px;margin:0 0 14px}.decision h2{margin:0 0 4px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#ea580c}.decision p{font-size:16px;font-weight:600;margin:0 0 6px}
section{margin:0 0 12px}h2{margin:0 0 5px;font-size:12px;letter-spacing:.1em;text-transform:uppercase}h2 .num{display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;background:#111;color:#fff;border-radius:3px;margin-right:6px;font-size:11px;letter-spacing:0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 14px}@media(max-width:560px){.cols{grid-template-columns:1fr}}
.cols section{border:1px solid #d4d4d4;padding:8px 12px;border-radius:4px;margin:0}
.k-sources,.k-method{font-size:11.5px;color:#444;border-top:1px solid #ddd;padding-top:8px}.k-sources h2,.k-method h2{font-size:10px;color:#666}
blockquote{margin:0 0 6px;padding-left:10px;border-left:2px solid #bbb}cite{display:block;font-size:10.5px;color:#777;font-style:normal}
.item{margin:0 0 8px}.item h4{margin:0 0 2px;font-size:13px}.item small{color:#777;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{text-align:left;vertical-align:top;padding:5px 8px;border:1px solid #d4d4d4}thead th{background:#111;color:#fff}
footer{margin-top:10px;padding-top:6px;border-top:1px solid #ddd;font-size:10px;color:#888;text-align:right}
@media print{body{background:#fff;padding:0}.wrap{padding:0}}`;
function brief(doc: ResultDoc, secs: Sec[]): string {
  let n = 0;
  const out: string[] = [];
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const next = secs[i + 1];
    if (s.key === "bottom") { out.push(`<div class="decision k-bottom"><h2>${/^conclusion$/i.test(s.title) ? "Decision" : esc(s.title)}</h2>${blocks(s)}</div>`); continue; }
    const head = (x: Sec) => (x.title && x.key !== "sources" && x.key !== "method" ? `<h2><span class="num">${++n}</span>${esc(x.title)}</h2>` : x.title ? `<h2>${esc(x.title)}</h2>` : "");
    if (s.key === "points" && next?.key === "contrast") { out.push(`<div class="cols"><section class="k-points">${head(s)}${blocks(s)}</section><section class="k-contrast">${head(next)}${blocks(next)}</section></div>`); i++; continue; }
    out.push(`<section class="k-${s.key}">${head(s)}${blocks(s)}</section>`);
  }
  return page(doc, BRIEF_CSS, `<div class="wrap"><div class="top"><span class="badge">${esc(doc.badge)}</span><span class="date">${esc(doc.meta)}</span></div><h1>${esc(doc.title)}</h1>${out.join("")}<footer>${esc(doc.footer)}</footer></div>`);
}

// ---- data: tables everywhere --------------------------------------------------------------------------------------------------------
const DATA_CSS = `
body{background:#e3e8ee;color:#1c2430;font:14px/1.5 "Segoe UI",system-ui,sans-serif;padding:24px 12px}
.wrap{max-width:900px;margin:0 auto}
.top{background:#0f3d3a;color:#fff;padding:14px 18px;border-radius:6px 6px 0 0;font:12px ui-monospace,Consolas,monospace;letter-spacing:.06em;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
h1{font:600 20px/1.3 ui-monospace,Consolas,monospace;background:#fff;margin:0;padding:16px 18px;border:1px solid #c5cfd9;border-top:0}
.meta{background:#fff;margin:0;padding:0 18px 14px;color:#51606f;font-size:13px;border:1px solid #c5cfd9;border-top:0;border-bottom:0}
table.grid{width:100%;border-collapse:collapse;background:#fff;margin:14px 0 0;border:1px solid #c5cfd9}
table.grid caption{caption-side:top;text-align:left;font:600 12px ui-monospace,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:#0f766e;padding:7px 12px}
table.grid th,table.grid td{text-align:left;vertical-align:top;padding:8px 12px;border-top:1px solid #dbe3ea}
table.grid th{width:42px;color:#0f766e;font:600 12px ui-monospace,Consolas,monospace;background:#f6f9fb;white-space:nowrap}
table.grid td table{width:100%;border-collapse:collapse}table.grid td table th,table.grid td table td{border:1px solid #dbe3ea;width:auto;background:#fff;color:#1c2430;font:13px "Segoe UI",system-ui,sans-serif;white-space:normal}table.grid td table thead th{background:#0f3d3a;color:#fff}
.src{font:12px ui-monospace,Consolas,monospace;color:#51606f}
footer{padding:12px 4px;font:11px ui-monospace,Consolas,monospace;color:#6b7a89}
@media print{body{background:#fff;padding:0}table.grid{break-inside:avoid}}`;
function dataSheet(doc: ResultDoc, secs: Sec[]): string {
  const tables = secs.map((s) => {
    const rows: string[] = [];
    s.blocks.forEach((b, i) => {
      const num = (n: number) => (s.blocks.length === 1 && b.k !== "ul" ? "" : String(n));
      if (b.k === "p") rows.push(`<tr><th>${num(i + 1)}</th><td>${paras(b.text)}</td></tr>`);
      else if (b.k === "ul") b.items.forEach((x, j) => rows.push(`<tr><th>${j + 1}</th><td>${esc(x)}</td></tr>`));
      else if (b.k === "quote") rows.push(`<tr><th>${i + 1}</th><td>${paras(b.text)}<div class="src">${esc(b.by)}</div></td></tr>`);
      else if (b.k === "item") rows.push(`<tr><th>${i + 1}</th><td><strong>${esc(b.head)}</strong> <span class="src">by ${esc(b.by)}</span>${paras(b.text)}</td></tr>`);
      else rows.push(`<tr><td colspan="2">${block(b)}</td></tr>`);
    });
    return `<table class="grid k-${s.key}">${s.title ? `<caption>${esc(s.title)}</caption>` : ""}<tbody>${rows.join("")}</tbody></table>`;
  }).join("");
  return page(doc, DATA_CSS, `<div class="wrap"><div class="top"><span>${esc(doc.badge)}</span><span>NazAI Outer Control</span></div><h1>${esc(doc.title)}</h1><p class="meta">${esc(doc.meta)}</p>${tables}<footer>${esc(doc.footer)}</footer></div>`);
}

// ---- nazai: the original dark cards -----------------------------------------------------------------------------------------------------
const NAZAI_CSS = `
:root{color-scheme:dark}
body{background:#050b18;color:#dbe7ff;font:16px/1.65 "Segoe UI",system-ui,-apple-system,sans-serif;padding:40px 16px;background-image:radial-gradient(900px 420px at 15% -5%,rgba(34,211,238,.18),transparent 60%),radial-gradient(700px 400px at 100% 10%,rgba(59,130,246,.16),transparent 60%)}
main{max-width:820px;margin:0 auto}
.badge{display:inline-block;font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.18em;color:#67e8f9;border:1px solid rgba(103,232,249,.4);border-radius:999px;padding:7px 12px;background:rgba(34,211,238,.08)}
h1{font-size:30px;line-height:1.25;margin:18px 0 10px;color:#fff;font-weight:650}.meta{color:#8fa6cc;font-size:14px;margin:0 0 28px}
section{margin:0 0 22px;padding:22px 24px;border:1px solid rgba(125,170,255,.18);border-radius:16px;background:linear-gradient(180deg,rgba(15,30,60,.7),rgba(8,16,34,.7))}
h2{margin:0 0 12px;font:600 12px/1 ui-monospace,Consolas,monospace;letter-spacing:.16em;color:#67e8f9;text-transform:uppercase}
.k-summary{border-left:3px solid #22d3ee}.k-points h2{color:#6ee7b7}.k-contrast h2{color:#fcd34d}
.k-bottom{border-color:rgba(103,232,249,.45);background:linear-gradient(135deg,rgba(34,211,238,.12),rgba(59,130,246,.1))}
blockquote{margin:0 0 14px;border-left:2px solid rgba(103,232,249,.5);padding-left:14px;color:#e8f0ff}cite{display:block;font:12px ui-monospace,Consolas,monospace;color:#7d93bb;font-style:normal;margin-top:4px}
.item{margin:0 0 16px}.item h4{margin:0 0 6px;font-size:15px;color:#fff}.item small{color:#8fa6cc;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-top:1px solid rgba(125,170,255,.18)}th{color:#67e8f9;font-weight:600}
footer{color:#6f86ad;font-size:12px;text-align:center;margin-top:28px}
@media print{body{background:#fff;color:#111;padding:0}section{background:#fff;border-color:#cfd8e6;break-inside:avoid}h1,.item h4{color:#111}.meta,cite{color:#444}blockquote{color:#111}.badge{color:#0b6e80;border-color:#0b6e80;background:#fff}h2,th{color:#0b6e80}}`;
function nazai(doc: ResultDoc, secs: Sec[]): string {
  const body = secs.map((s) => `<section class="k-${s.key}">${s.title ? `<h2>${esc(s.title)}</h2>` : ""}${blocks(s)}</section>`).join("");
  return page(doc, NAZAI_CSS, `<main><span class="badge">${esc(doc.badge)}</span><h1>${esc(doc.title)}</h1><p class="meta">${esc(doc.meta)}</p>${body}<footer>${esc(doc.footer)}</footer></main>`);
}

const RENDER: Record<OutputTemplate, (doc: ResultDoc, secs: Sec[]) => string> = { nazai, executive, editorial, brief, data: dataSheet };

/**
 * A complete, self-contained page for a result in the chosen look. The original look of a report is the report's own page (the one
 * the app has always downloaded), so a result that was already downloaded before the looks existed comes out the same.
 */
export function renderTemplate(doc: ResultDoc, id: OutputTemplate, report?: unknown): string {
  if (id === "nazai" && isReportDoc(report)) return reportHtml(report);
  return RENDER[id](doc, orderSections(doc, TEMPLATE_INFO[id].order));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// "As a PDF", "for an email": a prompt that already says what it wants is followed, and no look is asked for.

export type FileFormat = "docx" | "pdf" | "xlsx" | "csv" | "md";
export type RequestedOutput = { file: FileFormat | null; surface: string | null; specified: boolean };

const FILE_WORDS: [FileFormat, RegExp][] = [
  ["pdf", /\bpdf\b/i],
  ["docx", /\.docx?\b|\bdocx\b|\b(?:ms|microsoft)\s+word\b|\bword\s+(?:document|doc|file)\b|\bas\s+a\s+word\b/i],
  ["xlsx", /\bxlsx\b|\bexcel\b|\bspreadsheet\b|\bgoogle\s+sheets?\b/i],
  ["csv", /\bcsv\b/i],
  ["md", /\bmarkdown\b|\.md\b/i],
];
const SURFACE = /\b(e-?mail|newsletter|linkedin\s+(?:post|article)|tweet|x\s+post|twitter\s+thread|instagram\s+(?:post|caption)|facebook\s+post|slide\s+deck|slides?|presentation|powerpoint|readme|blog\s+post|press\s+release|landing\s+page|cover\s+letter|resume|one-pager|memo|whatsapp\s+message|text\s+message|sms)\b/i;

/**
 * What the request already says about its output. A file type named in it ("as a PDF", "in Excel") or a place it is meant for
 * ("a LinkedIn post", "an email") counts: the person has said what they want, so the look is not asked for. The earliest file type
 * named wins when there are several.
 */
export function detectRequestedOutput(prompt: string): RequestedOutput {
  const text = prompt ?? "";
  let file: FileFormat | null = null;
  let at = Infinity;
  for (const [f, re] of FILE_WORDS) {
    const m = re.exec(text);
    if (m && m.index < at) { file = f; at = m.index; }
  }
  const s = SURFACE.exec(text);
  const surface = s ? s[1].toLowerCase().replace(/\s+/g, " ") : null;
  return { file, surface, specified: file !== null || surface !== null };
}

// Outer Control: the report as a document. The same structure is shown in the app (ReportView), downloaded as a styled
// page, and written as clean text (the Task's controlled result), so the three cannot disagree: the text is always
// `composeReportText(doc)`, and the app only shows the designed view when the stored text still equals it.
//
// Pure and dependency-free. THIS FILE EXISTS TWICE, byte for byte: src/lib/outer-control-report-doc.ts (the app) and
// supabase/functions/_shared/outer-control-report-doc.ts (the edge functions). A test fails when they differ.

export type ReportOpinion = { n: number; tool: string; text: string; shortened: boolean; sha256: string; at: string };

export type ReportDoc = {
  version: 1;
  topic: string;
  /** ISO time the report was compiled. */
  compiled_at: string;
  summary: string;
  opinions: ReportOpinion[];
  agreements: string[];
  differences: string[];
  conclusion: string;
};

const isStr = (x: unknown): x is string => typeof x === "string";
const isStrList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);

export function isReportDoc(x: unknown): x is ReportDoc {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  return d.version === 1 && isStr(d.topic) && isStr(d.compiled_at) && isStr(d.summary) && isStr(d.conclusion) && isStrList(d.agreements) && isStrList(d.differences)
    && Array.isArray(d.opinions) && d.opinions.every((o) => !!o && typeof o === "object"
      && Number.isInteger((o as ReportOpinion).n) && isStr((o as ReportOpinion).tool) && isStr((o as ReportOpinion).text) && typeof (o as ReportOpinion).shortened === "boolean"
      && isStr((o as ReportOpinion).sha256) && isStr((o as ReportOpinion).at));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18 Oct 2026, 02:17 UTC" from an ISO time; the input itself when it is not a time. */
export function when(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export const fingerprint = (sha: string) => sha.slice(0, 16);

export const REPORT_INTRO = (d: ReportDoc) =>
  `Compiled ${when(d.compiled_at)} by NazAI Outer Control from ${d.opinions.length} external tool${d.opinions.length === 1 ? "" : "s"}. Every answer was checked against the account's rules before it was used.`;

export const REPORT_METHOD =
  "Each tool was asked on its own, in order. Each answer was checked against your rules before it was kept. " +
  "The summary, the agreements, the differences and the conclusion were written by NazAI's AI from those answers only. The opinions are word for word.";

/** The report as clean text: no markup, headings in capitals, bullets as •. This is the Task's controlled result. */
export function composeReportText(d: ReportDoc): string {
  const out: string[] = [];
  out.push("NAZAI REPORT", d.topic.replace(/\s+/g, " ").trim(), "", REPORT_INTRO(d), "");
  out.push("SUMMARY", d.summary, "");
  out.push("OPINIONS BY SOURCE");
  for (const o of d.opinions) {
    out.push("", `[${o.n}] ${o.tool} — received ${when(o.at)}`, o.text.trim());
    if (o.shortened) out.push("(Shortened for the report; the full controlled answer is stored in its step.)");
    out.push(`Fingerprint ${fingerprint(o.sha256)}`);
  }
  out.push("", "WHERE THEY AGREE");
  out.push(...(d.agreements.length ? d.agreements.map((x) => `• ${x}`) : ["• No shared points were identified."]));
  out.push("", "WHERE THEY DIFFER");
  out.push(...(d.differences.length ? d.differences.map((x) => `• ${x}`) : ["• No differences were identified."]));
  out.push("", "CONCLUSION", d.conclusion, "", "HOW THIS REPORT WAS MADE", REPORT_METHOD);
  return out.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const para = (s: string) => s.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

/** A self-contained, NazAI-styled page for the report: opens in any browser or Word, prints cleanly. */
export function reportHtml(d: ReportDoc): string {
  const list = (items: string[], empty: string) => `<ul>${(items.length ? items : [empty]).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NazAI report — ${esc(d.topic.slice(0, 80))}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#050b18;color:#dbe7ff;font:16px/1.65 "Segoe UI",system-ui,-apple-system,sans-serif;padding:40px 16px;background-image:radial-gradient(900px 420px at 15% -5%,rgba(34,211,238,.18),transparent 60%),radial-gradient(700px 400px at 100% 10%,rgba(59,130,246,.16),transparent 60%)}
main{max-width:820px;margin:0 auto}
.badge{display:inline-block;font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.18em;color:#67e8f9;border:1px solid rgba(103,232,249,.4);border-radius:999px;padding:7px 12px;background:rgba(34,211,238,.08)}
h1{font-size:30px;line-height:1.25;margin:18px 0 10px;color:#fff;font-weight:650}
.meta{color:#8fa6cc;font-size:14px;margin:0 0 28px}
section{margin:0 0 22px;padding:22px 24px;border:1px solid rgba(125,170,255,.18);border-radius:16px;background:linear-gradient(180deg,rgba(15,30,60,.7),rgba(8,16,34,.7))}
h2{margin:0 0 12px;font:600 12px/1 ui-monospace,Consolas,monospace;letter-spacing:.16em;color:#67e8f9;text-transform:uppercase}
p{margin:0 0 10px}ul{margin:0;padding-left:20px}li{margin:0 0 8px}
.summary{border-left:3px solid #22d3ee}
.src{display:flex;gap:14px;margin:0 0 14px}
.n{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:700;color:#04101f;background:linear-gradient(135deg,#67e8f9,#3b82f6)}
.src h3{margin:0;font-size:16px;color:#fff}.src small{color:#8fa6cc}
.quote{border-left:2px solid rgba(103,232,249,.5);padding-left:14px;color:#e8f0ff}
.fp{font:12px ui-monospace,Consolas,monospace;color:#7d93bb}
.agree h2{color:#6ee7b7}.differ h2{color:#fcd34d}
.conclusion{border-color:rgba(103,232,249,.45);background:linear-gradient(135deg,rgba(34,211,238,.12),rgba(59,130,246,.1))}
.method{color:#9db3d8;font-size:14px}
footer{color:#6f86ad;font-size:12px;text-align:center;margin-top:28px}
@media print{body{background:#fff;color:#111;padding:0}section{background:#fff;border-color:#cfd8e6;break-inside:avoid}h1,.src h3{color:#111}.meta,.method,.fp,.src small{color:#444}.quote{color:#111}.badge{color:#0b6e80;border-color:#0b6e80;background:#fff}h2{color:#0b6e80}}
</style></head><body><main>
<span class="badge">NAZAI REPORT</span>
<h1>${esc(d.topic.replace(/\s+/g, " ").trim())}</h1>
<p class="meta">${esc(REPORT_INTRO(d))}</p>
<section class="summary"><h2>Summary</h2>${para(d.summary)}</section>
<section><h2>Opinions by source</h2>${d.opinions.map((o) => `<div class="src"><div class="n">${o.n}</div><div><h3>${esc(o.tool)}</h3><small>Received ${esc(when(o.at))}</small><div class="quote">${para(o.text)}${o.shortened ? "<p class=\"fp\">Shortened for the report; the full controlled answer is stored in its step.</p>" : ""}</div><div class="fp">Fingerprint ${esc(fingerprint(o.sha256))}</div></div></div>`).join("")}</section>
<section class="agree"><h2>Where they agree</h2>${list(d.agreements, "No shared points were identified.")}</section>
<section class="differ"><h2>Where they differ</h2>${list(d.differences, "No differences were identified.")}</section>
<section class="conclusion"><h2>Conclusion</h2>${para(d.conclusion)}</section>
<section><h2>How this report was made</h2><p class="method">${esc(REPORT_METHOD)}</p></section>
<footer>Generated by NazAI Outer Control</footer>
</main></body></html>`;
}

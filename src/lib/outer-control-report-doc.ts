// Outer Control: the report as a document. The same structure is shown in the app (ReportView), downloaded as a styled
// page, and written as clean text (the Task's controlled result), so the three cannot disagree: the text is always
// `composeReportText(doc)`, and the app only shows the designed view when the stored text still equals it.
//
// Pure and dependency-free. THIS FILE EXISTS TWICE, byte for byte: src/lib/outer-control-report-doc.ts (the app) and
// supabase/functions/_shared/outer-control-report-doc.ts (the edge functions). A test fails when they differ.

export type ReportOpinion = { n: number; tool: string; text: string; shortened: boolean; sha256: string; at: string };

/**
 * The four multi-tool actions. opinions: several tools on one question, one summary of their views. compare: the same prompt to
 * 2–3 tools, a structured side-by-side. factcheck: tools challenge or verify a claim, one verdict. rewrite: a tool rewrites a text
 * in the requested styles. A document without a kind is an opinions report (the kind before the others existed).
 */
export type ReportKind = "opinions" | "compare" | "factcheck" | "rewrite";
export const REPORT_KINDS: ReportKind[] = ["opinions", "compare", "factcheck", "rewrite"];
export const VERDICTS = ["supported", "partly supported", "not supported", "cannot be verified"] as const;
export type Verdict = (typeof VERDICTS)[number];
/** One aspect of a comparison: what each source says about it, in source order (points[0] is source [1]). */
export type ComparisonRow = { aspect: string; points: string[] };
/** One rewritten version: the style asked for, by which source, word for word from its controlled answer. */
export type RewriteVersion = { n: number; style: string; text: string };

export type ReportDoc = {
  version: 1;
  kind?: ReportKind;
  topic: string;
  /** ISO time the report was compiled. */
  compiled_at: string;
  summary: string;
  opinions: ReportOpinion[];
  agreements: string[];
  differences: string[];
  conclusion: string;
  /** compare */
  comparison?: ComparisonRow[];
  /** factcheck */
  verdict?: Verdict;
  findings?: string[];
  corrections?: string[];
  /** rewrite: the text that was rewritten, the styles asked for, and the versions. */
  original?: string;
  styles?: string[];
  versions?: RewriteVersion[];
};

export const kindOf = (d: Pick<ReportDoc, "kind">): ReportKind => d.kind ?? "opinions";

/** How many tools each action takes and how long its text may be (the page and outer-control-drive check the same numbers). */
export const TASK_LIMITS: Record<ReportKind, { minTools: number; maxTools: number; maxText: number }> = {
  opinions: { minTools: 1, maxTools: 5, maxText: 600 },
  compare: { minTools: 2, maxTools: 3, maxText: 600 },
  factcheck: { minTools: 1, maxTools: 3, maxText: 1500 },
  // The text goes into the step instruction with the style headings, which must stay under 2000 characters.
  rewrite: { minTools: 1, maxTools: 3, maxText: 1200 },
};
export const MAX_STYLES = 4;

const isStr = (x: unknown): x is string => typeof x === "string";
const isStrList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);

export function isReportDoc(x: unknown): x is ReportDoc {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  const base = d.version === 1 && isStr(d.topic) && isStr(d.compiled_at) && isStr(d.summary) && isStr(d.conclusion) && isStrList(d.agreements) && isStrList(d.differences)
    && Array.isArray(d.opinions) && d.opinions.every((o) => !!o && typeof o === "object"
      && Number.isInteger((o as ReportOpinion).n) && isStr((o as ReportOpinion).tool) && isStr((o as ReportOpinion).text) && typeof (o as ReportOpinion).shortened === "boolean"
      && isStr((o as ReportOpinion).sha256) && isStr((o as ReportOpinion).at));
  if (!base) return false;
  if (d.kind !== undefined && !REPORT_KINDS.includes(d.kind as ReportKind)) return false;
  if (d.comparison !== undefined && !(Array.isArray(d.comparison) && d.comparison.every((r) => !!r && typeof r === "object" && isStr((r as ComparisonRow).aspect) && isStrList((r as ComparisonRow).points)))) return false;
  if (d.verdict !== undefined && !(VERDICTS as readonly string[]).includes(d.verdict as string)) return false;
  for (const k of ["findings", "corrections", "styles"]) if (d[k] !== undefined && !isStrList(d[k])) return false;
  if (d.original !== undefined && !isStr(d.original)) return false;
  if (d.versions !== undefined && !(Array.isArray(d.versions) && d.versions.every((v) => !!v && typeof v === "object" && Number.isInteger((v as RewriteVersion).n) && isStr((v as RewriteVersion).style) && isStr((v as RewriteVersion).text)))) return false;
  return true;
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

/** The badge at the top of each kind of result. */
export const KIND_BADGE: Record<ReportKind, string> = { opinions: "NAZAI REPORT", compare: "NAZAI COMPARISON", factcheck: "NAZAI FACT-CHECK", rewrite: "NAZAI REWRITE" };
/** What each kind is called in a sentence ("How this … was made"). */
export const KIND_NOUN: Record<ReportKind, string> = { opinions: "report", compare: "comparison", factcheck: "fact-check", rewrite: "rewrite" };
export const VERDICT_LABEL: Record<Verdict, string> = { supported: "Supported", "partly supported": "Partly supported", "not supported": "Not supported", "cannot be verified": "Cannot be verified" };

export function kindMethod(d: ReportDoc): string {
  switch (kindOf(d)) {
    case "compare":
      return "Each tool was given the same prompt on its own, in order. Each answer was checked against your rules before it was kept. " +
        "The summary, the side-by-side, the agreements, the differences and the conclusion were written by NazAI's AI from those answers only. The answers are word for word.";
    case "factcheck":
      return "Each tool was asked on its own to challenge or verify the claim. Each answer was checked against your rules before it was kept. " +
        "The verdict, the findings and the corrections were written by NazAI's AI from those answers only. The answers are word for word.";
    case "rewrite":
      return "The text was sent to the tool with the styles you asked for. Its answer was checked against your rules before it was kept. " +
        "The versions are word for word from that checked answer; nothing was added by NazAI.";
    default:
      return REPORT_METHOD;
  }
}

/** The answers of every source, as clean text lines. */
function sourceLines(d: ReportDoc): string[] {
  const out: string[] = [];
  for (const o of d.opinions) {
    out.push("", `[${o.n}] ${o.tool} — received ${when(o.at)}`, o.text.trim());
    if (o.shortened) out.push("(Shortened for the report; the full controlled answer is stored in its step.)");
    out.push(`Fingerprint ${fingerprint(o.sha256)}`);
  }
  return out;
}
const bullets = (items: string[], empty: string) => (items.length ? items.map((x) => `• ${x}`) : [`• ${empty}`]);

/** The result as clean text: no markup, headings in capitals, bullets as •. This is the Task's controlled result. */
export function composeReportText(d: ReportDoc): string {
  const out: string[] = [];
  const kind = kindOf(d);
  const topic = d.topic.replace(/\s+/g, " ").trim();
  if (kind === "rewrite") {
    out.push(KIND_BADGE.rewrite, topic, "", REPORT_INTRO(d), "", "ORIGINAL", (d.original ?? d.topic).trim());
    for (const v of d.versions ?? []) {
      const tool = d.opinions.find((o) => o.n === v.n)?.tool ?? "tool";
      out.push("", `STYLE: ${v.style.toUpperCase()} — by ${tool} [${v.n}]`, v.text.trim());
    }
    out.push("", `HOW THIS ${KIND_NOUN.rewrite.toUpperCase()} WAS MADE`, kindMethod(d));
    return out.join("\n");
  }
  out.push(KIND_BADGE[kind], topic, "", REPORT_INTRO(d), "");
  if (kind === "factcheck") {
    out.push("VERDICT", `${VERDICT_LABEL[d.verdict ?? "cannot be verified"]}. ${d.summary}`.trim(), "");
    out.push("FINDINGS", ...bullets(d.findings ?? [], "No findings were given."), "");
    out.push("CORRECTIONS", ...bullets(d.corrections ?? [], "No corrections were needed."), "");
    out.push("ANSWERS BY SOURCE", ...sourceLines(d));
    out.push("", "CONCLUSION", d.conclusion, "", "HOW THIS FACT-CHECK WAS MADE", kindMethod(d));
    return out.join("\n");
  }
  out.push("SUMMARY", d.summary, "");
  out.push(kind === "compare" ? "ANSWERS BY SOURCE" : "OPINIONS BY SOURCE", ...sourceLines(d));
  if (kind === "compare") {
    out.push("", "SIDE BY SIDE");
    for (const r of d.comparison ?? []) {
      out.push("", r.aspect);
      r.points.forEach((p, i) => out.push(`• [${i + 1}] ${d.opinions[i]?.tool ?? "tool"}: ${p}`));
    }
  }
  out.push("", "WHERE THEY AGREE", ...bullets(d.agreements, "No shared points were identified."));
  out.push("", "WHERE THEY DIFFER", ...bullets(d.differences, "No differences were identified."));
  out.push("", "CONCLUSION", d.conclusion, "", `HOW THIS ${KIND_NOUN[kind].toUpperCase()} WAS MADE`, kindMethod(d));
  return out.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const para = (s: string) => s.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

/** A self-contained, NazAI-styled page for the result: opens in any browser or Word, prints cleanly. */
export function reportHtml(d: ReportDoc): string {
  const kind = kindOf(d);
  const list = (items: string[], empty: string) => `<ul>${(items.length ? items : [empty]).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const sources = (title: string) => `<section><h2>${title}</h2>${d.opinions.map((o) => `<div class="src"><div class="n">${o.n}</div><div><h3>${esc(o.tool)}</h3><small>Received ${esc(when(o.at))}</small><div class="quote">${para(o.text)}${o.shortened ? "<p class=\"fp\">Shortened for the report; the full controlled answer is stored in its step.</p>" : ""}</div><div class="fp">Fingerprint ${esc(fingerprint(o.sha256))}</div></div></div>`).join("")}</section>`;
  const agreeDiffer = `<section class="agree"><h2>Where they agree</h2>${list(d.agreements, "No shared points were identified.")}</section>
<section class="differ"><h2>Where they differ</h2>${list(d.differences, "No differences were identified.")}</section>`;
  const conclusion = `<section class="conclusion"><h2>Conclusion</h2>${para(d.conclusion)}</section>`;
  let body: string;
  if (kind === "rewrite") {
    body = `<section class="summary"><h2>Original</h2>${para(d.original ?? d.topic)}</section>
<section><h2>Rewritten versions</h2>${(d.versions ?? []).map((v) => `<div class="style"><h3>${esc(v.style)} <small>— by ${esc(d.opinions.find((o) => o.n === v.n)?.tool ?? "tool")} [${v.n}]</small></h3><div class="quote">${para(v.text)}</div></div>`).join("")}</section>`;
  } else if (kind === "factcheck") {
    body = `<section class="summary"><h2>Verdict</h2><p class="verdict">${esc(VERDICT_LABEL[d.verdict ?? "cannot be verified"])}</p>${para(d.summary)}</section>
<section><h2>Findings</h2>${list(d.findings ?? [], "No findings were given.")}</section>
<section class="differ"><h2>Corrections</h2>${list(d.corrections ?? [], "No corrections were needed.")}</section>
${sources("Answers by source")}
${conclusion}`;
  } else if (kind === "compare") {
    const head = d.opinions.map((o) => `<th>[${o.n}] ${esc(o.tool)}</th>`).join("");
    const rows = (d.comparison ?? []).map((r) => `<tr><th>${esc(r.aspect)}</th>${r.points.map((p) => `<td>${esc(p)}</td>`).join("")}</tr>`).join("");
    body = `<section class="summary"><h2>Summary</h2>${para(d.summary)}</section>
<section><h2>Side by side</h2><table><tr><th>Aspect</th>${head}</tr>${rows}</table></section>
${sources("Answers by source")}
${agreeDiffer}
${conclusion}`;
  } else {
    body = `<section class="summary"><h2>Summary</h2>${para(d.summary)}</section>
${sources("Opinions by source")}
${agreeDiffer}
${conclusion}`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NazAI ${KIND_NOUN[kind]} — ${esc(d.topic.slice(0, 80))}</title>
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
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-top:1px solid rgba(125,170,255,.18)}th{color:#67e8f9;font-weight:600}.verdict{font-size:22px;font-weight:650;color:#fff;margin:0 0 8px}.style{margin:0 0 16px}.style h3{margin:0 0 6px;font-size:15px;color:#fff}
footer{color:#6f86ad;font-size:12px;text-align:center;margin-top:28px}
@media print{body{background:#fff;color:#111;padding:0}section{background:#fff;border-color:#cfd8e6;break-inside:avoid}h1,.src h3{color:#111}.meta,.method,.fp,.src small{color:#444}.quote{color:#111}.badge{color:#0b6e80;border-color:#0b6e80;background:#fff}h2{color:#0b6e80}}
</style></head><body><main>
<span class="badge">${KIND_BADGE[kind]}</span>
<h1>${esc(d.topic.replace(/\s+/g, " ").trim())}</h1>
<p class="meta">${esc(REPORT_INTRO(d))}</p>
${body}
<section><h2>How this ${KIND_NOUN[kind]} was made</h2><p class="method">${esc(kindMethod(d))}</p></section>
<footer>Generated by NazAI Outer Control</footer>
</main></body></html>`;
}

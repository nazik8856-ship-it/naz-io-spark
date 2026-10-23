// Outer Control: the report as a document. The same structure is shown in the app (ReportView), downloaded as a styled
// page, and written as clean text (the Task's controlled result), so the three cannot disagree: the text is always
// `composeReportText(doc)`, and the app only shows the designed view when the stored text still equals it.
//
// Pure and dependency-free. THIS FILE EXISTS TWICE, byte for byte: src/lib/outer-control-report-doc.ts (the app) and
// supabase/functions/_shared/outer-control-report-doc.ts (the edge functions). A test fails when they differ.

export type ReportOpinion = { n: number; tool: string; text: string; shortened: boolean; sha256: string; at: string };

/**
 * The multi-tool actions. opinions: several tools on one question, one summary of their views. compare: the same prompt to 2–3
 * tools, a structured side-by-side. factcheck: tools challenge or verify a claim, one verdict. rewrite: a tool rewrites a text in
 * the requested styles. research: points on a topic from several tools, one synthesis. draft: one tool drafts, another (or the same)
 * improves it; only the improved version is the result. alternatives: several different options. explain: a simple explanation of a
 * complex text. keypoints: the key points of a long text. roles: an answer per requested role. multistep: a goal broken into steps,
 * each step done by a tool, then one solution. decision: options with pros and cons and a recommendation. adapt: one message adapted
 * for each audience or platform. delegate: a task split into parts, each part done by a different tool, then combined.
 * A document without a kind is an opinions report (the kind before the others existed).
 */
export type ReportKind =
  | "opinions" | "compare" | "factcheck" | "rewrite"
  | "research" | "draft" | "alternatives" | "explain" | "keypoints" | "roles" | "multistep" | "decision" | "adapt" | "delegate";
export const REPORT_KINDS: ReportKind[] = ["opinions", "compare", "factcheck", "rewrite", "research", "draft", "alternatives", "explain", "keypoints", "roles", "multistep", "decision", "adapt", "delegate"];
export const VERDICTS = ["supported", "partly supported", "not supported", "cannot be verified"] as const;
export type Verdict = (typeof VERDICTS)[number];
/** One aspect of a comparison: what each source says about it, in source order (points[0] is source [1]). */
export type ComparisonRow = { aspect: string; points: string[] };
/** One version (a style, a role, an audience): by which source, word for word from its controlled answer. */
export type RewriteVersion = { n: number; style: string; text: string };
/** One option, step or part: its label, by which source, its text word for word from that source's controlled answer. */
export type LabeledItem = { n: number; label: string; text: string };
/** One option of a decision, with its pros and cons. */
export type DecisionOption = { option: string; pros: string[]; cons: string[] };

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
  /** rewrite, roles, adapt: the text (or question) given, the styles / roles / audiences asked for, and one version each. explain, keypoints: the text given. */
  original?: string;
  styles?: string[];
  versions?: RewriteVersion[];
  /** research, keypoints */
  points?: string[];
  /** research */
  open_questions?: string[];
  /** draft (the improved version), explain (the explanation), multistep (the solution), delegate (the combined result) */
  output?: string;
  /** alternatives (options), multistep (steps), delegate (parts) */
  items?: LabeledItem[];
  /** decision */
  decision?: DecisionOption[];
  risks?: string[];
  /** The tools that were asked but did not answer; the result was written from the others. */
  missing?: MissingTool[];
  /** The tools were asked at the same time (not one after another). */
  parallel?: boolean;
};
export type MissingTool = { tool: string; reason: string };

export const kindOf = (d: Pick<ReportDoc, "kind">): ReportKind => d.kind ?? "opinions";

export type ActionLimits = {
  minTools: number; maxTools: number; maxText: number;
  /** A list the action needs: styles (rewrite), roles (roles), audiences (adapt). */
  labels?: "styles" | "roles" | "audiences";
  /** How many options to ask for (alternatives). */
  options?: { min: number; max: number };
};

/** How many tools each action takes and how long its text may be (the page and outer-control-drive check the same numbers). */
export const TASK_LIMITS: Record<ReportKind, ActionLimits> = {
  opinions: { minTools: 1, maxTools: 5, maxText: 600 },
  compare: { minTools: 2, maxTools: 3, maxText: 600 },
  factcheck: { minTools: 1, maxTools: 3, maxText: 1500 },
  // A text that goes into the step instruction with one heading per label must leave room for them under 2000 characters.
  rewrite: { minTools: 1, maxTools: 3, maxText: 1200, labels: "styles" },
  research: { minTools: 1, maxTools: 5, maxText: 600 },
  draft: { minTools: 1, maxTools: 2, maxText: 1200 },
  alternatives: { minTools: 1, maxTools: 3, maxText: 600, options: { min: 2, max: 5 } },
  explain: { minTools: 1, maxTools: 1, maxText: 1500 },
  keypoints: { minTools: 1, maxTools: 1, maxText: 1500 },
  roles: { minTools: 1, maxTools: 3, maxText: 600, labels: "roles" },
  multistep: { minTools: 1, maxTools: 3, maxText: 600 },
  decision: { minTools: 1, maxTools: 3, maxText: 600 },
  adapt: { minTools: 1, maxTools: 3, maxText: 1200, labels: "audiences" },
  delegate: { minTools: 2, maxTools: 4, maxText: 600 },
};
export const MAX_STYLES = 4;
export const MAX_BACKGROUND = 1500;

/** How a Task's title starts, by action: "Comparison: …". The Task's title carries the action, so no new column is needed. */
export const TITLE_PREFIX: Record<ReportKind, string> = {
  opinions: "Multiple opinions", compare: "Comparison", factcheck: "Fact-check", rewrite: "Rewrite", research: "Research", draft: "Draft",
  alternatives: "Alternatives", explain: "Explain simply", keypoints: "Key points", roles: "Role answers", multistep: "Multi-step", decision: "Decision",
  adapt: "Adaptation", delegate: "Delegated task",
};

/** A Task's title split into its action and its text, for showing it; null when it is not a multi-tool action's title. */
export function splitTaskTitle(objective: string): { kind: ReportKind; text: string } | null {
  const o = objective.trim();
  const pairs: [ReportKind, string][] = [...REPORT_KINDS.map((k) => [k, TITLE_PREFIX[k]] as [ReportKind, string]), ["opinions", "Report"]];
  for (const [kind, prefix] of pairs.sort((a, b) => b[1].length - a[1].length)) {
    if (o.toLowerCase().startsWith(prefix.toLowerCase())) {
      const m = o.slice(prefix.length).match(/^(?: \([^)]*\))?:\s*([\s\S]*)$/);
      if (m) return { kind, text: m[1].trim() };
    }
  }
  return null;
}

/**
 * Credits each action uses. One setting per action, so a price can change in one place. 1 for every action during the MVP; the
 * credits come back when the Task ends without a result (refund_workflow_credit gives back one, so a price above 1 needs that too).
 */
export const TASK_CREDITS: Record<ReportKind, number> = {
  opinions: 1, compare: 1, factcheck: 1, rewrite: 1, research: 1, draft: 1, alternatives: 1, explain: 1, keypoints: 1, roles: 1, multistep: 1, decision: 1, adapt: 1, delegate: 1,
};

/** The actions whose result is written by NazAI's AI (the others are collected word for word from the checked answers). */
export const NEEDS_AI: ReportKind[] = ["opinions", "compare", "factcheck", "research", "decision", "multistep", "delegate"];
/** The actions whose text is a question or request (so tool names in it may choose the tools); in the others it is content. */
export const ROUTING_TEXT: ReportKind[] = ["opinions", "compare", "research", "draft", "alternatives", "roles", "multistep", "decision", "delegate"];

/** Each action's name and one line on what it does (the Change menu, the plan line, NazAI's reading of a request). */
export const ACTION_INFO: Record<ReportKind, { title: string; blurb: string }> = {
  opinions: { title: "Get multiple opinions", blurb: "several tools give their view on one question; one summary of their views" },
  compare: { title: "Compare answers", blurb: "the same prompt to 2–3 tools; a side-by-side comparison of their answers" },
  factcheck: { title: "Fact-check / challenge", blurb: "tools verify or challenge a claim or text; one verdict with corrections" },
  rewrite: { title: "Rewrite in different styles", blurb: "a text rewritten in the styles asked for (more formal, simpler, …)" },
  research: { title: "Research & synthesize", blurb: "tools give points on a topic; one combined synthesis" },
  draft: { title: "Draft + improve", blurb: "one tool writes a draft, another (or the same) improves it; only the improved version is shown" },
  alternatives: { title: "Generate alternatives", blurb: "several different approaches or options for one need" },
  explain: { title: "Explain simply", blurb: "a complex text explained in plain words" },
  keypoints: { title: "Extract key points", blurb: "the most important points of a long text, as a list" },
  roles: { title: "Role-based answers", blurb: "an answer from each role asked for (lawyer, marketer, technical, …)" },
  multistep: { title: "Multi-step problem solving", blurb: "a bigger goal broken into steps, tools do the steps, then one solution" },
  decision: { title: "Decision support", blurb: "options with pros and cons and one recommendation" },
  adapt: { title: "Content adaptation", blurb: "one message adapted for each audience or platform asked for" },
  delegate: { title: "Multi-AI task delegation", blurb: "a larger task split into parts, each part done by a different tool, then combined" },
};

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
  for (const k of ["points", "open_questions", "risks"]) if (d[k] !== undefined && !isStrList(d[k])) return false;
  if (d.output !== undefined && !isStr(d.output)) return false;
  if (d.items !== undefined && !(Array.isArray(d.items) && d.items.every((v) => !!v && typeof v === "object" && Number.isInteger((v as LabeledItem).n) && isStr((v as LabeledItem).label) && isStr((v as LabeledItem).text)))) return false;
  if (d.missing !== undefined && !(Array.isArray(d.missing) && d.missing.every((m) => !!m && typeof m === "object" && isStr((m as MissingTool).tool) && isStr((m as MissingTool).reason)))) return false;
  if (d.parallel !== undefined && typeof d.parallel !== "boolean") return false;
  if (d.decision !== undefined && !(Array.isArray(d.decision) && d.decision.every((o) => !!o && typeof o === "object" && isStr((o as DecisionOption).option) && isStrList((o as DecisionOption).pros) && isStrList((o as DecisionOption).cons)))) return false;
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

/** The tools that did not answer, as one sentence; empty when every tool answered. */
export const missingLine = (d: Pick<ReportDoc, "missing">) =>
  d.missing?.length ? `Not included because ${d.missing.length === 1 ? "it" : "they"} did not answer: ${d.missing.map((m) => `${m.tool} (${m.reason.replace(/\.$/, "")})`).join("; ")}.` : "";

export const REPORT_INTRO = (d: ReportDoc) =>
  `Compiled ${when(d.compiled_at)} by NazAI Outer Control from ${d.opinions.length} external tool${d.opinions.length === 1 ? "" : "s"}. Every answer was checked against the account's rules before it was used.` +
  (d.missing?.length ? ` ${missingLine(d)}` : "");

export const REPORT_METHOD =
  "Each tool was asked on its own, in order. Each answer was checked against your rules before it was kept. " +
  "The summary, the agreements, the differences and the conclusion were written by NazAI's AI from those answers only. The opinions are word for word.";

/** The badge at the top of each kind of result. */
export const KIND_BADGE: Record<ReportKind, string> = {
  opinions: "NAZAI REPORT", compare: "NAZAI COMPARISON", factcheck: "NAZAI FACT-CHECK", rewrite: "NAZAI REWRITE", research: "NAZAI RESEARCH",
  draft: "NAZAI DRAFT", alternatives: "NAZAI ALTERNATIVES", explain: "NAZAI EXPLANATION", keypoints: "NAZAI KEY POINTS", roles: "NAZAI ROLE ANSWERS",
  multistep: "NAZAI SOLUTION", decision: "NAZAI DECISION", adapt: "NAZAI ADAPTATION", delegate: "NAZAI DELEGATED TASK",
};
/** What each kind is called in a sentence ("How this … was made"). */
export const KIND_NOUN: Record<ReportKind, string> = {
  opinions: "report", compare: "comparison", factcheck: "fact-check", rewrite: "rewrite", research: "research", draft: "draft",
  alternatives: "set of alternatives", explain: "explanation", keypoints: "list of key points", roles: "set of role answers",
  multistep: "solution", decision: "decision support", adapt: "adaptation", delegate: "delegated task",
};
export const VERDICT_LABEL: Record<Verdict, string> = { supported: "Supported", "partly supported": "Partly supported", "not supported": "Not supported", "cannot be verified": "Cannot be verified" };
/** The heading word of a version, by kind. */
const VERSION_WORD: Partial<Record<ReportKind, string>> = { rewrite: "Style", roles: "Role", adapt: "For" };
/** The heading word of an item, by kind. */
const ITEM_WORD: Partial<Record<ReportKind, string>> = { alternatives: "Option", multistep: "Step", delegate: "Part" };

const CHECKED = "Each answer was checked against your rules before it was kept.";
const WORD_FOR_WORD = "nothing was added by NazAI";

export function kindMethod(d: ReportDoc): string {
  switch (kindOf(d)) {
    case "compare":
      return `Each tool was given the same prompt on its own, ${d.parallel ? "at the same time" : "in order"}. ${CHECKED} ` +
        "The summary, the side-by-side, the agreements, the differences and the conclusion were written by NazAI's AI from those answers only. The answers are word for word.";
    case "factcheck":
      return `Each tool was asked on its own to challenge or verify the claim. ${CHECKED} ` +
        "The verdict, the findings and the corrections were written by NazAI's AI from those answers only. The answers are word for word.";
    case "rewrite":
      return "The text was sent to the tool with the styles you asked for. Its answer was checked against your rules before it was kept. " +
        `The versions are word for word from that checked answer; ${WORD_FOR_WORD}.`;
    case "research":
      return `Each tool was asked on its own for the key points on the topic. ${CHECKED} The summary, the key points, the open questions and the conclusion were written by NazAI's AI from those answers only. The answers are word for word.`;
    case "draft":
      return `One tool wrote a draft, which was checked against your rules; a tool then improved the checked draft, and that answer was checked too. The final version is word for word from the checked improvement; ${WORD_FOR_WORD}.`;
    case "alternatives":
      return `Each tool was asked on its own for different options. ${CHECKED} The options are word for word from the checked answers; ${WORD_FOR_WORD}.`;
    case "explain":
      return `The text was sent to the tool to be explained simply. Its answer was checked against your rules before it was kept. The explanation is word for word from that checked answer; ${WORD_FOR_WORD}.`;
    case "keypoints":
      return `The text was sent to the tool to pull out its key points. Its answer was checked against your rules before it was kept. The points are word for word from that checked answer; ${WORD_FOR_WORD}.`;
    case "roles":
      return `The question was sent to the tool with the roles you asked for, and your rules still applied. Its answer was checked against your rules before it was kept. The answers are word for word from that checked answer; ${WORD_FOR_WORD}.`;
    case "multistep":
      return `NazAI's AI broke the goal into steps. Each step was done by a tool, which received the previous step's checked result; ${CHECKED.toLowerCase()} The solution was written by NazAI's AI from the checked step results only.`;
    case "decision":
      return `Each tool was asked on its own for options, pros, cons and a recommendation. ${CHECKED} The options, the recommendation and the risks were written by NazAI's AI from those answers only. The answers are word for word.`;
    case "adapt":
      return `The message was sent to the tool with the audiences and platforms you asked for. Its answer was checked against your rules (brand and safety rules included) before it was kept. The versions are word for word from that checked answer; ${WORD_FOR_WORD}.`;
    case "delegate":
      return `NazAI's AI split the task into parts and gave each part to a different tool, on its own. ${CHECKED} The final result was written by NazAI's AI from the checked parts only, and it uses every part.`;
    default:
      return d.parallel ? REPORT_METHOD.replace("on its own, in order.", "on its own, at the same time.") : REPORT_METHOD;
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
  const how = () => out.push("", `HOW THIS ${KIND_NOUN[kind].toUpperCase()} WAS MADE`, kindMethod(d));
  const toolOf = (n: number) => d.opinions.find((o) => o.n === n)?.tool ?? "tool";
  if (kind === "rewrite" || kind === "roles" || kind === "adapt") {
    const lead = kind === "rewrite" ? "ORIGINAL" : kind === "roles" ? "QUESTION" : "MESSAGE";
    out.push(KIND_BADGE[kind], topic, "", REPORT_INTRO(d), "", lead, (d.original ?? d.topic).trim());
    for (const v of d.versions ?? []) out.push("", `${VERSION_WORD[kind]!.toUpperCase()}: ${v.style.toUpperCase()} — by ${toolOf(v.n)} [${v.n}]`, v.text.trim());
    how();
    return out.join("\n");
  }
  if (kind === "explain" || kind === "keypoints") {
    const n = d.opinions[0]?.n ?? 1;
    out.push(KIND_BADGE[kind], topic, "", REPORT_INTRO(d), "", "ORIGINAL", (d.original ?? d.topic).trim(), "");
    if (kind === "explain") out.push(`SIMPLE EXPLANATION — by ${toolOf(n)} [${n}]`, (d.output ?? "").trim());
    else out.push(`KEY POINTS — by ${toolOf(n)} [${n}]`, ...bullets(d.points ?? [], "No key points were given."));
    how();
    return out.join("\n");
  }
  if (kind === "draft") {
    const [a, b] = [d.opinions[0], d.opinions[d.opinions.length - 1]];
    out.push(KIND_BADGE.draft, topic, "", REPORT_INTRO(d), "", "FINAL VERSION", (d.output ?? "").trim(), "");
    out.push(`Drafted by ${a?.tool ?? "tool"} [${a?.n ?? 1}], improved by ${b?.tool ?? "tool"} [${b?.n ?? 2}]. The draft is kept in the Task's proof.`);
    how();
    return out.join("\n");
  }
  if (kind === "alternatives" || kind === "multistep" || kind === "delegate") {
    const word = ITEM_WORD[kind]!.toUpperCase();
    out.push(KIND_BADGE[kind], topic, "", REPORT_INTRO(d), "");
    if (kind !== "alternatives") out.push("SUMMARY", d.summary, "");
    out.push(kind === "alternatives" ? "OPTIONS" : kind === "multistep" ? "STEPS" : "PARTS");
    (d.items ?? []).forEach((it, i) => out.push("", `${word} ${i + 1}: ${it.label} — by ${toolOf(it.n)} [${it.n}]`, it.text.trim()));
    if (kind !== "alternatives") out.push("", kind === "multistep" ? "SOLUTION" : "FINAL RESULT", (d.output ?? "").trim());
    how();
    return out.join("\n");
  }
  if (kind === "decision") {
    out.push(KIND_BADGE.decision, topic, "", REPORT_INTRO(d), "", "SUMMARY", d.summary, "", "OPTIONS");
    for (const o of d.decision ?? []) out.push("", o.option, "Pros:", ...bullets(o.pros, "None given."), "Cons:", ...bullets(o.cons, "None given."));
    out.push("", "RECOMMENDATION", d.conclusion, "", "RISKS", ...bullets(d.risks ?? [], "No risks were named."), "", "ANSWERS BY SOURCE", ...sourceLines(d));
    how();
    return out.join("\n");
  }
  if (kind === "research") {
    out.push(KIND_BADGE.research, topic, "", REPORT_INTRO(d), "", "SUMMARY", d.summary, "", "KEY POINTS", ...bullets(d.points ?? [], "No key points were given."));
    out.push("", "OPEN QUESTIONS", ...bullets(d.open_questions ?? [], "No open questions were named."), "", "ANSWERS BY SOURCE", ...sourceLines(d));
    out.push("", "CONCLUSION", d.conclusion);
    how();
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
  const toolOf = (n: number) => esc(d.opinions.find((o) => o.n === n)?.tool ?? "tool");
  const block = (head: string, n: number, text: string) => `<div class="style"><h3>${head} <small>— by ${toolOf(n)} [${n}]</small></h3><div class="quote">${para(text)}</div></div>`;
  if (kind === "rewrite" || kind === "roles" || kind === "adapt") {
    const lead = kind === "rewrite" ? "Original" : kind === "roles" ? "Question" : "Message";
    const title = kind === "rewrite" ? "Rewritten versions" : kind === "roles" ? "Answers by role" : "Adapted versions";
    body = `<section class="summary"><h2>${lead}</h2>${para(d.original ?? d.topic)}</section>
<section><h2>${title}</h2>${(d.versions ?? []).map((v) => block(`${kind === "rewrite" ? "" : `${VERSION_WORD[kind]}: `}${esc(v.style)}`, v.n, v.text)).join("")}</section>`;
  } else if (kind === "explain" || kind === "keypoints") {
    const n = d.opinions[0]?.n ?? 1;
    body = `<section><h2>Original</h2>${para(d.original ?? d.topic)}</section>
<section class="summary"><h2>${kind === "explain" ? "Simple explanation" : "Key points"} <small>— by ${toolOf(n)} [${n}]</small></h2>${kind === "explain" ? para(d.output ?? "") : list(d.points ?? [], "No key points were given.")}</section>`;
  } else if (kind === "draft") {
    const [a, b] = [d.opinions[0], d.opinions[d.opinions.length - 1]];
    body = `<section class="summary"><h2>Final version</h2>${para(d.output ?? "")}</section>
<section><p class="method">Drafted by ${esc(a?.tool ?? "tool")} [${a?.n ?? 1}], improved by ${esc(b?.tool ?? "tool")} [${b?.n ?? 2}]. The draft is kept in the Task's proof.</p></section>`;
  } else if (kind === "alternatives" || kind === "multistep" || kind === "delegate") {
    const word = ITEM_WORD[kind]!;
    const items = `<section><h2>${kind === "alternatives" ? "Options" : kind === "multistep" ? "Steps" : "Parts"}</h2>${(d.items ?? []).map((it, i) => block(`${word} ${i + 1}: ${esc(it.label)}`, it.n, it.text)).join("")}</section>`;
    body = kind === "alternatives" ? items : `<section class="summary"><h2>Summary</h2>${para(d.summary)}</section>
${items}
<section class="conclusion"><h2>${kind === "multistep" ? "Solution" : "Final result"}</h2>${para(d.output ?? "")}</section>`;
  } else if (kind === "decision") {
    const rows = (d.decision ?? []).map((o) => `<tr><th>${esc(o.option)}</th><td>${list(o.pros, "None given.")}</td><td>${list(o.cons, "None given.")}</td></tr>`).join("");
    body = `<section class="summary"><h2>Summary</h2>${para(d.summary)}</section>
<section><h2>Options</h2><table><tr><th>Option</th><th>Pros</th><th>Cons</th></tr>${rows}</table></section>
<section class="conclusion"><h2>Recommendation</h2>${para(d.conclusion)}</section>
<section class="differ"><h2>Risks</h2>${list(d.risks ?? [], "No risks were named.")}</section>
${sources("Answers by source")}`;
  } else if (kind === "research") {
    body = `<section class="summary"><h2>Summary</h2>${para(d.summary)}</section>
<section class="agree"><h2>Key points</h2>${list(d.points ?? [], "No key points were given.")}</section>
<section class="differ"><h2>Open questions</h2>${list(d.open_questions ?? [], "No open questions were named.")}</section>
${sources("Answers by source")}
${conclusion}`;
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

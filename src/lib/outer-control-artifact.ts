// Outer Control: the final artifact. When a session or a Task is Completed, this record is the official result:
// the controlled output, a short proof of what was done, the rules that applied, and what was changed. It exists in
// two forms from one source: structured (the object itself, JSON) and human-readable (`human_text`, rendered from the
// object by `renderArtifactText`, so the two cannot disagree).
//
// Pure and dependency-free. THIS FILE EXISTS TWICE, byte for byte: src/lib/outer-control-artifact.ts (the app) and
// supabase/functions/_shared/outer-control-artifact.ts (the edge functions). A test fails when they differ.

import { isReportDoc, type ReportDoc } from "./outer-control-report-doc.ts";

export const ARTIFACT_VERSION = 1;

export type ArtifactCriterion = { id: string; label: string; ok: boolean | null; detail: string };
export type RuleInForce = { name: string; action: string };
export type RuleTriggered = { rule: string; step: number; effect: string };
export type ArtifactChange = { step: number; rule: string; what: string };

export type ArtifactRules = { in_force: RuleInForce[]; triggered: RuleTriggered[] };
/** A link to the completed work (e.g. the calendar event that was created). Only http(s) links are kept. */
export type ArtifactLink = { url: string; label: string };

export type SessionArtifact = {
  version: number;
  kind: "session";
  id: string;
  task_id: string | null;
  objective: string;
  tool: string;
  completed_at: string;
  /** The controlled version: the only text that counts as this session's result. */
  final_output: string;
  output_sha256: string;
  /** One line: what was done ("Created Google Calendar event", "Got an answer from Bot2"). */
  what_done?: string;
  /** Links to the completed work found in the controlled result. */
  links?: ArtifactLink[];
  /** For a report: the report as a document. The app shows the designed view only while the result still equals its text. */
  report?: ReportDoc;
  proof: {
    checklist_passed: true;
    summary: string;
    criteria: ArtifactCriterion[];
    exchanges: number;
    decided_by: "tool" | "person";
  };
  rules: ArtifactRules;
  changes: ArtifactChange[];
  human_text: string;
};

export type TaskArtifactStep = { step: number; tool: string; status: string; output_sha256: string | null };
export type TaskArtifactHandoff = { from: number | null; from_label: string; to: number; outcome: string; rules: string[] };

export type TaskArtifact = {
  version: number;
  kind: "task";
  id: string;
  request: string;
  origin: { source_model: string; verdict: string } | null;
  completed_at: string;
  final_output: string;
  final_step: number;
  output_sha256: string;
  what_done?: string;
  links?: ArtifactLink[];
  report?: ReportDoc;
  proof: { steps_total: number; steps_done: number; all_checklists_passed: true; steps: TaskArtifactStep[] };
  handoffs: TaskArtifactHandoff[];
  rules: ArtifactRules;
  changes: ArtifactChange[];
  human_text: string;
};

export type Artifact = SessionArtifact | TaskArtifact;

const SHA = /^[0-9a-f]{64}$/i;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const mark = (ok: boolean | null) => (ok === true ? "✓" : ok === false ? "✗" : "–");

// ---------------------------------------------------------------------------------------
// Links to the completed work

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** A clean http(s) link, or null. No credentials in the address, no other schemes. */
export function cleanUrl(raw: string): string | null {
  const trimmed = raw.replace(/[.,;:!?]+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString().length <= 500 ? u.toString() : null;
  } catch { return null; }
}

/** The http(s) links in a text, in order, without duplicates. Each is labelled with its host. */
export function extractLinks(text: string | null | undefined, max = 5): ArtifactLink[] {
  const out: ArtifactLink[] = [];
  const seen = new Set<string>();
  for (const m of (text ?? "").match(URL_RE) ?? []) {
    const url = cleanUrl(m);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label: new URL(url).hostname.replace(/^www\./, "") });
    if (out.length >= max) break;
  }
  return out;
}

/** The one line that says what was done. Real actions an agent took come first; otherwise the reply that was accepted. */
export function describeWhatDone(i: {
  tool: string; objective: string; exchanges: number; changes: number;
  actions?: { summary: string; ok?: boolean }[];
}): string {
  const done = (i.actions ?? []).filter((a) => a.ok !== false && a.summary.trim()).map((a) => a.summary.trim().replace(/\s+/g, " "));
  if (done.length) return clip(`${i.tool} did: ${done.slice(0, 3).join("; ")}${done.length > 3 ? `; and ${done.length - 3} more` : ""}`, 300);
  const parts = [`Got a checked reply from ${i.tool} for "${clip(i.objective.replace(/\s+/g, " ").trim(), 90)}"`];
  if (i.changes > 0) parts.push(`${i.changes} change${i.changes === 1 ? "" : "s"} made by rules`);
  if (i.exchanges > 1) parts.push(`asked ${i.exchanges} times`);
  return parts.join("; ");
}

// ---------------------------------------------------------------------------------------
// Human-readable version

function rulesLines(r: ArtifactRules): string[] {
  const lines: string[] = [];
  lines.push(r.in_force.length ? `In force (${r.in_force.length}): ${r.in_force.map((x) => `${x.name} [${x.action}]`).join("; ")}` : "In force: no account rules applied to this result.");
  lines.push(r.triggered.length ? `Triggered: ${r.triggered.map((x) => `${x.rule} at step ${x.step} (${x.effect})`).join("; ")}` : "Triggered: none.");
  return lines;
}

function changeLines(c: ArtifactChange[]): string[] {
  return c.length ? c.map((x) => `- Step ${x.step}: ${x.rule} — ${x.what}`) : ["- None: the result is exactly what the tool returned."];
}

export function renderArtifactText(a: Omit<SessionArtifact, "human_text"> | Omit<TaskArtifact, "human_text">): string {
  const out: string[] = [];
  out.push("FINAL RESULT (controlled version)", a.final_output.trim(), "");
  if (a.what_done) out.push("WHAT WAS DONE", a.what_done, "");
  if (a.links && a.links.length) out.push("LINKS TO THE WORK", ...a.links.map((l) => `- ${l.label}: ${l.url}`), "");
  out.push("PROOF");
  if (a.kind === "session") {
    out.push(`Completion check: passed (${a.proof.criteria.filter((c) => c.ok === true).length}/${a.proof.criteria.length}). ${a.proof.summary}`);
    for (const c of a.proof.criteria) out.push(`${mark(c.ok)} ${c.label} — ${c.detail}`);
    out.push(`Tool: ${a.tool}. Exchanges recorded: ${a.proof.exchanges}. Decided by: ${a.proof.decided_by}.`);
  } else {
    out.push(`Steps completed: ${a.proof.steps_done} of ${a.proof.steps_total}. Every completed step passed its completion check.`);
    for (const s of a.proof.steps) out.push(`${s.status === "completed" ? "✓" : "–"} Step ${s.step} (${s.tool}) — ${s.status}`);
    out.push(a.origin ? `Request came from an external agent (${a.origin.source_model}); it was judged "${a.origin.verdict}".` : "Request came from the account owner.");
    out.push(`The final result is the controlled output of step ${a.final_step}.`);
  }
  out.push(`Result fingerprint (SHA-256): ${a.output_sha256}`, `Completed at: ${a.completed_at}`, "");
  out.push("RULES", ...rulesLines(a.rules), "");
  if (a.kind === "task" && a.handoffs.length) {
    out.push("HAND-OFFS");
    for (const h of a.handoffs) out.push(`- ${h.from === null ? h.from_label : `Step ${h.from}`} → step ${h.to}: ${h.outcome}${h.rules.length ? ` (${h.rules.join("; ")})` : ""}`);
    out.push("");
  }
  out.push("CHANGES", ...changeLines(a.changes));
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------
// Building

export type StepEvidence = {
  step_no: number;
  attempt: number;
  verdict: string | null;
  /** The step row's stored decision (see decisionRecord in outer-control-brain.ts). */
  decision?: { applied?: string[]; changes?: { name: string; count: number }[] } | null;
};

const EFFECT_BY_VERDICT: Record<string, string> = {
  modify: "removed text from the reply",
  block: "reply rejected",
  escalate: "reply needed approval",
  allow: "checked, reply allowed",
};

/** Which rules fired and what they changed, from the recorded exchanges. */
export function evidenceFromSteps(steps: StepEvidence[]): { triggered: RuleTriggered[]; changes: ArtifactChange[] } {
  const triggered: RuleTriggered[] = [];
  const changes: ArtifactChange[] = [];
  const seenT = new Set<string>();
  const seenC = new Set<string>();
  for (const s of [...steps].sort((a, b) => a.step_no - b.step_no || a.attempt - b.attempt)) {
    const effect = EFFECT_BY_VERDICT[s.verdict ?? ""] ?? "checked";
    for (const name of s.decision?.applied ?? []) {
      const k = `${s.step_no}|${name}|${effect}`;
      if (!seenT.has(k)) { seenT.add(k); triggered.push({ rule: name, step: s.step_no, effect }); }
    }
    for (const c of s.decision?.changes ?? []) {
      const what = `removed ${c.count} match${c.count === 1 ? "" : "es"} from the reply`;
      const k = `${s.step_no}|${c.name}|${what}`;
      if (!seenC.has(k)) { seenC.add(k); changes.push({ step: s.step_no, rule: c.name, what }); }
    }
    if (s.verdict === "block") {
      const k = `${s.step_no}|rejected|${s.attempt}`;
      if (!seenC.has(k)) { seenC.add(k); changes.push({ step: s.step_no, rule: (s.decision?.applied ?? [])[0] ?? "a rule", what: `a reply (try ${s.attempt}) was rejected and the tool was asked again` }); }
    }
  }
  return { triggered, changes };
}

export type SessionArtifactInput = {
  id: string;
  taskId: string | null;
  objective: string;
  tool: string;
  completedAt: string;
  finalText: string | null;
  sha256: string;
  checklist: { passed: boolean; outcome: string; summary: string; criteria: ArtifactCriterion[]; output_sha256: string | null };
  steps: StepEvidence[];
  rulesInForce: RuleInForce[];
  decidedBy: "tool" | "person";
  whatDone?: string;
  report?: ReportDoc | null;
  /** Extra links known from the run (e.g. recorded by an agent); links in the final text are always added. */
  links?: ArtifactLink[];
};

export type Built<T> = { ok: true; artifact: T } | { ok: false; reason: string };

export function buildSessionArtifact(i: SessionArtifactInput): Built<SessionArtifact> {
  const text = (i.finalText ?? "").trim();
  if (!text) return { ok: false, reason: "there is no final result" };
  if (!i.checklist.passed || i.checklist.outcome !== "completed") return { ok: false, reason: "the completion checklist did not pass" };
  if (i.checklist.criteria.length === 0 || i.checklist.criteria.some((c) => c.ok !== true)) return { ok: false, reason: "a completion criterion is not met" };
  if (!SHA.test(i.sha256)) return { ok: false, reason: "the result fingerprint is missing" };
  if (i.checklist.output_sha256 !== i.sha256) return { ok: false, reason: "the checked result differs from the stored result" };
  const ev = evidenceFromSteps(i.steps);
  const links = mergeLinks(extractLinks(i.finalText), i.links ?? []);
  const base: Omit<SessionArtifact, "human_text"> = {
    version: ARTIFACT_VERSION, kind: "session", id: i.id, task_id: i.taskId, objective: clip(i.objective, 500), tool: clip(i.tool, 120),
    completed_at: i.completedAt, final_output: i.finalText as string, output_sha256: i.sha256,
    ...(i.whatDone && i.whatDone.trim() ? { what_done: clip(i.whatDone.trim().replace(/\s+/g, " "), 300) } : {}),
    ...(links.length ? { links } : {}),
    ...(i.report ? { report: i.report } : {}),
    proof: {
      checklist_passed: true, summary: i.checklist.summary, criteria: i.checklist.criteria.map((c) => ({ id: c.id, label: c.label, ok: c.ok, detail: c.detail })),
      exchanges: new Set(i.steps.map((s) => `${s.step_no}.${s.attempt}`)).size, decided_by: i.decidedBy,
    },
    rules: { in_force: i.rulesInForce.slice(0, 60), triggered: ev.triggered }, changes: ev.changes,
  };
  return { ok: true, artifact: { ...base, human_text: renderArtifactText(base) } };
}

/** Merge link lists, keeping only clean http(s) links, no duplicates. */
export function mergeLinks(...lists: ArtifactLink[][]): ArtifactLink[] {
  const out: ArtifactLink[] = [];
  const seen = new Set<string>();
  for (const l of lists.flat()) {
    const url = cleanUrl(l.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label: clip((l.label || new URL(url).hostname).trim(), 80) });
  }
  return out.slice(0, 8);
}

export type TaskLegEvidence = { leg_no: number; tool: string; status: string; artifact: unknown };

export type TaskArtifactInput = {
  id: string;
  request: string;
  origin: { source_model?: string; verdict?: string } | null;
  completedAt: string;
  legs: TaskLegEvidence[];
  finalLeg: number | null;
  handoffs: TaskArtifactHandoff[];
};

export function buildTaskArtifact(i: TaskArtifactInput): Built<TaskArtifact> {
  const completed = i.legs.filter((l) => l.status === "completed");
  if (completed.length === 0) return { ok: false, reason: "no step completed" };
  const parts = new Map<number, SessionArtifact>();
  for (const l of completed) {
    const v = validateArtifact(l.artifact, "session");
    if (v.ok !== true) return { ok: false, reason: `step ${l.leg_no} has no valid final result (${v.reason})` };
    parts.set(l.leg_no, l.artifact as SessionArtifact);
  }
  const fin = i.finalLeg === null ? undefined : parts.get(i.finalLeg);
  if (!fin) return { ok: false, reason: "the final step has no valid final result" };

  const triggered: RuleTriggered[] = [];
  const changes: ArtifactChange[] = [];
  const inForce = new Map<string, RuleInForce>();
  for (const [n, a] of [...parts.entries()].sort((x, y) => x[0] - y[0])) {
    for (const r of a.rules.in_force) inForce.set(r.name, r);
    for (const t of a.rules.triggered) triggered.push({ ...t, step: n });
    for (const c of a.changes) changes.push({ ...c, step: n });
  }
  for (const h of i.handoffs) {
    if (h.outcome === "modified") changes.push({ step: h.to, rule: h.rules.join("; ") || "a rule", what: `text removed before step ${h.to} received it` });
  }
  const taskLinks = mergeLinks(...[...parts.entries()].sort((x, y) => x[0] - y[0]).map(([, a]) => a.links ?? []));
  const taskDone = [...parts.entries()].sort((x, y) => x[0] - y[0]).filter(([, a]) => a.what_done).map(([n, a]) => `Step ${n}: ${a.what_done}`).join(" ");
  const base: Omit<TaskArtifact, "human_text"> = {
    version: ARTIFACT_VERSION, kind: "task", id: i.id, request: clip(i.request, 2000),
    origin: i.origin?.source_model ? { source_model: i.origin.source_model, verdict: i.origin.verdict ?? "allow" } : null,
    completed_at: i.completedAt, final_output: fin.final_output, final_step: i.finalLeg as number, output_sha256: fin.output_sha256,
    ...(taskDone ? { what_done: clip(taskDone, 600) } : {}),
    ...(taskLinks.length ? { links: taskLinks } : {}),
    ...(fin.report ? { report: fin.report } : {}),
    proof: {
      steps_total: i.legs.length, steps_done: completed.length, all_checklists_passed: true,
      steps: i.legs.map((l) => ({ step: l.leg_no, tool: clip(l.tool, 120), status: l.status, output_sha256: parts.get(l.leg_no)?.output_sha256 ?? null })),
    },
    handoffs: i.handoffs, rules: { in_force: [...inForce.values()].slice(0, 60), triggered }, changes,
  };
  return { ok: true, artifact: { ...base, human_text: renderArtifactText(base) } };
}

// ---------------------------------------------------------------------------------------
// Validating: used before a status is stored and before "Completed" is shown

export type Validity = { ok: true } | { ok: false; reason: string };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export function validateArtifact(a: unknown, kind?: "session" | "task"): Validity {
  if (a === null || a === undefined) return { ok: false, reason: "no final artifact is stored" };
  if (!isObj(a)) return { ok: false, reason: "the final artifact is not an object" };
  if (a.version !== ARTIFACT_VERSION) return { ok: false, reason: "the final artifact has an unknown version" };
  if (a.kind !== "session" && a.kind !== "task") return { ok: false, reason: "the final artifact has no kind" };
  if (kind && a.kind !== kind) return { ok: false, reason: `the final artifact is not a ${kind} artifact` };
  const out = a.final_output;
  if (typeof out !== "string" || !out.trim() || !/[\p{L}\p{N}]/u.test(out)) return { ok: false, reason: "the final controlled output is missing or empty" };
  if (typeof a.output_sha256 !== "string" || !SHA.test(a.output_sha256)) return { ok: false, reason: "the final output has no fingerprint" };
  const proof = a.proof;
  if (!isObj(proof)) return { ok: false, reason: "the proof is missing" };
  if (a.kind === "session") {
    const crit = proof.criteria;
    if (proof.checklist_passed !== true || !Array.isArray(crit) || crit.length === 0 || crit.some((c) => !isObj(c) || c.ok !== true)) {
      return { ok: false, reason: "the proof does not show a passed completion checklist" };
    }
  } else if (proof.all_checklists_passed !== true || !Array.isArray(proof.steps) || proof.steps.length === 0) {
    return { ok: false, reason: "the proof does not show every step passed its checklist" };
  }
  if (!isObj(a.rules) || !Array.isArray(a.rules.in_force) || !Array.isArray(a.rules.triggered) || !Array.isArray(a.changes)) {
    return { ok: false, reason: "the rules or changes section is missing" };
  }
  if (a.what_done !== undefined && (typeof a.what_done !== "string" || !a.what_done.trim())) return { ok: false, reason: "the what-was-done line is not text" };
  if (a.links !== undefined && (!Array.isArray(a.links) || a.links.some((l) => !isObj(l) || typeof l.url !== "string" || cleanUrl(l.url) === null || typeof l.label !== "string"))) {
    return { ok: false, reason: "a link to the work is not a valid http(s) link" };
  }
  if (a.report !== undefined && !isReportDoc(a.report)) return { ok: false, reason: "the report section is not a valid report" };
  if (typeof a.human_text !== "string" || !a.human_text.trim()) return { ok: false, reason: "the readable version is missing" };
  const { human_text: _drop, ...rest } = a;
  void _drop;
  let rendered: string | null = null;
  try { rendered = renderArtifactText(rest as unknown as Omit<SessionArtifact, "human_text">); } catch { rendered = null; }
  if (rendered !== a.human_text) return { ok: false, reason: "the readable version does not match the structured version" };
  return { ok: true };
}

/** The official result of an item: the artifact's controlled output, or null. Nothing else counts as a result. */
export function officialOutput(artifact: unknown, kind?: "session" | "task"): string | null {
  return validateArtifact(artifact, kind).ok ? (artifact as Artifact).final_output : null;
}

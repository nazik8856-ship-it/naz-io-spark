// First-value onboarding: "NazAI does it for me". A new account can run its first controlled Tasks without connecting an AI of
// its own: three starter tools answer with NazAI's own AI, each from a different angle, so a Task still has several replies to
// check and one clean result. They are internal tools (an address NazAI never fetches), and each account gets them for its
// first STARTER_TASKS Tasks only: a session of a later Task is stopped before anything is asked, with a plain reason.
//
// Day 3, the built-in path made specific (docs/outer-control-context.md, "Built-in tools"):
//   - a task card on top of every built-in call: the goal, the person's situation, the rules in force and what a useful answer is
//     for this action (taskCard);
//   - a distinct job per tool where the three answer the same question: the Writer gives the practical answer, the Analyst ranks
//     what matters, the Reviewer challenges what a typical answer gets wrong (jobFor);
//   - an anti-generic pass: an answer the completion gate would call generic is rewritten once, inside the call, before NazAI's
//     checks run on it, so the rules still see the final text (askStarter).
import { callAiGateway, pickAiGateway } from "./ai-gateway.ts";
import { assessSpecific, type QualityId } from "./outer-control-completion.ts";
import { isChallenge } from "./outer-control-report.ts";
import { parseToolReply, type RuleLine } from "./outer-control-tool-request.ts";
import type { ReportKind } from "./outer-control-report-doc.ts";
import { fenceUntrusted } from "./untrusted-input.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export const STARTER_TOOL_URL = "nazai-internal://starter/";
export const STARTER_TASKS = 2;

export const STARTER_TOOLS = [
  {
    key: "writer", name: "NazAI Writer",
    system: "You are a clear, practical writer: plain language, a concrete example where it helps.",
    job: "Your job: the practical answer. Give the steps, wording or plan the person can use as it is, in the order they would do it, written for their situation. Do not rank options or list risks: the Analyst and the Reviewer do that.",
  },
  {
    key: "analyst", name: "NazAI Analyst",
    system: "You are a careful analyst: facts, numbers and trade-offs, and you say plainly what you are not sure about.",
    job: "Your job: prioritise. Rank the 3 to 5 things that matter most for this person (by impact, cost and time, within their limits), say in one line why each sits where it does, and which one to do first. Do not write out a full how-to: the Writer does that.",
  },
  {
    key: "reviewer", name: "NazAI Reviewer",
    system: "You are a sceptical reviewer: you look for what is weak, vague or unsupported.",
    job: "Your job: challenge. Name the claims a typical answer to this request gets wrong or leaves vague for this person's situation, say why each fails here, and give the specific replacement. Do not repeat the standard advice: the Writer and the Analyst give the answer.",
  },
] as const;

/** The actions where the three tools answer the same question, so each gets its own job instead of the same one. */
export const ROLE_KINDS: ReportKind[] = ["opinions", "research", "compare", "decision"];
const SAME_JOB = "Your job: do exactly what the request asks, in the format it asks for.";
const CHALLENGE_JOB = "Your job: challenge the answers you are given, as the request says: what is missing, generic or unsupported for this person, and the specific fix.";

/** What a useful answer is, by action: the line of the task card that says what the person needs from it. */
const USEFUL: Partial<Record<ReportKind, string>> = {
  research: "findings specific enough to act on (names, figures, dates or steps), each with how sure it is, then what applies to this person.",
  opinions: "a clear position with the reasons that hold for this person's situation.",
  compare: "a direct, complete answer that can be compared point by point with other tools' answers.",
  decision: "a recommendation with the factors that decide it for this person, and what would change it.",
  factcheck: "a verdict on each part of the claim, with the reason and the correction.",
  multistep: "the finished piece of work for this step, ready to use.",
  delegate: "the finished piece of work, ready to use.",
};
const USEFUL_DEFAULT = "an answer the person can act on today.";

/** What a built-in call is about: the step's full instruction, and the person's own request, situation and rules for the task card. */
export type StarterTask = {
  /** The step's instruction as every tool gets it (request, context, rules, reply format). */
  instruction: string;
  /** The person's own request (without NazAI's instructions around it). */
  request: string;
  /** The Task's context: the person's situation (their background and what NazAI knows about them). Null when there is none. */
  situation: string | null;
  rules: RuleLine[];
  omittedRules?: number;
  /** The Task's action; null for a session on its own. */
  kind: ReportKind | null;
  /** The completion gate's checks for this action: the anti-generic pass uses the same ones. Empty: no pass. */
  checks: QualityId[];
};

/** The job a built-in tool does on this step. */
export function jobFor(key: string, t: Pick<StarterTask, "instruction" | "kind">): string {
  if (isChallenge(t.instruction)) return CHALLENGE_JOB;
  if (!t.kind || !ROLE_KINDS.includes(t.kind)) return SAME_JOB;
  return AI_TOOLS.find((x) => x.key === key)?.job ?? SAME_JOB;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The task card: what a built-in tool reads first. Every part is always there; a missing situation is said plainly. */
export function taskCard(t: StarterTask, job: string): string {
  const situation = t.situation && t.situation.trim()
    ? clip(t.situation.trim(), 1500)
    : "Not given. Open your answer with one line \"Assumed situation: …\" (stage, who it is for, main limit), then answer for exactly that situation.";
  const names = t.rules.map((r) => r.name).filter(Boolean);
  const rules = names.length
    ? `Your answer is checked automatically and must stay clear of: ${names.join("; ")}${t.omittedRules ? ` (and ${t.omittedRules} more)` : ""}. It must also contain no secrets, card numbers or destructive wording.`
    : "Your answer is checked automatically: no secrets, card numbers or destructive wording.";
  return [
    "TASK CARD (read this first; the full request follows)",
    `Goal: ${clip(t.request.trim(), 600)}`,
    `Situation:\n${situation}`,
    `Rules in force: ${rules}`,
    `A useful answer here is ${(t.kind && USEFUL[t.kind]) || USEFUL_DEFAULT} Concretely: it names this person's situation, says what to do, who does it, when and with what numbers, and contains nothing that would fit any business.`,
    job,
  ].join("\n");
}

export const isStarterUrl = (url: unknown): boolean => typeof url === "string" && url.startsWith(STARTER_TOOL_URL);

/**
 * The NazAI second perspective: with exactly one connected tool, a person can have NazAI's own AI give a second controlled answer for
 * one Task (Start a task, "Generate a NazAI tool for this task"). It is an internal tool the page never lists (an address NazAI never
 * fetches), used only for a Task that asked for it; the Task is charged as usual, so the starter tools' limit of free Tasks does not
 * apply. Its answer gets the same task card, anti-generic pass and rules as any reply.
 */
export const PERSPECTIVE_TOOL_URL = "nazai-internal://perspective";
export const PERSPECTIVE_NAME = "NazAI second perspective";
export const isPerspectiveUrl = (url: unknown): boolean => url === PERSPECTIVE_TOOL_URL;
/** Answered by NazAI's own AI (a starter tool or the second perspective), never fetched from outside. */
export const isNazaiAiUrl = (url: unknown): boolean => isStarterUrl(url) || isPerspectiveUrl(url);
export const starterKeyOf = (url: string): string => (isPerspectiveUrl(url) ? "perspective" : url.slice(STARTER_TOOL_URL.length));

const PERSPECTIVE = {
  key: "perspective", name: PERSPECTIVE_NAME,
  system: "You are an independent second opinion: careful, concrete, and you say plainly what you are not sure about.",
  job: "Your job: an independent second answer. Answer the request yourself for this person, so it can be compared and cross-checked with another tool's answer: take your own position, give the specifics it rests on, and say where a typical answer would be wrong for them.",
} as const;
const AI_TOOLS = [...STARTER_TOOLS, PERSPECTIVE];

/** The account's second-perspective tool, created on first use (an existing one is kept). Never listed on the page. */
export async function ensurePerspectiveTool(admin: AnyAdmin, accountId: string, maxTools: number):
  Promise<{ ok: true; id: string } | { ok: false; code: string; message: string; status: number }> {
  const { data: existing } = await admin.from("external_tools").select("id, enabled, suspended_at").eq("user_id", accountId).eq("endpoint_url", PERSPECTIVE_TOOL_URL).is("removed_at", null).maybeSingle();
  const ex = existing as { id: string; enabled?: boolean; suspended_at?: string | null } | null;
  if (ex) {
    if (ex.suspended_at) return { ok: false, code: "tool_unavailable", message: "NazAI's second perspective is paused for this account.", status: 409 };
    if (ex.enabled === false) await admin.from("external_tools").update({ enabled: true }).eq("id", ex.id).eq("user_id", accountId);
    return { ok: true, id: ex.id };
  }
  const { count } = await admin.from("external_tools").select("id", { count: "exact", head: true }).eq("user_id", accountId).is("removed_at", null);
  if ((count ?? 0) + 1 > maxTools) return { ok: false, code: "too_many_tools", message: `An account can connect at most ${maxTools} tools; remove one to add NazAI's second perspective.`, status: 409 };
  const now = new Date().toISOString();
  const { data: made, error } = await admin.from("external_tools").insert({
    user_id: accountId, name: PERSPECTIVE_NAME, endpoint_url: PERSPECTIVE_TOOL_URL, request_format: "generic_json",
    approved_at: now, last_ok_at: now, last_checked_at: now, enabled: true,
  }).select("id").single();
  if (error || !made) return { ok: false, code: "internal_error", message: "Could not set up NazAI's second perspective.", status: 500 };
  return { ok: true, id: (made as { id: string }).id };
}

export const STARTER_USED_UP =
  `Your ${STARTER_TASKS} free NazAI tasks are used. Connect your own AI (ChatGPT, Claude or another) to keep going.`;

/** The account's starter tools, created on first use (an existing one is kept). */
export async function ensureStarterTools(admin: AnyAdmin, accountId: string, maxTools: number):
  Promise<{ ok: true; tools: { id: string; name: string }[] } | { ok: false; code: string; message: string; status: number }> {
  const { data: existing } = await admin.from("external_tools").select("id, name, endpoint_url").eq("user_id", accountId).like("endpoint_url", `${STARTER_TOOL_URL}%`).is("removed_at", null);
  const have = new Map(((existing ?? []) as { id: string; name: string; endpoint_url: string }[]).map((t) => [starterKeyOf(t.endpoint_url), t]));
  const missing = STARTER_TOOLS.filter((t) => !have.has(t.key));
  if (missing.length) {
    const { count } = await admin.from("external_tools").select("id", { count: "exact", head: true }).eq("user_id", accountId).is("removed_at", null);
    if ((count ?? 0) + missing.length > maxTools) return { ok: false, code: "too_many_tools", message: `An account can connect at most ${maxTools} tools.`, status: 409 };
    const now = new Date().toISOString();
    const { data: made, error } = await admin.from("external_tools").insert(missing.map((t) => ({
      user_id: accountId, name: t.name, endpoint_url: `${STARTER_TOOL_URL}${t.key}`, request_format: "generic_json",
      approved_at: now, last_ok_at: now, last_checked_at: now, enabled: true,
    }))).select("id, name, endpoint_url");
    if (error || !made) return { ok: false, code: "internal_error", message: "Could not set up NazAI's starter AI.", status: 500 };
    for (const t of made as { id: string; name: string; endpoint_url: string }[]) have.set(starterKeyOf(t.endpoint_url), t);
  }
  return { ok: true, tools: STARTER_TOOLS.map((t) => have.get(t.key)!).filter(Boolean).map((t) => ({ id: t.id, name: t.name })) };
}

/** The Tasks that used starter tools, oldest first: a session belongs to its Task, or stands alone. */
export function starterTaskKeys(rows: { id: string; workflow_id: string | null; started_at: string | null }[]): string[] {
  const sorted = [...rows].sort((a, b) => String(a.started_at ?? "").localeCompare(String(b.started_at ?? "")) || a.id.localeCompare(b.id));
  const keys: string[] = [];
  for (const r of sorted) { const k = r.workflow_id ?? r.id; if (!keys.includes(k)) keys.push(k); }
  return keys;
}

/**
 * Whether the starter AI may answer this session: its Task is one of the account's first STARTER_TASKS Tasks with starter tools, or
 * the Task was paid for (credit_charged: the Inner Control chat runs the starter AI for the Task's usual credits once the free Tasks
 * are used).
 */
export async function starterAllowed(admin: AnyAdmin, s: { id: string; user_id: string; workflow_id: string | null }): Promise<boolean> {
  if (s.workflow_id) {
    const { data: wf } = await admin.from("outer_control_workflows").select("credit_charged").eq("id", s.workflow_id).eq("user_id", s.user_id).maybeSingle();
    if ((wf as { credit_charged?: boolean } | null)?.credit_charged === true) return true;
  }
  const { data: tools } = await admin.from("external_tools").select("id").eq("user_id", s.user_id).like("endpoint_url", `${STARTER_TOOL_URL}%`);
  const ids = ((tools ?? []) as { id: string }[]).map((t) => t.id);
  if (!ids.length) return false;
  const { data: rows } = await admin.from("outer_control_sessions").select("id, workflow_id, started_at").eq("user_id", s.user_id).in("tool_id", ids);
  const keys = starterTaskKeys((rows ?? []) as { id: string; workflow_id: string | null; started_at: string | null }[]);
  return keys.slice(0, STARTER_TASKS).includes(s.workflow_id ?? s.id);
}

/** How many of the free Tasks the account has used (for the page). */
export async function starterTasksUsed(admin: AnyAdmin, accountId: string): Promise<number> {
  const { data: tools } = await admin.from("external_tools").select("id").eq("user_id", accountId).like("endpoint_url", `${STARTER_TOOL_URL}%`);
  const ids = ((tools ?? []) as { id: string }[]).map((t) => t.id);
  if (!ids.length) return 0;
  const { data: rows } = await admin.from("outer_control_sessions").select("id, workflow_id, started_at").eq("user_id", accountId).in("tool_id", ids);
  return Math.min(STARTER_TASKS, starterTaskKeys((rows ?? []) as { id: string; workflow_id: string | null; started_at: string | null }[]).length);
}

export type StarterAi = (system: string, user: string) => Promise<string | null>;

/** The production AI: NazAI's own gateway, a plain-text answer. Null when it is not configured or does not answer. */
export const gatewayStarterAi: StarterAi = async (system, user) => {
  const cfg = pickAiGateway();
  if (!cfg) return null;
  try {
    const res = await callAiGateway({
      model: cfg.model, temperature: 0.6,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }, cfg, AbortSignal.timeout(60_000));
    if (!res.ok) return null;
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text : null;
  } catch { return null; }
};

const SHARPEN_SYSTEM = "You make an answer specific to one person's situation. Keep every correct point and keep within every rule. " +
  "Do not invent facts, names, prices or results: where a specific number or name is needed and not known, give a plausible one marked " +
  "\"Assumption:\" or \"(estimate)\". Replace each phrase that would fit any business with what exactly to do. Reply with the improved answer " +
  "only, as plain text, in the same language and roughly the same length, with no preamble.";

/** What the anti-generic pass found and did; null when the first answer was specific enough (or the pass does not apply). */
export type Sharpened = { problems: string[]; improved: boolean };

/**
 * One built-in tool's answer: the task card and the tool's own job on top of the step's instruction. An answer the completion gate
 * would call generic is rewritten once with the exact problems; the reply returned is what NazAI then checks like any other.
 */
export async function askStarter(ai: StarterAi, url: string, t: StarterTask): Promise<{ reply: string; sharpened: Sharpened | null } | null> {
  const tool = AI_TOOLS.find((x) => x.key === starterKeyOf(url));
  if (!tool) return null;
  const job = jobFor(tool.key, t);
  const card = taskCard(t, job);
  const raw = await ai(`${tool.system} ${job} Follow every rule you are given. Stay within the length the request asks for, and under 700 words.`,
    `${card}\n\n${t.instruction}`.slice(0, 14_000));
  if (raw === null) return null;
  if (!t.checks.length) return { reply: raw, sharpened: null };
  const first = parseToolReply(raw);
  if (first.status !== "done") return { reply: raw, sharpened: null };
  const q = assessSpecific(first.answer, { request: t.request, context: t.situation, checks: t.checks });
  if (!q || q.ok) return { reply: raw, sharpened: null };
  const problems = q.checks.filter((c) => !c.ok).map((c) => c.detail);
  const better = await ai(SHARPEN_SYSTEM, [
    card,
    fenceUntrusted(first.answer, { label: "answer to improve", max: 8000 }).block,
    `What is wrong with it:\n${problems.map((p) => `- ${p}`).join("\n")}`,
  ].join("\n\n").slice(0, 14_000));
  const improved = better && better.trim() ? parseToolReply(better).answer.trim() : "";
  if (!improved) return { reply: raw, sharpened: { problems, improved: false } };
  return { reply: JSON.stringify({ status: "done", answer: improved }), sharpened: { problems, improved: true } };
}

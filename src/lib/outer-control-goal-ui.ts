// Outer Control: the goal Task as the page shows it. A goal Task is In progress, Blocked or Completed; the honest status stays the
// source of truth (Completed only with a valid final artifact), this only names the three states a person thinks in.
import type { StatusKey } from "@/lib/outer-control-status";

export const MAX_CRITERIA = 5;
export const MAX_CRITERION_CHARS = 200;
export const MAX_GOAL_TOOLS = 3;
export const ABSOLUTE_MAX_ROUNDS = 10;

export type CriterionView = { id: string; text: string; met: boolean | null; evidence: string | null; round: number | null };

export type GoalTaskView = {
  mode?: string | null;
  status: string;
  criteria_state?: CriterionView[] | null;
  max_rounds?: number | null;
  rounds_used?: number | null;
  blocked_reason?: string | null;
};

export type GoalHeadline = { key: "in_progress" | "blocked" | "completed"; label: string };

/** In progress while it works, Completed when it is, and Blocked in every other case (waiting, stopped, failed, partly done). */
export function goalHeadline(statusKey: StatusKey): GoalHeadline {
  if (statusKey === "running" || statusKey === "queued") return { key: "in_progress", label: "In progress" };
  if (statusKey === "completed") return { key: "completed", label: "Completed" };
  return { key: "blocked", label: "Blocked" };
}

export const isGoalTask = (w: Pick<GoalTaskView, "mode">) => w.mode === "goal";

export const criteriaList = (w: Pick<GoalTaskView, "criteria_state">): CriterionView[] => (Array.isArray(w.criteria_state) ? w.criteria_state : []);

export const criteriaProgress = (w: Pick<GoalTaskView, "criteria_state">) => {
  const list = criteriaList(w);
  return { met: list.filter((c) => c.met === true).length, total: list.length };
};

export const roundsLine = (w: Pick<GoalTaskView, "rounds_used" | "max_rounds">) =>
  `Round ${Math.max(1, w.rounds_used ?? 1)} of ${Math.max(1, w.max_rounds ?? 1)}`;

/** What can be done with a Task that is blocked on its criteria: the three ways out. */
export function blockedActions(w: GoalTaskView): { accept: boolean; more: boolean; stop: boolean } {
  const blocked = w.status === "awaiting_human" && !!(w.blocked_reason ?? "").trim();
  return { accept: blocked, more: blocked && (w.max_rounds ?? 1) < ABSOLUTE_MAX_ROUNDS, stop: blocked };
}

/** One criterion per line, up to five. */
export function parseCriteriaLines(text: string): { ok: true; criteria: string[] } | { ok: false; message: string } {
  const lines = [...new Set(text.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•\d.)]+\s+/, "").replace(/\s+/g, " ").trim()).filter(Boolean))];
  if (lines.length > MAX_CRITERIA) return { ok: false, message: `Use at most ${MAX_CRITERIA} done criteria, one per line.` };
  if (lines.some((l) => l.length > MAX_CRITERION_CHARS)) return { ok: false, message: `Each done criterion is limited to ${MAX_CRITERION_CHARS} characters.` };
  return { ok: true, criteria: lines };
}

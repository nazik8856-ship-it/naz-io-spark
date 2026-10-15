// Outer Control (active): what has been decided, changed and applied so far in a run.
// Stored per step, read back before every request so later steps stay consistent with
// earlier ones, and shared by every leg of a workflow. Pure rendering is separate from
// the two small database helpers so it can be tested alone.

export type MemoryKind = "rule" | "modification" | "rejection" | "recovery" | "human" | "plan";
export type MemoryEntry = {
  step_no: number; kind: MemoryKind; rule_names: string[]; summary: string;
  /** Structured facts for the decision brain (older rows have none). */
  data?: Record<string, unknown> | null;
  session_id?: string | null;
};

/** How many of the most recent entries a request carries. */
export const MEMORY_LIMIT = 20;
/** How many entries are read back for the brain: it re-applies rules pinned anywhere earlier in the task, so this is generous. */
const MEMORY_FETCH_LIMIT = 300;
const LINE_MAX = 300;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One line per entry, oldest first, identical lines collapsed. */
export function renderMemory(entries: MemoryEntry[], limit = MEMORY_LIMIT): string[] {
  const lines: string[] = [];
  for (const e of entries.slice(-limit)) {
    const line = clip(e.summary.replace(/\s+/g, " ").trim(), LINE_MAX);
    if (line && lines[lines.length - 1] !== line) lines.push(line);
  }
  return lines;
}

/**
 * For a person reading a hand-off: each distinct message once, oldest first by its latest
 * occurrence, with "(3 times)" when it happened more than once. At most `limit` messages.
 */
export function renderMemoryCounted(entries: MemoryEntry[], limit = 3): string[] {
  const seen = new Map<string, number>();
  for (const e of entries) {
    const line = clip(e.summary.replace(/\s+/g, " ").trim(), LINE_MAX);
    if (!line) continue;
    const n = (seen.get(line) ?? 0) + 1;
    seen.delete(line); // re-insert so Map order follows the latest occurrence
    seen.set(line, n);
  }
  return [...seen.entries()].slice(-limit).map(([line, n]) => (n > 1 ? `${line} (${n} times)` : line));
}

/** Rule names that replies in this run have already triggered (rejected, cleaned or escalated). */
export function ruleNamesSeen(entries: MemoryEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.kind !== "rule" && e.kind !== "modification" && e.kind !== "rejection") continue;
    for (const n of e.rule_names) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** How many times a person already chose to retry the given step. */
export function humanRetriesAt(entries: MemoryEntry[], stepNo: number): number {
  return entries.filter((e) => e.kind === "human" && e.step_no === stepNo && /chose to retry/i.test(e.summary)).length;
}

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;
type MemoryOwner = { id: string; user_id: string; workflow_id: string | null; leg_no?: number | null };

/** Prefix that tells a leg's entries apart inside a workflow's shared memory. */
export const legLabel = (s: Pick<MemoryOwner, "workflow_id" | "leg_no">) => (s.workflow_id && s.leg_no ? `Leg ${s.leg_no} · ` : "");

export async function recordMemory(
  admin: AnyAdmin, s: MemoryOwner, e: { stepNo: number; kind: MemoryKind; ruleNames?: string[]; summary: string; data?: Record<string, unknown> | null },
): Promise<void> {
  try {
    await admin.from("outer_control_memory").insert({
      user_id: s.user_id, session_id: s.id, workflow_id: s.workflow_id, step_no: e.stepNo, kind: e.kind,
      rule_names: (e.ruleNames ?? []).slice(0, 10), summary: clip(`${legLabel(s)}${e.summary}`, 590), data: e.data ?? null,
    });
  } catch { /* memory is a consistency aid; the run never depends on writing it */ }
}

export async function loadMemory(admin: AnyAdmin, s: Pick<MemoryOwner, "id" | "workflow_id">): Promise<MemoryEntry[]> {
  try {
    const q = admin.from("outer_control_memory").select("step_no, kind, rule_names, summary, data, session_id").order("created_at", { ascending: false }).limit(MEMORY_FETCH_LIMIT);
    const { data } = await (s.workflow_id ? q.eq("workflow_id", s.workflow_id) : q.eq("session_id", s.id));
    return ((data ?? []) as MemoryEntry[]).slice().reverse();
  } catch { return []; }
}

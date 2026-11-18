// Inner Control chat runs tasks (docs/inner-control.md): what the chat card says about a Task it offered or started. Pure.

/** What the server offers before a Task starts (control-system-decide, mode "task_offer"). */
export type InnerTaskOffer = { kind: string; title: string; request: string; tools: string[]; credits: number; free_left: number; line: string };

export const TASK_DONE = new Set(["completed"]);
export const TASK_ENDED = new Set(["completed", "failed", "stopped", "cancelled", "rejected"]);

/** One line on where a running Task is: how many tool answers are in, and what happens next. */
export function progressLine(legs: { status: string }[], taskStatus: string): string {
  if (taskStatus === "awaiting_human") return "It needs you: open it in Outer Control to decide.";
  const answers = legs.filter((l) => l.status !== "queued");
  const done = legs.filter((l) => l.status === "completed").length;
  if (!legs.length) return "Starting…";
  if (done < legs.length - 1) return `Asking the tools: ${done} of ${legs.length - 1} answers checked against your rules…`;
  return answers.length ? "Writing the one controlled result…" : "Starting…";
}

/** What the person's rules did to this Task's answers: how many rules were in force, and how many answers they changed. */
export function rulesLine(rulesActive: number, changed: number): string {
  const rules = `Checked against ${rulesActive} rule${rulesActive === 1 ? "" : "s"}`;
  if (rulesActive === 0) return "Checked by NazAI's built-in checks (you have no rules of your own yet)";
  return `${rules} · ${changed === 0 ? "nothing needed changing" : `${changed} answer${changed === 1 ? "" : "s"} changed or held by your rules`}`;
}

/** The steps a rule changed, blocked or held (its verdict was not a plain allow). */
export const changedCount = (steps: { verdict: string | null }[]) => steps.filter((s) => s.verdict === "modify" || s.verdict === "block" || s.verdict === "escalate").length;

/** The start of a result for the chat: whole lines up to about `max` characters, and whether more follows. */
export function excerpt(text: string, max = 700): { text: string; more: boolean } {
  const t = (text ?? "").trim();
  if (t.length <= max) return { text: t, more: false };
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return { text: `${(end > max / 2 ? cut.slice(0, end + 1) : cut).trimEnd()}…`, more: true };
}

// Outer Control: what is happening in a session, line by line, from what was recorded. Shown first when a session is
// opened, and opened by itself while the session runs.
import { buildActivity, type ActivityLine, type ActivityStep } from "@/lib/outer-control-tools-ui";
import type { CompletionView, PendingKind, SessionStatus } from "@/lib/outer-control-sessions";

const DOT: Record<ActivityLine["tone"], string> = {
  ok: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-400", live: "bg-cyan-300 animate-pulse", idle: "bg-zinc-500",
};
const TEXT: Record<ActivityLine["tone"], string> = {
  ok: "text-zinc-200", warn: "text-amber-200", bad: "text-rose-300", live: "text-cyan-200", idle: "text-zinc-400",
};

export default function SessionActivity({ toolName, status, steps, completion, pendingKind, stepCount, maxSteps }: {
  toolName: string; status: SessionStatus; steps: ActivityStep[]; completion: CompletionView | null | undefined;
  pendingKind: PendingKind | null; stepCount: number; maxSteps: number;
}) {
  const lines = buildActivity({ toolName, status, steps, completion, pendingKind, stepCount, maxSteps });
  return (
    <div data-testid="session-activity">
      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">What is happening · tool: {toolName}</div>
      <ul className="mt-1.5 space-y-1">
        {lines.length === 0 && <li className="text-zinc-500">Nothing recorded yet.</li>}
        {lines.map((l) => (
          <li key={l.key} className={`flex items-start gap-2 text-xs ${TEXT[l.tone]}`}>
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[l.tone]}`} aria-hidden />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

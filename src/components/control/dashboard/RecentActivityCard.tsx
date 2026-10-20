// Inner Control page, secondary section: the latest decisions, short and scannable.
// Each row points two ways: to the rule that decided it (when one did) and into the chat
// with the question already written.
import { useState } from "react";
import { ChevronDown, ChevronUp, MessageCircle } from "lucide-react";
import { timeAgo, TONE_DOT, TONE_TEXT } from "@/lib/outer-control-ui";
import type { ActivityItem } from "@/lib/inner-control-ui";

/** How many decisions show before "Show all". */
export const ACTIVITY_SHOWN = 5;

export default function RecentActivityCard({
  items,
  loading,
  onShowRule,
  onAsk,
  onViewAll,
  emptyTitle = "No decisions yet",
  emptyText = "When your AI tries to do something, the Control System checks it against your rules and the result shows up here. Try the chat: describe an action and see what it decides.",
}: {
  items: ActivityItem[];
  loading: boolean;
  onShowRule: (hardRuleId: string) => void;
  onAsk: (question: string) => void;
  onViewAll: () => void;
  emptyTitle?: string;
  emptyText?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, ACTIVITY_SHOWN);
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" aria-label="Recent activity" data-testid="recent-activity">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-100">Recent activity</h2>
        <button onClick={onViewAll} className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-200 hover:underline">
          View all decisions
        </button>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-zinc-500">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-white/15 bg-black/20 p-4 text-center" data-testid="activity-empty">
          <p className="text-sm font-medium text-zinc-200">{emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">{emptyText}</p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {shown.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0" data-testid="activity-row">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[a.tone]}`} aria-hidden />
              <div className="min-w-0 flex-1 basis-52">
                <p className="break-words text-sm text-zinc-200">
                  <span className={`mr-1.5 font-medium ${TONE_TEXT[a.tone]}`}>{a.verdict}</span>
                  {a.title}
                </p>
                {a.reason && <p className="mt-0.5 break-words text-[11px] text-zinc-500">{a.reason}</p>}
                {a.task && (
                  <div className="mt-1 text-[11px] text-zinc-400" data-testid="activity-task">
                    <span className="mr-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200">Part of an Outer Control Task</span>
                    “{a.task.goal}”{a.task.tools.length > 0 ? ` · asked ${a.task.tools.join(", ")}` : ""}
                    {a.task.result && (
                      <details className="mt-1 rounded border border-white/10 px-2 py-1">
                        <summary className="cursor-pointer text-zinc-300">Task result</summary>
                        <p className="mt-1 break-words text-zinc-400" data-testid="activity-task-result">{a.task.result}</p>
                      </details>
                    )}
                    <a href="/control-system/outer" className="ml-1 text-cyan-300 underline-offset-2 hover:underline">See the Task in Outer Control</a>
                  </div>
                )}
                {a.ruleId && a.ruleName && (
                  <button
                    onClick={() => onShowRule(a.ruleId as string)}
                    className="mt-1 max-w-full truncate rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20"
                    title="Show the rule that decided this"
                  >
                    Rule: {a.ruleName}
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] text-zinc-600">{timeAgo(a.at)}</span>
                <button
                  onClick={() => onAsk(a.question)}
                  aria-label={`Ask the chat: ${a.question}`}
                  title="Ask the chat about this decision"
                  className="rounded-md border border-white/10 p-1.5 text-zinc-400 hover:bg-white/5 hover:text-cyan-200"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > ACTIVITY_SHOWN && (
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          data-testid="activity-expand"
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs text-zinc-300 hover:bg-white/5 hover:text-white"
        >
          {expanded ? <>Show fewer <ChevronUp className="h-3.5 w-3.5" /></> : <>Show all {items.length} decisions <ChevronDown className="h-3.5 w-3.5" /></>}
        </button>
      )}
    </section>
  );
}

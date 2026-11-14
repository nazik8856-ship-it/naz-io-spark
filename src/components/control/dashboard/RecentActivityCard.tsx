// Inner Control page, secondary section: the latest decisions, short and scannable.
// Each row points two ways: to the rule that decided it (when one did) and into the chat
// with the question already written.
import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardList, ShieldX, type LucideIcon } from "lucide-react";
import { timeAgo, TONE_TEXT } from "@/lib/outer-control-ui";
import type { ActivityItem } from "@/lib/inner-control-ui";

/** How many decisions show before "Show all". */
export const ACTIVITY_SHOWN = 5;

/** One quiet line icon per outcome: done, waiting for a person, stopped. */
const TONE_ICON: Record<ActivityItem["tone"], LucideIcon> = { ok: CheckCircle2, warn: ClipboardList, bad: ShieldX };

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
  // A row is one line; tapping it opens the reason, the rule that decided it and the chat link.
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = expanded ? items : items.slice(0, ACTIVITY_SHOWN);
  return (
    <section aria-label="Recent activity" data-testid="recent-activity">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-zinc-50">Recent activity</h2>
        <button onClick={onViewAll} className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-200 hover:underline">
          View all decisions
        </button>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-zinc-500">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-4 text-center" data-testid="activity-empty">
          <p className="text-sm font-medium text-zinc-200">{emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">{emptyText}</p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.03] px-4">
          {shown.map((a) => {
            const Icon = TONE_ICON[a.tone];
            const open = openId === a.id;
            return (
              <li key={a.id} className="py-3" data-testid="activity-row">
                <button
                  onClick={() => setOpenId(open ? null : a.id)} aria-expanded={open}
                  className="flex w-full items-start gap-3 text-left"
                >
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${TONE_TEXT[a.tone]}`} aria-hidden />
                  <span className="min-w-0 flex-1 break-words text-[15px] leading-snug text-zinc-100">
                    <span className={`mr-1.5 font-medium ${TONE_TEXT[a.tone]}`}>{a.verdict}</span>
                    {a.title}
                    <span className="whitespace-nowrap text-sm text-zinc-500"> – {timeAgo(a.at)}</span>
                  </span>
                  <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {open && (
                  <div className="ml-8 mt-2 space-y-2" data-testid="activity-detail">
                    {a.reason && <p className="break-words text-xs text-zinc-400">{a.reason}</p>}
                    {a.task && (
                      <div className="text-[11px] text-zinc-400" data-testid="activity-task">
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
                    <div className="flex flex-wrap items-center gap-2">
                      {a.ruleId && a.ruleName && (
                        <button
                          onClick={() => onShowRule(a.ruleId as string)}
                          className="max-w-full truncate rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20"
                          title="Show the rule that decided this"
                        >
                          Rule: {a.ruleName}
                        </button>
                      )}
                      <button
                        onClick={() => onAsk(a.question)}
                        aria-label={`Ask the chat: ${a.question}`}
                        title="Ask the chat about this decision"
                        className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:text-cyan-200"
                      >
                        Ask the chat
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > ACTIVITY_SHOWN && (
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          data-testid="activity-expand"
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 py-2 text-xs text-zinc-300 hover:bg-white/5 hover:text-white"
        >
          {expanded ? <>Show fewer <ChevronUp className="h-3.5 w-3.5" /></> : <>Show all {items.length} decisions <ChevronDown className="h-3.5 w-3.5" /></>}
        </button>
      )}
    </section>
  );
}

// Outer Control page, section 3: what it decided lately. A short list (verdict, tool, time);
// the reasoning, the before/after text and the matched rules open only for the row you click.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { maskSensitive } from "@/lib/mask-sensitive";
import { describeOutcome } from "@/lib/outer-control-outcome";
import { DECISION_LABEL, DEFAULT_DECISIONS, TONE_BORDER, TONE_TEXT, timeAgo, visibleItems, type Verdict } from "@/lib/outer-control-ui";

export type DecisionRow = {
  id: string;
  source_model: string;
  verdict: Verdict;
  trust_score: number;
  summary: string | null;
  created_at: string;
  content_kind: "text" | "action";
  action_type: string | null;
  executed: boolean;
  matches: { rule_id: string; name: string; category: string; severity: string; sample?: string; rationale?: string | null; pattern?: string; redact?: boolean }[] | null;
  input_excerpt: string | null;
  output_text: string | null;
  action_params: Record<string, unknown> | null;
  corrected_params: Record<string, unknown> | null;
  execution_summary: string | null;
  changes: { rule_id: string | null; name: string; category: string; action: string; count: number }[] | null;
  next_step: "use_output" | "await_approval" | "discard" | null;
  shadow_matches: { rule_id: string; name: string; severity: string }[] | null;
  approval_id: string | null;
};

const label = "text-[10px] font-mono uppercase text-zinc-500";

function Detail({ r, onOpenApprovals }: { r: DecisionRow; onOpenApprovals: () => void }) {
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
      <div>
        <div className={label}>What happened</div>
        <p className="mt-0.5 text-zinc-100" data-testid="outcome-line">{describeOutcome(r)}</p>
        {r.verdict === "escalate" && r.approval_id && (
          <button type="button" onClick={onOpenApprovals} className="mt-1 text-cyan-300 underline-offset-2 hover:underline">Open the approval queue</button>
        )}
      </div>
      {r.summary && (
        <div>
          <div className={label}>Why</div>
          <p className="mt-0.5 text-zinc-300">{r.summary}</p>
        </div>
      )}
      <div className="text-zinc-500">Trust score {r.trust_score}{r.content_kind === "action" ? (r.executed ? " · executed" : " · evaluated only") : ""}</div>
      {!!r.changes?.length && (
        <div>
          <div className={label}>Changed</div>
          <ul className="mt-1 space-y-0.5">
            {r.changes.map((c, i) => (
              <li key={i} className="text-zinc-300">
                Removed {c.count} {c.count === 1 ? "span" : "spans"} · <span className="text-zinc-200">{c.name}</span>
                <span className="text-zinc-500"> · {c.category}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!r.shadow_matches?.length && (
        <div>
          <div className={label}>Shadow rules (observed only)</div>
          <p className="mt-0.5 text-zinc-400">{r.shadow_matches.map((m) => m.name).join(", ")} would have matched. They did not change this result.</p>
        </div>
      )}
      {!!r.matches?.length && (
        <div>
          <div className={label}>Matched rule(s)</div>
          <ul className="mt-1 space-y-0.5">
            {r.matches.map((m, i) => (
              <li key={i} className="text-zinc-300">
                <span className="text-zinc-200">{m.name}</span>
                <span className="text-zinc-500"> · {m.category} · {m.severity}</span>
                {m.rationale && <span className="text-zinc-500"> — {m.rationale}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.content_kind === "text" && (r.input_excerpt || r.output_text) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {r.input_excerpt && (
            <div>
              <div className={label}>Before</div>
              <p className="mt-0.5 whitespace-pre-wrap text-zinc-400">{maskSensitive(r.input_excerpt, r.matches)}</p>
            </div>
          )}
          {r.output_text && (
            <div>
              <div className={label}>After</div>
              <p className="mt-0.5 whitespace-pre-wrap text-zinc-300">{r.output_text}</p>
            </div>
          )}
        </div>
      )}
      {r.content_kind === "action" && (r.action_params || r.corrected_params) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {r.action_params && (
            <div>
              <div className={label}>Before</div>
              <pre className="mt-0.5 overflow-x-auto text-zinc-400">{JSON.stringify(r.action_params, null, 2)}</pre>
            </div>
          )}
          {r.corrected_params && (
            <div>
              <div className={label}>After (corrected)</div>
              <pre className="mt-0.5 overflow-x-auto text-zinc-300">{JSON.stringify(r.corrected_params, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
      {r.execution_summary && (
        <div>
          <div className={label}>Execution</div>
          <p className="mt-0.5 text-zinc-300">{r.execution_summary}</p>
        </div>
      )}
    </div>
  );
}

export default function RecentDecisions({ rows, onOpenApprovals }: { rows: DecisionRow[]; onOpenApprovals: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const shown = visibleItems(rows, DEFAULT_DECISIONS, showAll);
  return (
    <section className="hud-glass rounded-2xl px-6 py-5" aria-label="Recent decisions" data-testid="recent-decisions">
      <h2 className="text-base font-semibold text-zinc-100">Recent decisions</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          No decisions yet. Press <span className="text-zinc-300">Test</span> on a tool, then <span className="text-zinc-300">Start session</span>. Every reply Outer Control checks is listed here as Allow, Modify, Block or Needs approval.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {shown.map((r) => {
            const d = DECISION_LABEL[r.verdict];
            const open = expandedId === r.id;
            return (
              <li key={r.id} className="py-2" data-testid="decision-row">
                <button type="button" onClick={() => setExpandedId(open ? null : r.id)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
                  <span className={`w-28 shrink-0 rounded-full border px-2 py-0.5 text-center text-xs ${TONE_BORDER[d.tone]} ${TONE_TEXT[d.tone]}`}>{d.label}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {r.source_model}
                    {r.content_kind === "action" && r.action_type && <span className="text-zinc-500"> · {r.action_type}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">{timeAgo(r.created_at)}</span>
                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
                </button>
                {open && <Detail r={r} onOpenApprovals={onOpenApprovals} />}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > DEFAULT_DECISIONS && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm text-cyan-300 hover:text-cyan-200">
          {showAll ? "Show fewer" : `View all (${rows.length})`}
        </button>
      )}
    </section>
  );
}

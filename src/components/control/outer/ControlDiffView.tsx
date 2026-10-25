// Control Diff for one reply: what the tool sent, with every span a rule removed or flagged marked in place, next to what NazAI
// passed on. A removed span shows only what it was and which rule removed it ("[removed: API key · rule]"), never the text.
import { useState } from "react";
import { Eye, GitCompare, ShieldCheck } from "lucide-react";
import { diffSummary, type DecisionView } from "@/lib/outer-control-sessions";

export default function ControlDiffView({ diff, controlled, toolName }: { diff: NonNullable<DecisionView["diff"]>; controlled: string | null; toolName: string }) {
  const [view, setView] = useState<"tool" | "controlled">("tool");
  const summary = diffSummary(diff);
  const tab = (id: typeof view, label: string, Icon: typeof Eye) => (
    <button type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
      className={`flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${view === id ? "bg-cyan-400/20 text-cyan-50" : "text-zinc-400 hover:text-zinc-200"}`}>
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
  return (
    <div className="mt-1.5 rounded-lg border border-cyan-400/20 bg-[#04101f]/80 p-2 oc-in" data-testid="control-diff">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200/80"><GitCompare className="h-3 w-3" /> Control Diff</span>
        {summary && <span className="rounded-full border border-amber-300/30 px-1.5 text-[10px] text-amber-100/90" data-testid="control-diff-summary">{summary}</span>}
        <span className="ml-auto flex gap-0.5 rounded-lg border border-white/10 bg-black/30 p-0.5" role="tablist">
          {tab("tool", `${toolName} sent`, Eye)}
          {tab("controlled", "NazAI passed on", ShieldCheck)}
        </span>
      </div>
      {view === "tool" ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-300" data-testid="control-diff-tool">
          {diff.segments.map((s, i) => "t" in s ? <span key={i}>{s.t}</span>
            : "removed" in s
              ? <span key={i} title={`Removed by "${s.rule}". The text itself is never kept.`} className="mx-0.5 rounded border border-rose-400/40 bg-rose-500/15 px-1 font-mono text-[10px] text-rose-100" data-testid="diff-removed">[removed: {s.removed} · {s.rule}]</span>
              : <mark key={i} title={`${s.effect === "approval" ? "Needed approval" : "Blocked"}: "${s.rule}"`} className={`rounded px-0.5 text-inherit ${s.effect === "approval" ? "bg-amber-400/25 underline decoration-amber-300 decoration-dotted" : "bg-rose-500/25 underline decoration-rose-300 decoration-wavy"}`} data-testid="diff-flagged">{s.flagged}</mark>)}
          {diff.truncated && <span className="text-zinc-500"> …</span>}
        </p>
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-emerald-50/90" data-testid="control-diff-controlled">{controlled ?? "Nothing was passed on: this reply was not used."}</p>
      )}
      <p className="mt-1.5 text-[10px] text-zinc-500">
        <span className="mr-2 inline-block h-2 w-2 rounded-sm bg-rose-500/40 align-middle" /> removed or blocked
        <span className="mx-2 inline-block h-2 w-2 rounded-sm bg-amber-400/40 align-middle" /> needs approval
      </p>
    </div>
  );
}

// Outer Control: "Generate a report". Ask several connected tools for their opinion on one topic, in turn; every answer is
// checked against your rules; then one report is written from those answers and attached as the Task's final result.
import { useState } from "react";
import { FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkReportForm, MAX_REPORT_TOOLS, toolHealth, type ToolHealthInput } from "@/lib/outer-control-tools-ui";
import ToolPlanBox, { useToolPlan } from "./ToolPlanBox";

const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";

export type ReportTool = ToolHealthInput & { id: string; name: string; model?: string | null; endpoint_url?: string | null };

export default function ReportPanel({ open, onOpenChange, tools, busy, onStart, onFix, fixing, onConnect }: {
  open: boolean; onOpenChange: (o: boolean) => void; tools: ReportTool[]; busy: boolean;
  /** Starts the report; resolves true when it was started. keepChoice: the person kept their tools although the topic names another. */
  onStart: (topic: string, toolIds: string[], keepChoice: boolean) => Promise<boolean>;
  /** Runs the connection test of a tool that needs attention. */
  onFix?: (tool: ReportTool) => void;
  fixing?: string | null;
  onConnect?: () => void;
}) {
  const [topic, setTopic] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const plan = useToolPlan(topic, tools, picked, MAX_REPORT_TOOLS);
  const problem = checkReportForm(topic, picked) ?? (topic.trim() ? plan.block : null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_REPORT_TOOLS ? p : [...p, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-zinc-950 text-zinc-100 sm:max-w-xl" data-testid="report-panel">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg"><FileText className="h-4 w-4 text-cyan-300" /> Generate a report</DialogTitle>
          <DialogDescription className="text-zinc-400">
            The tools you pick are asked for their opinion one after another. Each answer is checked against your rules before it is kept. Then one report is written from those answers. It uses one credit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <textarea className={inputCls} rows={3} aria-label="Report topic" placeholder="What should the report be about? e.g. Should we adopt a control layer for our AI tools?" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <fieldset>
            <legend className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Ask these tools, in this order ({picked.length} chosen)</legend>
            {tools.length === 0 ? <p className="mt-2 text-sm text-zinc-500">Connect a tool first.</p> : (
              <ul className="mt-2 space-y-1.5">
                {tools.map((t) => {
                  const h = toolHealth(t);
                  const idx = picked.indexOf(t.id);
                  return (
                    <li key={t.id}>
                      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]">
                        <span className="flex min-w-0 items-center gap-2">
                          <input type="checkbox" checked={idx >= 0} onChange={() => toggle(t.id)} aria-label={`Ask ${t.name}`} />
                          <span className="truncate text-zinc-100">{t.name}</span>
                          {idx >= 0 && <span className="rounded-full border border-cyan-500/40 px-1.5 text-[10px] text-cyan-300">#{idx + 1}</span>}
                        </span>
                        <span className={`shrink-0 text-xs ${h.key === "working" ? "text-emerald-300" : h.key === "failed" ? "text-rose-300" : "text-amber-300"}`}>{h.label}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
          {picked.some((id) => { const t = tools.find((x) => x.id === id); return t && toolHealth(t).key === "failed"; }) && (
            <p className="text-xs text-amber-200/90">A chosen tool failed its last test. If it fails during the report, the report stops there and says which tool.</p>
          )}
          <ToolPlanBox state={plan} mode="pick" max={MAX_REPORT_TOOLS} busy={busy} onUse={setPicked} onFix={(t) => onFix?.(t as ReportTool)} fixing={fixing} onConnect={onConnect} />
          {problem && (topic || picked.length > 0) && <p className="text-xs text-zinc-400">{problem}</p>}
          <button disabled={busy || !!problem}
            onClick={async () => { if (await onStart(topic.replace(/\s+/g, " ").trim(), picked, plan.kept)) { setTopic(""); setPicked([]); onOpenChange(false); } }}
            className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40">
            {busy ? "Starting…" : "Generate report"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

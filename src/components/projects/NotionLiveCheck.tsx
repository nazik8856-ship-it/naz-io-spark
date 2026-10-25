// The live check for a linked Notion project: a real import read back, write-back turned on, one test line sent for approval,
// approved and run in Approvals, and finally found in the page NazAI reads again. Every step is read from what actually happened
// (the project, its approvals, its current text), so the check can not pass on a promise.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronDown, Circle, Loader2, Radar, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { callProjects, liveCheckLine, liveCheckSteps, type ImportedProject, type LiveApproval, type LiveStep } from "@/lib/projects";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

const ICON: Record<LiveStep["state"], JSX.Element> = {
  done: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
  waiting: <Loader2 className="h-4 w-4 animate-spin text-amber-300" />,
  failed: <XCircle className="h-4 w-4 text-rose-300" />,
  todo: <Circle className="h-4 w-4 text-zinc-600" />,
};

export default function NotionLiveCheck({ project, content, accountId, onRefresh, onEnableWriteBack, onChanged }: {
  project: ImportedProject; content: string | null; accountId: string;
  onRefresh: () => Promise<unknown>; onEnableWriteBack: () => void; onChanged: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const [approvals, setApprovals] = useState<LiveApproval[]>([]);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadApprovals = useCallback(async () => {
    const { data } = await anyDb.from("pending_approvals").select("id, status, executed_at, execution_error, params, created_at")
      .eq("user_id", accountId).eq("origin", "projects").order("created_at", { ascending: false }).limit(20);
    setApprovals((data as LiveApproval[]) ?? []);
  }, [accountId]);
  useEffect(() => { void loadApprovals(); }, [loadApprovals, project.updated_at, content]);

  const { steps, done, next } = liveCheckSteps(project, approvals, content);
  const passed = next === null;

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await loadApprovals(); } finally { setBusy(false); } };
  const sendTestLine = () => act(async () => {
    const r = await callProjects("write_back", { project_id: project.id, account_id: accountId, text: liveCheckLine() });
    if (!r.ok) { toast.error(r.message || "The test line could not be sent."); return; }
    toast.success("Test line waiting in Approvals. Nothing is written before you run it.");
    await onChanged();
  });

  const action = (s: LiveStep): { label: string; run: () => void } | null => {
    if (s.key === "read") return { label: "Read the page now", run: () => void act(onRefresh) };
    if (s.key === "write_back") return { label: "Turn on write-back", run: onEnableWriteBack };
    if (s.key === "sent") return { label: "Send a test line", run: () => void sendTestLine() };
    if (s.key === "run") return s.state === "failed" ? { label: "Send a new test line", run: () => void sendTestLine() } : { label: "Open Approvals", run: () => navigate("/control-system/approvals") };
    if (s.key === "landed" && s.state === "waiting") return { label: "Read the page again", run: () => void act(onRefresh) };
    return null;
  };

  return (
    <section className="rounded-2xl border border-cyan-400/25 bg-gradient-to-b from-[#06203a]/70 to-[#070f22]/60 p-4 sm:p-5" data-testid="live-check" data-passed={passed}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${passed ? "border-emerald-400/50 bg-emerald-400/15" : "border-cyan-400/40 bg-cyan-400/10"}`}><Radar className={`h-4 w-4 ${passed ? "text-emerald-200" : "text-cyan-200"}`} /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200/80">Live check · Notion</span>
          <span className="block text-sm text-zinc-100" data-testid="live-check-summary">{passed ? "Passed: NazAI read the page, wrote to it after your approval, and found the line." : `${done} of ${steps.length} steps · next: ${next!.label}`}</span>
        </span>
        <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-white/10 sm:block" aria-hidden><span className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></span>
        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="mt-4 space-y-2">
          {steps.map((s) => {
            const a = s === next ? action(s) : null;
            return (
              <li key={s.key} className={`flex flex-wrap items-start gap-3 rounded-xl border px-3 py-2 ${s === next ? "border-cyan-400/40 bg-cyan-400/[0.06]" : "border-white/5 bg-black/20"}`} data-testid="live-step" data-state={s.state}>
                <span className="mt-0.5">{ICON[s.state]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-zinc-100">{s.label}</span>
                  <span className={`block break-words text-xs ${s.state === "failed" ? "text-rose-200" : "text-zinc-400"}`}>{s.detail}</span>
                </span>
                {a && <button type="button" disabled={busy} onClick={a.run} className="rounded-lg border border-cyan-400/50 bg-cyan-400/15 px-3 py-1 text-xs font-semibold text-cyan-50 hover:bg-cyan-400/25 disabled:opacity-50" data-testid="live-step-action">{a.label}</button>}
              </li>
            );
          })}
        </ol>
      )}
      {open && <p className="mt-3 text-[11px] text-zinc-500">The test line stays in your Notion page; delete it there when you are done.</p>}
    </section>
  );
}

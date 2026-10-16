// Inner Control page, main section: the rules that govern the AI, in one list.
// Hard rules and safety rules sit together; each row says what it is, whether it is on,
// and has Edit / Disable / Delete. Adding a rule is the prominent action.
import { useState } from "react";
import { Gavel, MessageCircle, Pencil, Plus, ScanSearch, Trash2, Eye } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KIND_LABEL, type RuleCounts, type RuleItem } from "@/lib/inner-control-ui";

type Props = {
  rules: RuleItem[];
  counts: RuleCounts;
  loading: boolean;
  canWrite: boolean;
  dualControl: boolean;
  busyKey: string | null;
  /** A rule to ring, set when an activity row points at it. */
  highlightKey?: string | null;
  onAdd: () => void;
  onTemplates: () => void;
  onEdit: (r: RuleItem) => void;
  onToggle: (r: RuleItem) => void;
  onDelete: (r: RuleItem) => void;
  onAsk: (r: RuleItem) => void;
};

export default function YourRulesCard({
  rules, counts, loading, canWrite, dualControl, busyKey, highlightKey,
  onAdd, onTemplates, onEdit, onToggle, onDelete, onAsk,
}: Props) {
  const [confirming, setConfirming] = useState<RuleItem | null>(null);

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" aria-label="Your rules" data-testid="your-rules">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-100">Your rules</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {counts.total === 0
              ? "Nothing governs your AI yet."
              : `${counts.enforcing} enforcing${counts.shadow ? ` · ${counts.shadow} in shadow mode` : ""}${counts.disabled ? ` · ${counts.disabled} disabled` : ""}`}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/60 bg-cyan-400 px-4 py-2 text-sm font-semibold text-black shadow-[0_0_18px_rgba(34,211,238,0.3)] transition hover:bg-cyan-300"
          >
            <Plus className="h-4 w-4" /> Add rule
          </button>
        )}
      </div>

      {!canWrite && (
        <p className="mt-3 text-[11px] text-amber-300/80">
          You have view-only access to this account's rules — only the account owner or a team owner can change them.
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-zinc-500">Loading your rules…</p>
      ) : rules.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-white/15 bg-black/20 p-5 text-center" data-testid="rules-empty">
          <p className="text-sm font-medium text-zinc-200">No rules yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
            Rules decide what your AI may do on its own, what needs a person's approval and what is always blocked.
            Start from a template, or write your first rule in plain English.
          </p>
          {canWrite && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button onClick={onTemplates} className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20">
                Start from a policy template
              </button>
              <button onClick={onAdd} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5">
                Write my own rule
              </button>
            </div>
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {rules.map((r) => {
            const off = r.status === "disabled";
            const busy = busyKey === r.key;
            return (
              <li
                key={r.key}
                data-testid={`rule-row-${r.key}`}
                data-status={r.status}
                className={`rounded-lg border px-3 py-2.5 transition ${
                  highlightKey === r.key ? "border-cyan-400/70 ring-2 ring-cyan-400/40" : off ? "border-white/5 bg-black/20" : "border-white/10 bg-black/30"
                }`}
              >
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className={`break-words text-sm ${off ? "text-zinc-500 line-through decoration-zinc-700" : "text-zinc-100"}`}>{r.name}</p>
                    <p className="mt-0.5 break-words text-[11px] text-zinc-500">{r.effect} · {r.scope}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-zinc-300">
                        {r.kind === "hard" ? <Gavel className="h-3 w-3" /> : <ScanSearch className="h-3 w-3" />}
                        {KIND_LABEL[r.kind]}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                          off ? "bg-zinc-500/15 text-zinc-400" : "bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {off ? "Disabled" : "Active"}
                      </span>
                      {r.shadow && !off && (
                        <span
                          title="Watched and logged only. It never changes an outcome until it is promoted to live."
                          className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-amber-300"
                        >
                          <Eye className="h-3 w-3" /> Shadow
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => onAsk(r)}
                      aria-label={`Ask the chat about: ${r.name}`}
                      title="Ask the chat about this rule"
                      className="rounded-md border border-white/10 p-1.5 text-zinc-400 hover:bg-white/5 hover:text-cyan-200"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </button>
                    {canWrite && (
                      <>
                        <button
                          onClick={() => onEdit(r)}
                          aria-label={`Edit rule: ${r.name}`}
                          className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1 text-xs text-zinc-200 hover:bg-white/5"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          onClick={() => onToggle(r)}
                          disabled={busy}
                          aria-label={`${off ? "Enable" : "Disable"} rule: ${r.name}`}
                          className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-50"
                        >
                          {off ? "Enable" : "Disable"}
                        </button>
                        <button
                          onClick={() => setConfirming(r)}
                          disabled={busy}
                          aria-label={`Delete rule: ${r.name}`}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={!!confirming} onOpenChange={(o) => { if (!o) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? `"${confirming.name}" will stop applying to your AI.` : ""}{" "}
              {dualControl
                ? "Dual control is on, so this sends a deletion request that a second owner must approve."
                : "This cannot be undone. To keep it but switch it off, use Disable instead."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep rule</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirming) onDelete(confirming); setConfirming(null); }}
            >
              {dualControl ? "Request deletion" : "Delete rule"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

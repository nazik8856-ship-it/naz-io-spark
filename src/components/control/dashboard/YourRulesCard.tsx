// Inner Control page, main section: the rules that govern the AI, in one list.
// Hard rules and safety rules sit together; each row says what it is, whether it is on,
// and has Edit / Disable / Delete. Adding a rule is the prominent action.
import { useState } from "react";
import { ChevronDown, ChevronUp, Gavel, Plus, ScanSearch } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KIND_LABEL, type RuleCounts, type RuleItem } from "@/lib/inner-control-ui";

/** How many rules show before "Show all". */
export const RULES_SHOWN = 5;

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
  const [expanded, setExpanded] = useState(false);
  // A rule an activity row points at is always shown, even when it sits below the fold.
  const pointedAt = highlightKey ? rules.findIndex((r) => r.key === highlightKey) >= RULES_SHOWN : false;
  const showAll = expanded || pointedAt;
  const visible = showAll ? rules : rules.slice(0, RULES_SHOWN);

  return (
    <section aria-label="Your rules" data-testid="your-rules">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-zinc-50">Your rules</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {counts.total === 0
              ? "Nothing governs your AI yet."
              : `${counts.enforcing} enforcing${counts.shadow ? ` · ${counts.shadow} in shadow mode` : ""}${counts.disabled ? ` · ${counts.disabled} disabled` : ""}`}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3.5 py-2 text-sm font-semibold text-black shadow-[0_0_18px_rgba(34,211,238,0.3)] transition hover:bg-cyan-300"
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
        <ul className="mt-4 space-y-3">
          {visible.map((r) => {
            const off = r.status === "disabled";
            // A shadow rule is watched, not enforced: it is shown dimmed with its own status.
            const dim = off || (r.shadow && !off);
            const busy = busyKey === r.key;
            const link = "rounded px-1 py-0.5 text-xs text-zinc-400 transition hover:text-cyan-200 disabled:opacity-50";
            return (
              <li
                key={r.key}
                data-testid={`rule-row-${r.key}`}
                data-status={r.status}
                className={`rounded-2xl border px-4 py-3.5 transition ${
                  highlightKey === r.key ? "border-cyan-400/70 ring-2 ring-cyan-400/40"
                    : dim ? "border-white/10 bg-white/[0.03]"
                    : "border-cyan-400/25 bg-gradient-to-br from-cyan-400/[0.07] to-white/[0.02] shadow-[0_0_18px_rgba(34,211,238,0.06)]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className={`min-w-0 flex-1 break-words text-[15px] font-medium leading-snug ${dim ? "text-zinc-400" : "text-zinc-50"} ${off ? "line-through decoration-zinc-700" : ""}`}>{r.name}</p>
                  <span
                    title={r.shadow && !off ? "Watched and logged only. It never changes an outcome until it is promoted to live." : undefined}
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      off ? "bg-zinc-500/20 text-zinc-300" : r.shadow ? "bg-zinc-200/10 text-zinc-200 ring-1 ring-white/15" : "bg-emerald-400/20 text-emerald-200"
                    }`}
                  >
                    {off ? "Disabled" : r.shadow ? "Shadow" : "Active"}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
                    {r.kind === "hard" ? <Gavel className="h-3 w-3" /> : <ScanSearch className="h-3 w-3" />}
                    {KIND_LABEL[r.kind]}
                  </span>
                  <span className="min-w-0 break-words text-xs text-zinc-500">{r.effect} · {r.scope}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-end gap-x-0.5">
                  <button onClick={() => onAsk(r)} aria-label={`Ask the chat about: ${r.name}`} title="Ask the chat about this rule" className={link}>Ask</button>
                  {canWrite && (
                    <>
                      <span aria-hidden className="text-zinc-700">·</span>
                      <button onClick={() => onEdit(r)} aria-label={`Edit rule: ${r.name}`} className={link}>Edit</button>
                      <span aria-hidden className="text-zinc-700">·</span>
                      <button onClick={() => onToggle(r)} disabled={busy} aria-label={`${off ? "Enable" : "Disable"} rule: ${r.name}`} className={link}>{off ? "Enable" : "Disable"}</button>
                      <span aria-hidden className="text-zinc-700">·</span>
                      <button onClick={() => setConfirming(r)} disabled={busy} aria-label={`Delete rule: ${r.name}`} className={`${link} hover:!text-rose-300`}>Delete</button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {rules.length > RULES_SHOWN && (
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={showAll}
          data-testid="rules-expand"
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 py-2 text-xs text-zinc-300 hover:bg-white/5 hover:text-white"
        >
          {showAll ? <>Show fewer <ChevronUp className="h-3.5 w-3.5" /></> : <>Show all {rules.length} rules <ChevronDown className="h-3.5 w-3.5" /></>}
        </button>
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

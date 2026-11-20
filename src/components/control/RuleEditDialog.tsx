// Inner Control: Edit a rule in place. A hard rule (stop or hold an action) and a safety rule (find text in a reply) each show the
// same choices as their Add form, filled with what the rule says now; the same checks run before anything is saved. Its on/off and
// shadow state are not touched here (Disable / Enable and the shadow controls do that).
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { HardRuleRow, MeaningRuleRow, RuleItem, SafetyRuleRow } from "@/lib/inner-control-ui";
import {
  hardEditOf, hardEditProblem, MEANING_ACTION_LABEL, meaningEditOf, meaningEditProblem, SAFETY_ACTION_LABEL, safetyEditOf,
  safetyEditProblem, SCOPE_CHOICES, type HardEdit, type MeaningAction, type MeaningEdit, type SafetyAction, type SafetyEdit,
} from "@/lib/inner-rule-edit";

const field = "mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400/60";
const label = "block text-xs text-zinc-400";

export default function RuleEditDialog({ rule, row, busy, onClose, onSave }: {
  rule: RuleItem | null;
  row: HardRuleRow | SafetyRuleRow | MeaningRuleRow | null;
  busy: boolean;
  onClose: () => void;
  /** Saves the edit; resolves true when it was saved (the dialog then closes). */
  onSave: (r: RuleItem, e: HardEdit | SafetyEdit | MeaningEdit) => Promise<boolean>;
}) {
  const [hard, setHard] = useState<HardEdit | null>(null);
  const [safety, setSafety] = useState<SafetyEdit | null>(null);
  const [meaning, setMeaning] = useState<MeaningEdit | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    setTried(false);
    setHard(null); setSafety(null); setMeaning(null);
    if (!rule || !row) return;
    if (rule.kind === "hard") setHard(hardEditOf(row as HardRuleRow));
    else if (rule.kind === "safety") setSafety(safetyEditOf(row as SafetyRuleRow));
    else setMeaning(meaningEditOf(row as MeaningRuleRow));
  }, [rule, row]);

  const problem = hard ? hardEditProblem(hard) : safety ? safetyEditProblem(safety) : meaning ? meaningEditProblem(meaning) : null;
  const scopeKnown = hard ? SCOPE_CHOICES.some((c) => c.value === hard.scope) : true;

  const save = async () => {
    setTried(true);
    if (!rule || problem || busy) return;
    const e = hard ?? safety ?? meaning;
    if (e && (await onSave(rule, e))) onClose();
  };

  return (
    <Dialog open={!!rule} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg border-white/10 bg-[#050b1a] text-white" data-testid="rule-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit rule</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {rule?.kind === "hard" ? "What the rule stops or holds, and for which actions."
              : rule?.kind === "meaning" ? "What a reply must never do, in plain words, and what happens when one does."
              : "The text it looks for in replies, and what happens on a match."}
            {rule?.shadow ? " It stays in shadow mode: watched and logged only." : rule?.status === "disabled" ? " It stays disabled until you enable it." : ""}
          </DialogDescription>
        </DialogHeader>

        {!row && rule && <p className="text-sm text-amber-200">This rule could not be loaded. Close and try again.</p>}

        {hard && (
          <div className="space-y-3">
            <label className={label}>Rule
              <textarea rows={2} value={hard.text} onChange={(e) => setHard({ ...hard, text: e.target.value })} className={field} aria-label="Rule" />
            </label>
            <label className={label}>Applies to
              <select value={scopeKnown ? hard.scope : "__custom"} onChange={(e) => setHard({ ...hard, scope: e.target.value === "__custom" ? "" : e.target.value })} className={field} aria-label="Applies to">
                {SCOPE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                <option value="__custom">Other action pattern…</option>
              </select>
            </label>
            {!scopeKnown && (
              <label className={label}>Action pattern
                <input value={hard.scope} onChange={(e) => setHard({ ...hard, scope: e.target.value })} className={field} aria-label="Action pattern" placeholder="e.g. stripe_*" />
              </label>
            )}
            <label className={label}>What it does
              <select value={hard.effect} onChange={(e) => setHard({ ...hard, effect: e.target.value as HardEdit["effect"] })} className={field} aria-label="What it does">
                <option value="always_block">Always block the action</option>
                <option value="always_require_approval">Hold it for approval</option>
              </select>
            </label>
            {hard.effect === "always_require_approval" && (
              <label className={label}>Approvals needed
                <select value={hard.approvals} onChange={(e) => setHard({ ...hard, approvals: Number(e.target.value) })} className={field} aria-label="Approvals needed">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        {safety && (
          <div className="space-y-3">
            <label className={label}>Name
              <input value={safety.name} onChange={(e) => setSafety({ ...safety, name: e.target.value })} className={field} aria-label="Name" />
            </label>
            <label className={label}>Text pattern to look for
              <input value={safety.pattern} onChange={(e) => setSafety({ ...safety, pattern: e.target.value })} className={`${field} font-mono`} aria-label="Text pattern" />
            </label>
            <label className={label}>On a match
              <select value={safety.action} onChange={(e) => setSafety({ ...safety, action: e.target.value as SafetyAction })} className={field} aria-label="On a match">
                {(Object.keys(SAFETY_ACTION_LABEL) as SafetyAction[]).map((a) => <option key={a} value={a}>{SAFETY_ACTION_LABEL[a]}</option>)}
              </select>
            </label>
          </div>
        )}

        {meaning && (
          <div className="space-y-3">
            <label className={label}>The rule, in plain words
              <textarea rows={3} value={meaning.description} onChange={(e) => setMeaning({ ...meaning, description: e.target.value })} className={field} aria-label="The rule, in plain words" />
            </label>
            <label className={label}>Name
              <input value={meaning.name} onChange={(e) => setMeaning({ ...meaning, name: e.target.value })} className={field} aria-label="Name" />
            </label>
            <label className={label}>When a reply breaks it
              <select value={meaning.action} onChange={(e) => setMeaning({ ...meaning, action: e.target.value as MeaningAction })} className={field} aria-label="When a reply breaks it">
                {(Object.keys(MEANING_ACTION_LABEL) as MeaningAction[]).map((a) => <option key={a} value={a}>{MEANING_ACTION_LABEL[a]}</option>)}
              </select>
            </label>
          </div>
        )}

        {tried && problem && <p className="text-sm text-rose-300" role="alert" data-testid="rule-edit-problem">{problem}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy || !row} data-testid="rule-edit-save"
            className="rounded-lg border border-cyan-300/50 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-40">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

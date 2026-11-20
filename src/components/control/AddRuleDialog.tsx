// Inner Control: the one Add rule window (Inner Day 2). It starts with what the rule should do, then asks only what that kind of
// rule needs, with the same choices and checks as Edit:
//   Stop or hold an action  → a hard rule (hard_rules): what it says, which actions, block or hold for approval
//   Find words in replies   → a safety rule (safety_rules): the words or phrases to look for (NazAI builds the pattern, as the chat
//                              does), or a pattern of your own; then block, hold or remove them
// A new rule starts in shadow mode (watched and logged only) unless the person switches that off, as rules made in the chat do. It is
// written with the same table write as before, and a write that changed nothing is said. The full hard-rule editor stays one click
// away as a fallback.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Gavel, Loader2, MessageSquareText, ScanSearch } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import {
  hardEditProblem, hardPatch, MEANING_ACTION_LABEL, meaningEditProblem, meaningPatch, NOTHING_CHANGED, SAFETY_ACTION_LABEL,
  safetyEditProblem, safetyPatch, SCOPE_CHOICES, type HardEdit, type MeaningAction, type MeaningEdit, type SafetyAction, type SafetyEdit,
} from "@/lib/inner-rule-edit";
import { phrasesFrom, phrasesPattern } from "@/lib/rule-phrases";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

const field = "mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400/60";
const label = "block text-xs text-zinc-400";

export type RuleKindChoice = "action" | "text" | "meaning";
export type AnyRuleEdit = HardEdit | SafetyEdit | MeaningEdit;
export type TextDraft = { name: string; words: string; advanced: boolean; pattern: string; action: SafetyAction };

const NEW_HARD: HardEdit = { text: "", scope: "*", effect: "always_require_approval", approvals: 1 };
const NEW_TEXT: TextDraft = { name: "", words: "", advanced: false, pattern: "", action: "block" };
const NEW_MEANING: MeaningEdit = { name: "", description: "", action: "block" };

/** A rule in plain words as saved: a name made from its first words when none was given. */
export function meaningRuleOf(m: MeaningEdit): MeaningEdit {
  const d = m.description.trim().replace(/\s+/g, " ");
  const words = d.split(" ").slice(0, 7).join(" ");
  const made = words.length < d.length ? `${words}…` : words;
  return { ...m, description: d, name: m.name.trim() || made.slice(0, 120) };
}

/** The safety rule a text draft becomes: the pattern built from the words (or the one typed), and a name when none was given. */
export function textRuleOf(t: TextDraft): SafetyEdit {
  const phrases = phrasesFrom(t.words);
  const pattern = t.advanced ? t.pattern.trim() : phrases.length ? phrasesPattern(phrases) : "";
  const name = t.name.trim() || (phrases.length ? `Mentions ${phrases.slice(0, 3).join(", ")}` : "");
  return { name, pattern, action: t.action };
}

/** The row the Add window writes: the same columns Edit writes, plus who owns it and whether it starts in shadow mode. */
export function newRuleRow(kind: RuleKindChoice, e: AnyRuleEdit, accountId: string, shadow: boolean): { table: "hard_rules" | "safety_rules" | "meaning_rules"; row: Record<string, unknown> } {
  // A rule in plain words for the whole account: no project.
  if (kind === "meaning") return { table: "meaning_rules", row: { user_id: accountId, project_id: null, ...meaningPatch(e as MeaningEdit), enabled: true, shadow_mode: shadow } };
  if (kind === "action") return { table: "hard_rules", row: { user_id: accountId, ...hardPatch(e as HardEdit), shadow_mode: shadow, agent_id: null } };
  return { table: "safety_rules", row: { user_id: accountId, ...safetyPatch(e as SafetyEdit), category: "custom", shadow_mode: shadow, agent_id: null, api_key_id: null } };
}

export default function AddRuleDialog({ open, onOpenChange, accountId, canWrite, onSaved, fallback, extra }: {
  open: boolean; onOpenChange: (o: boolean) => void; accountId: string | null | undefined; canWrite: boolean;
  /** Called once the rule was saved. */
  onSaved: () => void;
  /** The full hard-rule editor, shown when asked for (the old Add form). */
  fallback?: ReactNode;
  /** Shown above Save for the rule as typed so far (Try it first, conflict warnings); phrases are the words typed for a text rule. */
  extra?: (kind: RuleKindChoice, rule: AnyRuleEdit, problem: string | null, phrases: string[]) => ReactNode;
}) {
  const [kind, setKind] = useState<RuleKindChoice | null>(null);
  const [hard, setHard] = useState<HardEdit>(NEW_HARD);
  const [text, setText] = useState<TextDraft>(NEW_TEXT);
  const [meaningDraft, setMeaningDraft] = useState<MeaningEdit>(NEW_MEANING);
  const [shadow, setShadow] = useState(true);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(null); setHard(NEW_HARD); setText(NEW_TEXT); setMeaningDraft(NEW_MEANING); setShadow(true); setTried(false); setBusy(false); setSaveError(null); setShowFallback(false);
  }, [open]);

  const safety = useMemo(() => textRuleOf(text), [text]);
  const meaning = useMemo(() => meaningRuleOf(meaningDraft), [meaningDraft]);
  const rule: AnyRuleEdit = kind === "action" ? hard : kind === "meaning" ? meaning : safety;
  const problem = kind === "action" ? hardEditProblem(hard) : kind === "meaning" ? meaningEditProblem(meaning) : kind === "text"
    ? (!text.advanced && phrasesFrom(text.words).length === 0 ? "Type the words or phrases the rule should look for." : safetyEditProblem(safety))
    : null;
  const scopeKnown = SCOPE_CHOICES.some((c) => c.value === hard.scope);

  const save = async () => {
    setTried(true); setSaveError(null);
    if (!kind || !accountId || problem || busy || !canWrite) return;
    setBusy(true);
    const { table, row } = newRuleRow(kind, rule, accountId, shadow);
    const { data, error } = await anyDb.from(table).insert(row).select("id");
    setBusy(false);
    if (error || !Array.isArray(data) || !data.length) { setSaveError(error ? friendlyErrorMessage(error.message) : NOTHING_CHANGED); return; }
    toast({ title: "Rule added", description: shadow ? "It starts in shadow mode: watched and logged, nothing is blocked yet. Make it live from your rules list." : "It applies from the next action." });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-white/10 bg-[#050b1a] text-white" data-testid="add-rule-dialog">
        <DialogHeader>
          <DialogTitle>Add a rule</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {showFallback ? "The full hard-rule editor." : !kind ? "What should this rule do?" : kind === "action" ? "Stop or hold an action your AI wants to take."
              : kind === "meaning" ? "Say in plain words what a reply must never do. An AI judge reads each reply and must quote the words that break it."
              : "Find words in what your AI writes, and block, hold or remove them."}
          </DialogDescription>
        </DialogHeader>

        {!canWrite && <p className="text-sm text-amber-200">Your role can not add rules on this account. Ask an owner to add it.</p>}

        {showFallback ? (
          <div className="space-y-3">
            <button type="button" onClick={() => setShowFallback(false)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-cyan-200"><ArrowLeft className="h-3 w-3" /> Back</button>
            {fallback}
          </div>
        ) : !kind ? (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="add-rule-kinds">
            <button type="button" onClick={() => setKind("action")} disabled={!canWrite} data-testid="add-kind-action"
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-cyan-300/50 hover:bg-cyan-400/[0.06] disabled:opacity-40">
              <Gavel className="h-5 w-5 text-cyan-300" />
              <span className="mt-2 block text-sm font-semibold text-zinc-50">Stop or hold an action</span>
              <span className="mt-1 block text-xs text-zinc-400">For example: never send emails without my approval.</span>
            </button>
            <button type="button" onClick={() => setKind("text")} disabled={!canWrite} data-testid="add-kind-text"
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-cyan-300/50 hover:bg-cyan-400/[0.06] disabled:opacity-40">
              <ScanSearch className="h-5 w-5 text-cyan-300" />
              <span className="mt-2 block text-sm font-semibold text-zinc-50">Find words in replies</span>
              <span className="mt-1 block text-xs text-zinc-400">For example: never mention prices or discounts to customers.</span>
            </button>
            <button type="button" onClick={() => setKind("meaning")} disabled={!canWrite} data-testid="add-kind-meaning"
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-cyan-300/50 hover:bg-cyan-400/[0.06] disabled:opacity-40 sm:col-span-2">
              <MessageSquareText className="h-5 w-5 text-cyan-300" />
              <span className="mt-2 block text-sm font-semibold text-zinc-50">Say it in plain words</span>
              <span className="mt-1 block text-xs text-zinc-400">For when no list of words can catch it. For example: never promise a delivery date. An AI judge reads each reply.</span>
            </button>
            {fallback && (
              <button type="button" onClick={() => setShowFallback(true)} className="text-left text-[11px] text-zinc-500 underline-offset-2 hover:text-cyan-200 hover:underline sm:col-span-2" data-testid="add-rule-fallback">
                Use the full hard-rule editor instead
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <button type="button" onClick={() => { setKind(null); setTried(false); setSaveError(null); }} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-cyan-200"><ArrowLeft className="h-3 w-3" /> What should this rule do?</button>

            {kind === "action" && (
              <>
                <label className={label}>The rule, in your words
                  <textarea rows={2} value={hard.text} onChange={(e) => setHard({ ...hard, text: e.target.value })} className={field} aria-label="Rule" placeholder="Never send emails to customers without my approval" />
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
                    <option value="always_require_approval">Hold it for approval</option>
                    <option value="always_block">Always block the action</option>
                  </select>
                </label>
                {hard.effect === "always_require_approval" && (
                  <label className={label}>Approvals needed
                    <select value={hard.approvals} onChange={(e) => setHard({ ...hard, approvals: Number(e.target.value) })} className={field} aria-label="Approvals needed">
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
              </>
            )}

            {kind === "text" && (
              <>
                {text.advanced ? (
                  <label className={label}>Text pattern (a regular expression, matched without regard to case)
                    <input value={text.pattern} onChange={(e) => setText({ ...text, pattern: e.target.value })} className={`${field} font-mono`} aria-label="Text pattern" placeholder="\b(price|discount)\b" />
                  </label>
                ) : (
                  <label className={label}>Words or phrases to look for (separate them with commas)
                    <input value={text.words} onChange={(e) => setText({ ...text, words: e.target.value })} className={field} aria-label="Words to look for" placeholder="price, discount, €" />
                  </label>
                )}
                <button type="button" onClick={() => setText({ ...text, advanced: !text.advanced, pattern: text.advanced ? text.pattern : (text.pattern || safety.pattern) })}
                  className="text-[11px] text-zinc-500 hover:text-cyan-200" data-testid="add-rule-advanced">
                  {text.advanced ? "Use plain words instead" : "Advanced: write a pattern"}
                </button>
                <label className={label}>Name (optional)
                  <input value={text.name} onChange={(e) => setText({ ...text, name: e.target.value })} className={field} aria-label="Name" placeholder={safety.name || "Mentions prices"} />
                </label>
                <label className={label}>On a match
                  <select value={text.action} onChange={(e) => setText({ ...text, action: e.target.value as SafetyAction })} className={field} aria-label="On a match">
                    {(Object.keys(SAFETY_ACTION_LABEL) as SafetyAction[]).map((a) => <option key={a} value={a}>{SAFETY_ACTION_LABEL[a]}</option>)}
                  </select>
                </label>
              </>
            )}

            {kind === "meaning" && (
              <>
                <label className={label}>The rule, in plain words
                  <textarea rows={3} value={meaningDraft.description} onChange={(e) => setMeaningDraft({ ...meaningDraft, description: e.target.value })} className={field}
                    aria-label="The rule, in plain words" placeholder="Never promise a delivery date or a delivery time" />
                </label>
                <label className={label}>Name (optional)
                  <input value={meaningDraft.name} onChange={(e) => setMeaningDraft({ ...meaningDraft, name: e.target.value })} className={field} aria-label="Name" placeholder={meaning.name || "No delivery promises"} />
                </label>
                <label className={label}>When a reply breaks it
                  <select value={meaningDraft.action} onChange={(e) => setMeaningDraft({ ...meaningDraft, action: e.target.value as MeaningAction })} className={field} aria-label="When a reply breaks it">
                    {(Object.keys(MEANING_ACTION_LABEL) as MeaningAction[]).map((a) => <option key={a} value={a}>{MEANING_ACTION_LABEL[a]}</option>)}
                  </select>
                </label>
                <p className="text-[11px] text-zinc-500">It applies to every reply NazAI checks for this account. Each check is one short AI call; a reply other rules already block is not sent.</p>
              </>
            )}

            <label className="flex items-start gap-2 text-[11px] text-zinc-400">
              <input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} className="mt-0.5 accent-cyan-400" aria-label="Start in shadow mode" />
              <span>Start in shadow mode: watch and log only, so you can see what it would catch before it blocks anything.</span>
            </label>

            {extra?.(kind, rule, problem, kind === "text" && !text.advanced ? phrasesFrom(text.words) : [])}

            {tried && problem && <p className="text-sm text-rose-300" role="alert" data-testid="add-rule-problem">{problem}</p>}
            {saveError && <p className="text-sm text-rose-300" role="alert" data-testid="add-rule-error">{saveError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5">Cancel</button>
              <button type="button" onClick={() => void save()} disabled={busy || !canWrite} data-testid="add-rule-save"
                className="flex items-center gap-1.5 rounded-lg border border-cyan-300/50 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-40">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{busy ? "Saving…" : "Save rule"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Inner Control chat: a rule drafted from the person's words ("never mention prices to customers"). Nothing is saved until they
// press Save; then it is written with the same table write as the Add forms (the account's row rules decide, and a write that changed
// nothing is said). It starts in shadow mode (watched and logged only), as the Add form does, unless the person switches that off.
import { useState } from "react";
import { CheckCircle2, Loader2, ShieldPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { NOTHING_CHANGED, SAFETY_ACTION_FIELDS, type SafetyAction } from "@/lib/inner-rule-edit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export type ChatRuleDraft =
  | { type: "action"; text: string; scope: string; effect: "always_block" | "always_require_approval" }
  | { type: "text"; name: string; phrases: string[]; pattern: string; action: SafetyAction };

/** The row the Add forms would write for this draft. */
export function draftRow(d: ChatRuleDraft, accountId: string, shadow: boolean): { table: "hard_rules" | "safety_rules"; row: Record<string, unknown> } {
  if (d.type === "action") {
    return { table: "hard_rules", row: {
      user_id: accountId, rule_text: d.text, action_type_pattern: d.scope, effect: d.effect, shadow_mode: shadow, agent_id: null,
      required_approvals: d.effect === "always_require_approval" ? 1 : null,
    } };
  }
  return { table: "safety_rules", row: { user_id: accountId, name: d.name, pattern: d.pattern, category: "custom", ...SAFETY_ACTION_FIELDS[d.action], shadow_mode: shadow, agent_id: null, api_key_id: null } };
}

export default function RuleDraftCard({ draft, line, accountId, canWrite, onSaved }: {
  draft: ChatRuleDraft; line: string; accountId: string | null | undefined; canWrite: boolean; onSaved: () => void;
}) {
  const [shadow, setShadow] = useState(true);
  const [phase, setPhase] = useState<"draft" | "saving" | "saved" | "dismissed">("draft");
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    if (!accountId || phase !== "draft") return;
    setPhase("saving"); setProblem(null);
    const { table, row } = draftRow(draft, accountId, shadow);
    const { data, error } = await anyDb.from(table).insert(row).select("id");
    if (error || !Array.isArray(data) || !data.length) {
      setProblem(error ? friendlyErrorMessage(error.message) : NOTHING_CHANGED);
      setPhase("draft");
      return;
    }
    setPhase("saved");
    onSaved();
  };

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.05] p-3 text-sm" data-testid="rule-draft-card" data-phase={phase}>
      <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-emerald-300"><ShieldPlus className="h-3.5 w-3.5" />Draft rule</div>
      <p className="text-zinc-100" data-testid="rule-draft-line">{line}</p>
      {draft.type === "text" && <p className="font-mono text-[11px] text-zinc-500">Looks for: {draft.phrases.join(" · ")}</p>}

      {phase === "saved" ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-200" data-testid="rule-draft-saved"><CheckCircle2 className="h-3.5 w-3.5" />
          {shadow ? "Saved in shadow mode: it is watched and logged, nothing is blocked yet. Make it live from your rules list." : "Saved and live: it applies from the next action."}
        </p>
      ) : phase === "dismissed" ? (
        <p className="text-xs text-zinc-500">Not saved.</p>
      ) : !canWrite ? (
        <p className="text-xs text-amber-200">Your role can not add rules on this account. Ask an owner to add it.</p>
      ) : (
        <>
          <label className="flex items-start gap-2 text-[11px] text-zinc-400">
            <input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} className="mt-0.5 accent-emerald-400" aria-label="Start in shadow mode" />
            <span>Start in shadow mode: watch and log only, so you can see what it would catch before it blocks anything.</span>
          </label>
          {problem && <p className="text-xs text-rose-300" role="alert">{problem}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} disabled={phase === "saving"} data-testid="rule-draft-save"
              className="flex items-center gap-1.5 rounded-lg border border-emerald-300/60 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/30 disabled:opacity-50">
              {phase === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save this rule
            </button>
            <button type="button" onClick={() => setPhase("dismissed")} disabled={phase === "saving"} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5">Don't save</button>
          </div>
        </>
      )}
    </div>
  );
}

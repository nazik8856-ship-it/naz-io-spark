// "Try it first": what this rule would have done to what really happened. Used in the Add window (on the rule as typed) and from
// the rules list (on a saved rule, before it is switched on or made live). Nothing is saved by trying.
import { useEffect, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/supabase-function-error";
import { actionTrialLine, replayActionRule, textTrialLine, type ActionTrial, type TextTrial, type TrialSpec } from "@/lib/rule-trial";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

/** The recorded actions an action rule is tried on: the account's most recent decisions. */
export const TRIAL_DECISIONS = 200;

type Result = { line: string; hits?: TextTrial["hits"] };

export default function RuleTrial({ spec, accountId, disabled }: { spec: TrialSpec | null; accountId: string | null | undefined; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const key = spec ? JSON.stringify(spec) : "";
  // A result belongs to the rule as it was tried: changing the rule clears it.
  useEffect(() => { setResult(null); setProblem(null); }, [key]);

  const run = async () => {
    if (!spec || !accountId || busy) return;
    setBusy(true); setProblem(null);
    try {
      if (spec.kind === "action") {
        const { data, error } = await anyDb.from("agent_decisions").select("decision, action_type, created_at")
          .eq("user_id", accountId).eq("is_test", false).order("created_at", { ascending: false }).limit(TRIAL_DECISIONS);
        if (error) throw new Error(error.message);
        const t: ActionTrial = replayActionRule(spec.pattern, (data ?? []) as { decision: string; action_type: string | null }[]);
        setResult({ line: actionTrialLine(t, spec.effect) + (spec.narrower ? " (Counted across all your AIs: this rule applies to fewer.)" : "") });
      } else {
        const { data, error } = await supabase.functions.invoke("projects", { body: { action: "try_rule", pattern: spec.pattern, account_id: accountId } });
        if (error) throw error;
        const d = data as { ok?: boolean; message?: string } & Partial<TextTrial>;
        if (!d?.ok) throw new Error(d?.message || "The rule could not be tried.");
        const t: TextTrial = { checked: d.checked ?? 0, matched: d.matched ?? 0, hits: d.hits ?? [] };
        setResult({ line: textTrialLine(t, spec.action), hits: t.hits });
      }
    } catch (e) {
      setProblem((await extractFunctionErrorMessage(e)) ?? (e as Error)?.message ?? "The rule could not be tried.");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] p-3" data-testid="rule-trial">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-300">Try it first: see what it would have done to what already happened. Nothing is saved.</p>
        <button type="button" onClick={() => void run()} disabled={disabled || busy || !spec || !accountId} data-testid="rule-trial-run"
          className="flex items-center gap-1.5 rounded-lg border border-cyan-300/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}Try it first
        </button>
      </div>
      {result && (
        <div className="mt-2 space-y-1.5" data-testid="rule-trial-result">
          <p className="text-xs font-medium text-cyan-100" data-testid="rule-trial-line">{result.line}</p>
          {result.hits?.map((h, i) => (
            <p key={i} className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-zinc-400" data-testid="rule-trial-hit">
              <span className="text-zinc-500">{h.tool}: </span>…{h.before}<mark className="rounded bg-amber-400/30 px-0.5 text-amber-100">{h.match}</mark>{h.after}…
            </p>
          ))}
        </div>
      )}
      {problem && <p className="mt-2 text-xs text-rose-300" role="alert">{problem}</p>}
    </div>
  );
}

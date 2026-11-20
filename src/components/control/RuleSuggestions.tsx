// Suggested rules from what happened (Inner Control Day 3, #173): "This happened N times this week. Make it a rule?". Make it a rule
// opens the Add window with the rule drafted (nothing is saved until it is saved there); Not now hides it for this visit.
import { Lightbulb } from "lucide-react";
import type { RuleSuggestion } from "@/lib/rule-suggestions";

export default function RuleSuggestions({ suggestions, canWrite, onMake, onDismiss }: {
  suggestions: RuleSuggestion[];
  canWrite: boolean;
  onMake: (s: RuleSuggestion) => void;
  onDismiss: (s: RuleSuggestion) => void;
}) {
  if (!suggestions.length) return null;
  return (
    <section aria-label="Suggested rules" className="space-y-2" data-testid="rule-suggestions">
      {suggestions.map((s) => (
        <div key={s.action} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/25 bg-amber-300/[0.05] p-3" data-testid="rule-suggestion">
          <Lightbulb className="h-4 w-4 shrink-0 text-amber-300" />
          <p className="min-w-0 flex-1 text-sm text-zinc-200">
            <span className="font-semibold text-amber-100">This happened {s.count} times this week.</span> {s.line}
          </p>
          <div className="flex shrink-0 gap-2">
            {canWrite && (
              <button type="button" onClick={() => onMake(s)} data-testid="suggestion-make"
                className="rounded-lg border border-cyan-300/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-50 hover:bg-cyan-500/25">
                Make it a rule
              </button>
            )}
            <button type="button" onClick={() => onDismiss(s)} data-testid="suggestion-dismiss"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5">Not now</button>
          </div>
        </div>
      ))}
    </section>
  );
}

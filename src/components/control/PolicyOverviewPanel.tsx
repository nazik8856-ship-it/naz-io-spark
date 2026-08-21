import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ScrollText, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { summarizeHardRules, type HardRuleForSummary } from "@/lib/policy-summary";
import { findRuleConflicts, type HardRuleForConflict } from "@/lib/rule-conflicts";

type Rule = HardRuleForSummary & HardRuleForConflict;

/**
 * POLICY OVERVIEW — a plain-English restatement of every live hard rule
 * ("this AI cannot...", "this AI needs your approval to..."), plus a
 * warning when two live rules overlap in scope but disagree on effect (the
 * older one silently wins that overlap — first-match-wins evaluation
 * order). Read-only: purely a review aid, no enforcement lives here.
 */
export default function PolicyOverviewPanel() {
  const { accountId } = useActiveAccount();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);

  const load = useCallback(async () => {
    if (!accountId) return;
    const { data } = await supabase
      .from("hard_rules")
      .select("id, rule_text, action_type_pattern, effect, provider, enabled, shadow_mode, created_at")
      .eq("user_id", accountId);
    setRules((data ?? []) as Rule[]);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const { blocked, needsApproval } = summarizeHardRules(rules);
  const conflicts = findRuleConflicts(rules);

  return (
    <section className="mx-6 mb-3 rounded-xl border border-white/10 bg-white/[0.03]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <ScrollText className="h-4 w-4 text-zinc-400" />
        <span className="flex-1 text-xs font-mono uppercase tracking-wider text-zinc-300">
          Policy overview{conflicts.length ? ` · ${conflicts.length} conflict(s)` : ""}
        </span>
        <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 py-4 space-y-4">
          {conflicts.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Overlapping rules with different effects
              </p>
              {conflicts.map((c, i) => (
                <p key={i} className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] px-3 py-2 text-[12px] text-zinc-300">
                  <span className="text-amber-300">"{c.winner.rule_text}"</span> (older, applies first) overlaps{" "}
                  <span className="text-amber-300">"{c.shadowed.rule_text}"</span> (newer) — they disagree on effect,
                  so the newer rule can never independently apply where they overlap.
                </p>
              ))}
            </div>
          )}

          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">Always blocked</p>
            {blocked.length === 0 ? (
              <p className="mt-1 text-[12px] text-zinc-600">Nothing is unconditionally blocked yet.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {blocked.map((s, i) => <li key={i} className="text-[12px] text-zinc-300">{s}</li>)}
              </ul>
            )}
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">Always needs your approval</p>
            {needsApproval.length === 0 ? (
              <p className="mt-1 text-[12px] text-zinc-600">Nothing requires approval by rule yet.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {needsApproval.map((s, i) => <li key={i} className="text-[12px] text-zinc-300">{s}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

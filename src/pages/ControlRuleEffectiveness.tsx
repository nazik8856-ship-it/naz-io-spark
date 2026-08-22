import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Skull } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { toast } from "@/hooks/use-toast";
import { findDeadRules, type DeadRule, type HardRuleForEffectiveness } from "@/lib/rule-effectiveness";

const WINDOW_DAYS = 30;

/**
 * RULE EFFECTIVENESS — which of your LIVE hard rules have fired zero times
 * in the last 30 days. A rule that never matches anything is either
 * redundant or, worse, was meant to catch something and silently isn't
 * working. Mirrors Coverage gaps (which finds action kinds with NO rule at
 * all) from the opposite direction: rules with no real-world impact.
 */
export default function ControlRuleEffectiveness() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId } = useActiveAccount();
  const [loading, setLoading] = useState(true);
  const [dead, setDead] = useState<DeadRule[]>([]);
  const [totalLive, setTotalLive] = useState(0);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("hard_rules")
      .select("id, rule_text, enabled, shadow_mode, created_at")
      .eq("user_id", accountId);
    if (error) {
      toast({ title: "Couldn't load rule effectiveness", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const rules = (data ?? []) as HardRuleForEffectiveness[];
    const liveRules = rules.filter((r) => r.enabled !== false && !r.shadow_mode);
    setTotalLive(liveRules.length);

    const hitCounts: Record<string, number> = {};
    await Promise.all(
      liveRules.map(async (r) => {
        const { count } = await supabase
          .from("agent_decisions")
          .select("id", { count: "exact", head: true })
          .eq("hard_rule_id", r.id)
          .gte("created_at", windowStart);
        hitCounts[r.id] = count ?? 0;
      }),
    );

    setDead(findDeadRules(rules, hitCounts, windowStart));
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  if (!user) return null;

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          aria-label="Back to Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="font-mono text-sm uppercase tracking-wider">Control System</span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Skull className="h-5 w-5 text-amber-400" /> Rule effectiveness
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Live hard rules that haven't matched a single action in the last {WINDOW_DAYS} days — either
          redundant, or quietly not working the way you expect.
        </p>

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : (
          <>
            <div className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Live rules with recent activity</div>
              <div className="mt-1 text-2xl font-semibold">
                {totalLive - dead.length} / {totalLive}
                <span className="ml-2 text-sm font-normal text-zinc-500">have fired at least once in {WINDOW_DAYS} days</span>
              </div>
            </div>

            {dead.length === 0 ? (
              <p className="mt-6 rounded border border-emerald-500/30 bg-emerald-500/[0.04] p-4 text-sm text-emerald-300">
                {totalLive === 0
                  ? "No live rules yet."
                  : `Every live rule (created before the ${WINDOW_DAYS}-day window) has fired at least once.`}
              </p>
            ) : (
              <ul className="mt-6 space-y-2">
                {dead.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/[0.04] p-3 text-sm">
                    <span className="text-zinc-200">{r.rule_text}</span>
                    <span className="ml-auto rounded border border-amber-500/40 px-2 py-0.5 font-mono text-[10px] uppercase text-amber-300">
                      0 hits in {WINDOW_DAYS}d
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Skull } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  const [deadSafety, setDeadSafety] = useState<DeadRule[]>([]);
  const [totalLiveSafety, setTotalLiveSafety] = useState(0);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const [{ data, error }, { data: safetyData, error: safetyError }] = await Promise.all([
      supabase
        .from("hard_rules")
        .select("id, rule_text, enabled, shadow_mode, created_at")
        .eq("user_id", accountId),
      supabase
        .from("safety_rules")
        .select("id, name, enabled, shadow_mode, created_at")
        .eq("user_id", accountId),
    ]);
    if (error || safetyError) {
      toast({ title: "Couldn't load rule effectiveness", description: (error ?? safetyError)!.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const rules = (data ?? []) as HardRuleForEffectiveness[];
    const liveRules = rules.filter((r) => r.enabled !== false && !r.shadow_mode);
    setTotalLive(liveRules.length);

    // Safety rules use `name` where hard rules use `rule_text` -- mapped
    // into the same shape so findDeadRules (pure, generic on that shape)
    // can be reused as-is instead of duplicated.
    const safetyRules: HardRuleForEffectiveness[] = ((safetyData ?? []) as { id: string; name: string; enabled?: boolean; shadow_mode?: boolean; created_at: string }[])
      .map((r) => ({ id: r.id, rule_text: r.name, enabled: r.enabled, shadow_mode: r.shadow_mode, created_at: r.created_at }));
    const liveSafetyRules = safetyRules.filter((r) => r.enabled !== false && !r.shadow_mode);
    setTotalLiveSafety(liveSafetyRules.length);

    const [hitCounts, safetyHitCounts] = await Promise.all([
      (async () => {
        const counts: Record<string, number> = {};
        await Promise.all(
          liveRules.map(async (r) => {
            const { count } = await supabase
              .from("agent_decisions")
              .select("id", { count: "exact", head: true })
              .eq("hard_rule_id", r.id)
              .gte("created_at", windowStart);
            counts[r.id] = count ?? 0;
          }),
        );
        return counts;
      })(),
      (async () => {
        const counts: Record<string, number> = {};
        await Promise.all(
          liveSafetyRules.map(async (r) => {
            const { count } = await supabase
              .from("safety_rule_matches")
              .select("id", { count: "exact", head: true })
              .eq("rule_id", r.id)
              .gte("created_at", windowStart);
            counts[r.id] = count ?? 0;
          }),
        );
        return counts;
      })(),
    ]);

    setDead(findDeadRules(rules, hitCounts, windowStart));
    setDeadSafety(findDeadRules(safetyRules, safetyHitCounts, windowStart));
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

            <h2 className="mt-10 flex items-center gap-2 text-lg font-semibold">
              <Skull className="h-4 w-4 text-cyan-400" /> Safety rules
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Live custom safety rules that haven't matched a single action in the last {WINDOW_DAYS} days.
            </p>

            <div className="mt-4 rounded border border-white/10 bg-white/[0.02] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Live safety rules with recent activity</div>
              <div className="mt-1 text-2xl font-semibold">
                {totalLiveSafety - deadSafety.length} / {totalLiveSafety}
                <span className="ml-2 text-sm font-normal text-zinc-500">have matched at least once in {WINDOW_DAYS} days</span>
              </div>
            </div>

            {deadSafety.length === 0 ? (
              <p className="mt-6 rounded border border-emerald-500/30 bg-emerald-500/[0.04] p-4 text-sm text-emerald-300">
                {totalLiveSafety === 0
                  ? "No live custom safety rules yet — the built-in checks aren't tracked here."
                  : `Every live safety rule (created before the ${WINDOW_DAYS}-day window) has matched at least once.`}
              </p>
            ) : (
              <ul className="mt-6 space-y-2">
                {deadSafety.map((r) => (
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

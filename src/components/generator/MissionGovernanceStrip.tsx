// Blueprint task #6: the mission-intake box is the one place a client
// actually types what they want built -- before this, nothing there ever
// said the three pillars (Generator / Inner Control / Outer Control) are
// one system. A client could generate an agent or a page with zero idea
// whether any rule governs it until they stumbled into the separate
// Control System pages afterward. This surfaces that fact right at the
// point of intake: what's already enforced, and that it applies to
// whatever gets generated next AND to any external AI the account connects.
//
// Expanded from a plain count+link (the original light-touch scope) to an
// inline expandable list of the actual rules -- a client can now see WHAT
// will govern their generation without leaving this page, closing most of
// the gap to a real unified intake flow without inventing new backend
// infrastructure: it reads the same hard_rules/safety_rules tables every
// other rules UI already reads.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;

type HardRuleRow = { id: string; rule_text: string | null; action_type_pattern: string; effect: string };
type SafetyRuleRow = { id: string; name: string; category: string; severity: string };

export default function MissionGovernanceStrip({ userId }: { userId: string | undefined }) {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<{ hard: number; safety: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [hardRules, setHardRules] = useState<HardRuleRow[]>([]);
  const [safetyRules, setSafetyRules] = useState<SafetyRuleRow[]>([]);

  useEffect(() => {
    if (!userId) { setCounts(null); return; }
    let cancelled = false;
    (async () => {
      // Account-wide only (agent_id is null) -- a rule scoped to an agent
      // that already exists doesn't govern a NEW generation request, which
      // is what this strip is about. Mirrors hard_rules' own filter, which
      // the previous count-only version already applied; safety_rules
      // hadn't been, so its count used to include irrelevant agent-scoped
      // rules.
      const [{ count: hard }, { count: safety }] = await Promise.all([
        anyDb.from("hard_rules").select("id", { count: "exact", head: true })
          .eq("user_id", userId).is("agent_id", null).eq("enabled", true),
        anyDb.from("safety_rules").select("id", { count: "exact", head: true })
          .eq("user_id", userId).is("agent_id", null).eq("enabled", true),
      ]);
      if (!cancelled) setCounts({ hard: hard ?? 0, safety: safety ?? 0 });
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !rulesLoaded && userId) {
      const [{ data: hard }, { data: safety }] = await Promise.all([
        anyDb.from("hard_rules")
          .select("id, rule_text, action_type_pattern, effect")
          .eq("user_id", userId).is("agent_id", null).eq("enabled", true)
          .order("created_at", { ascending: false }),
        anyDb.from("safety_rules")
          .select("id, name, category, severity")
          .eq("user_id", userId).is("agent_id", null).eq("enabled", true)
          .order("created_at", { ascending: false }),
      ]);
      setHardRules((hard ?? []) as HardRuleRow[]);
      setSafetyRules((safety ?? []) as SafetyRuleRow[]);
      setRulesLoaded(true);
    }
  };

  if (!userId || !counts) return null;

  const total = counts.hard + counts.safety;
  const active = total > 0;

  return (
    <div className="mt-3 max-w-xl">
      <button
        type="button"
        onClick={active ? toggle : () => navigate("/control-system")}
        title={active
          ? "These rules govern every agent and page you generate, and any external AI you connect -- click to see them"
          : "Set hard rules and safety rules so generation, your agents, and any connected external AI are all governed the same way"}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors hover:opacity-80 ${
          active
            ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-300"
        }`}
      >
        {active ? <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> : <ShieldAlert className="h-3.5 w-3.5 shrink-0" />}
        {active
          ? `Governed by ${counts.hard} hard rule${counts.hard === 1 ? "" : "s"} · ${counts.safety} safety rule${counts.safety === 1 ? "" : "s"} — applies here, to every agent, and to any connected external AI`
          : "No rules set yet — generation, agents, and connected AI run unrestricted. Set one in Control System"}
        {active && (expanded ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />)}
      </button>

      {active && expanded && (
        <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          {!rulesLoaded ? (
            <p className="text-xs text-zinc-500">Loading…</p>
          ) : (
            <div className="space-y-3">
              {hardRules.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    Hard rules ({hardRules.length})
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {hardRules.map((r) => (
                      <li key={r.id} className="flex items-start gap-1.5 text-xs text-zinc-300">
                        <span className="mt-0.5 shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-cyan-300">
                          {r.effect}
                        </span>
                        <span className="min-w-0">{r.rule_text || r.action_type_pattern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {safetyRules.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    Safety rules ({safetyRules.length})
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {safetyRules.map((r) => (
                      <li key={r.id} className="flex items-start gap-1.5 text-xs text-zinc-300">
                        <span className="mt-0.5 shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-300">
                          {r.severity.replace(/_/g, " ")}
                        </span>
                        <span className="min-w-0">{r.name} <span className="text-zinc-500">· {r.category}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => navigate("/control-system/safety-rules")}
            className="mt-3 text-[11px] font-medium text-cyan-300 hover:text-cyan-200"
          >
            Manage rules →
          </button>
        </div>
      )}
    </div>
  );
}

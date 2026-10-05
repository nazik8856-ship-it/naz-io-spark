import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bot, KeyRound, LayoutList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { selectRulesForAgent } from "@/lib/agent-policy";
import { computeTrustScore, type TrustScoreReport } from "@/lib/trust-score";

type AgentRow = {
  id: string; name: string; status: string | null;
  created_at: string; kill_switch: boolean | null; kill_switch_auto: boolean | null;
};
type ApiKeyRow = {
  id: string; name: string; created_at: string;
  revoked_at: string | null; paused_until: string | null; expires_at: string | null;
};
type RuleRow = { id: string; enabled: boolean; agent_id: string | null };

type Entity = {
  id: string;
  kind: "agent" | "api_key";
  name: string;
  status: "active" | "paused" | "killed" | "revoked" | "expired";
  createdAt: string;
  decisionsToday: number;
  rulesApplied: number;
  // GAP 4 (Trust Score + Provenance + Control Report): null only while
  // still loading -- see the second-pass load() call below.
  trustScore: TrustScoreReport | null;
};

// GAP 4: green/amber/rose thresholds loosely mirror the trust score's own
// deduction caps (a single elevated component costs at most 40 points, so
// anything still >= 80 has at most one mild issue; below 50 means multiple
// real issues or one severe one).
function trustScoreBadgeClass(score: number) {
  if (score >= 80) return "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300";
  if (score >= 50) return "border-amber-500/30 bg-amber-500/[0.06] text-amber-300";
  return "border-rose-500/30 bg-rose-500/[0.06] text-rose-300";
}

function statusBadgeClass(status: Entity["status"]) {
  if (status === "active") return "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300";
  if (status === "paused") return "border-amber-500/30 bg-amber-500/[0.06] text-amber-300";
  return "border-rose-500/30 bg-rose-500/[0.06] text-rose-300";
}

/**
 * Blueprint "10 tasks" round, items 4 + 6 combined -- item 4 is the one
 * confirmed real gap from the Generator<->Control wiring investigation:
 * Generator agents and Outer Control API keys are two separate tables (by
 * design -- see OuterControlSystem.tsx), and both already feed the same
 * decisions feed, but nowhere listed them together as "every governed
 * thing on this account." Item 6 wanted a single screen proving the whole
 * pipeline runs end-to-end -- rather than a near-duplicate second page,
 * that's the stat row above the table: decisions today broken down by
 * actual source (agent / key / chat) and today's spend, so if the wiring
 * is really connected, this is where it shows. Built from the same
 * dual-fetch pattern ControlAgentPolicy.tsx (agents) and
 * ControlApiKeys.tsx (api_keys + per-id decision counts) already use
 * separately.
 */
type DecisionsToday = { total: number; viaAgents: number; viaKeys: number; viaChat: number };

export default function ControlEntities() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId } = useActiveAccount();
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [accountWideRuleCount, setAccountWideRuleCount] = useState(0);
  const [decisionsToday, setDecisionsToday] = useState<DecisionsToday | null>(null);
  const [spendToday, setSpendToday] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const day = new Date().toISOString().slice(0, 10);

    const [{ data: agentRows }, { data: keyRows }, { data: hardRules }, { data: safetyRules }, { data: allDecisionsToday }, { data: spendRow }] = await Promise.all([
      anyDb.from("agents").select("id, name, status, created_at, kill_switch, kill_switch_auto").eq("user_id", accountId).order("created_at", { ascending: false }),
      anyDb.from("api_keys").select("id, name, created_at, revoked_at, paused_until, expires_at").eq("user_id", accountId).order("created_at", { ascending: false }),
      anyDb.from("hard_rules").select("id, enabled, agent_id").eq("user_id", accountId),
      anyDb.from("safety_rules").select("id, enabled, agent_id").eq("user_id", accountId),
      // Blueprint "10 tasks" round, item 6 -- this is the "proof the whole
      // pipeline runs" breakdown: every decision today, by where it actually
      // came from (a Generator agent, an Outer Control key, or chat).
      anyDb.from("agent_decisions").select("agent_id, api_key_id").eq("user_id", accountId).gte("created_at", todayStart.toISOString()),
      // api_key_id must be excluded too -- a per-key spend row also has
      // agent_id IS NULL (same fix as SpendCapPanel.tsx and friends).
      anyDb.from("ai_spend_daily").select("cost_usd").eq("user_id", accountId).eq("day", day).is("agent_id", null).is("api_key_id", null).maybeSingle(),
    ]);
    setSpendToday(Number((spendRow as { cost_usd?: number } | null)?.cost_usd ?? 0));
    const decRows = (allDecisionsToday ?? []) as { agent_id: string | null; api_key_id: string | null }[];
    setDecisionsToday({
      total: decRows.length,
      viaAgents: decRows.filter((r) => r.agent_id !== null).length,
      viaKeys: decRows.filter((r) => r.api_key_id !== null).length,
      viaChat: decRows.filter((r) => r.agent_id === null && r.api_key_id === null).length,
    });
    const agents = (agentRows ?? []) as AgentRow[];
    const keys = (keyRows ?? []) as ApiKeyRow[];
    const hard = (hardRules ?? []) as RuleRow[];
    const safety = (safetyRules ?? []) as RuleRow[];

    // Outer Control keys have no per-key rule override (hard_rules/
    // safety_rules only scope by agent_id) -- every key is governed by
    // exactly the account-wide rule set, so this one count applies to all of them.
    const accountWide =
      hard.filter((r) => r.agent_id === null && r.enabled !== false).length +
      safety.filter((r) => r.agent_id === null && r.enabled !== false).length;
    setAccountWideRuleCount(accountWide);

    const agentIds = agents.map((a) => a.id);
    const keyIds = keys.map((k) => k.id);
    const [{ data: agentDecisionsToday }, { data: keyDecisionsToday }] = await Promise.all([
      agentIds.length
        ? anyDb.from("agent_decisions").select("agent_id").in("agent_id", agentIds).gte("created_at", todayStart.toISOString())
        : Promise.resolve({ data: [] }),
      keyIds.length
        ? anyDb.from("agent_decisions").select("api_key_id").in("api_key_id", keyIds).gte("created_at", todayStart.toISOString())
        : Promise.resolve({ data: [] }),
    ]);
    const agentCounts: Record<string, number> = {};
    for (const r of (agentDecisionsToday ?? []) as { agent_id: string }[]) agentCounts[r.agent_id] = (agentCounts[r.agent_id] ?? 0) + 1;
    const keyCounts: Record<string, number> = {};
    for (const r of (keyDecisionsToday ?? []) as { api_key_id: string }[]) keyCounts[r.api_key_id] = (keyCounts[r.api_key_id] ?? 0) + 1;

    // GAP 4 (Trust Score + Provenance + Control Report): a real, per-entity
    // trust score composed from three independent signals already recorded
    // elsewhere -- confidence-calibration accuracy, hard/safety rule
    // trigger rate, and GAP 3's repair-engine intervention rate. Same
    // 90-day lookback automation-readiness.ts and trust-score.ts's own
    // server-side gatherTrustScoreInput already use.
    const since90 = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [{ data: calibRows }, { data: decisions90 }, { data: selfRepairEvents }, { data: modifyEvals }] = await Promise.all([
      anyDb.from("confidence_calibration").select("calibration_gap, api_key_id").eq("user_id", accountId).gte("period_end", since90),
      anyDb.from("agent_decisions").select("agent_id, api_key_id, source").eq("user_id", accountId).eq("is_test", false).gte("created_at", since90).limit(10000),
      anyDb.from("agent_events").select("agent_id").eq("user_id", accountId).eq("kind", "self_repair").gte("created_at", since90),
      anyDb.from("outer_control_evaluations").select("agent_id, api_key_id").eq("user_id", accountId).eq("verdict", "modify").gte("created_at", since90),
    ]);
    const accountWideCalibGaps = ((calibRows ?? []) as { calibration_gap: number | null; api_key_id: string | null }[])
      .filter((r) => r.api_key_id === null).map((r) => Math.abs(Number(r.calibration_gap) || 0));
    const avgAccountWideCalibGap = accountWideCalibGaps.length
      ? accountWideCalibGaps.reduce((s, g) => s + g, 0) / accountWideCalibGaps.length : null;
    const calibGapByKey = new Map<string, number[]>();
    for (const r of (calibRows ?? []) as { calibration_gap: number | null; api_key_id: string | null }[]) {
      if (!r.api_key_id) continue;
      const arr = calibGapByKey.get(r.api_key_id) ?? [];
      arr.push(Math.abs(Number(r.calibration_gap) || 0));
      calibGapByKey.set(r.api_key_id, arr);
    }
    const decRows90 = (decisions90 ?? []) as { agent_id: string | null; api_key_id: string | null; source: string | null }[];
    const ruleTriggered = (r: { source: string | null }) => r.source === "hard_rule" || r.source === "safety_scanner";
    const agentDecisionStats: Record<string, { total: number; triggered: number }> = {};
    const keyDecisionStats: Record<string, { total: number; triggered: number }> = {};
    for (const r of decRows90) {
      if (r.agent_id) {
        const s = agentDecisionStats[r.agent_id] ?? { total: 0, triggered: 0 };
        s.total++; if (ruleTriggered(r)) s.triggered++;
        agentDecisionStats[r.agent_id] = s;
      } else if (r.api_key_id) {
        const s = keyDecisionStats[r.api_key_id] ?? { total: 0, triggered: 0 };
        s.total++; if (ruleTriggered(r)) s.triggered++;
        keyDecisionStats[r.api_key_id] = s;
      }
    }
    const selfRepairByAgent: Record<string, number> = {};
    for (const r of (selfRepairEvents ?? []) as { agent_id: string | null }[]) {
      if (r.agent_id) selfRepairByAgent[r.agent_id] = (selfRepairByAgent[r.agent_id] ?? 0) + 1;
    }
    const modifyByAgent: Record<string, number> = {};
    const modifyByKey: Record<string, number> = {};
    for (const r of (modifyEvals ?? []) as { agent_id: string | null; api_key_id: string | null }[]) {
      if (r.agent_id) modifyByAgent[r.agent_id] = (modifyByAgent[r.agent_id] ?? 0) + 1;
      else if (r.api_key_id) modifyByKey[r.api_key_id] = (modifyByKey[r.api_key_id] ?? 0) + 1;
    }
    const trustScoreForAgent = (agentId: string): TrustScoreReport => {
      const stats = agentDecisionStats[agentId] ?? { total: 0, triggered: 0 };
      return computeTrustScore({
        avgCalibrationGap: avgAccountWideCalibGap,
        totalDecisions: stats.total,
        ruleTriggeredDecisions: stats.triggered,
        repairInterventions: (selfRepairByAgent[agentId] ?? 0) + (modifyByAgent[agentId] ?? 0),
      });
    };
    const trustScoreForKey = (keyId: string): TrustScoreReport => {
      const stats = keyDecisionStats[keyId] ?? { total: 0, triggered: 0 };
      const keyGaps = calibGapByKey.get(keyId) ?? [];
      return computeTrustScore({
        avgCalibrationGap: keyGaps.length ? keyGaps.reduce((s, g) => s + g, 0) / keyGaps.length : null,
        totalDecisions: stats.total,
        ruleTriggeredDecisions: stats.triggered,
        repairInterventions: modifyByKey[keyId] ?? 0,
      });
    };

    const now = Date.now();
    const agentEntities: Entity[] = agents.map((a) => ({
      id: a.id,
      kind: "agent",
      name: a.name,
      status: a.kill_switch || a.kill_switch_auto ? "killed" : (a.status === "paused" ? "paused" : "active"),
      createdAt: a.created_at,
      decisionsToday: agentCounts[a.id] ?? 0,
      rulesApplied: selectRulesForAgent(hard, a.id).filter((r) => r.enabled !== false).length
        + selectRulesForAgent(safety, a.id).filter((r) => r.enabled !== false).length,
      trustScore: trustScoreForAgent(a.id),
    }));
    const keyEntities: Entity[] = keys.map((k) => ({
      id: k.id,
      kind: "api_key",
      name: k.name,
      status: k.revoked_at ? "revoked"
        : (k.expires_at && new Date(k.expires_at).getTime() < now) ? "expired"
        : (k.paused_until && new Date(k.paused_until).getTime() > now) ? "paused"
        : "active",
      createdAt: k.created_at,
      decisionsToday: keyCounts[k.id] ?? 0,
      rulesApplied: accountWide,
      trustScore: trustScoreForKey(k.id),
    }));

    setEntities([...agentEntities, ...keyEntities].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)));
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  if (!user) return null;

  const agentCount = entities?.filter((e) => e.kind === "agent").length ?? 0;
  const keyCount = entities?.filter((e) => e.kind === "api_key").length ?? 0;

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

      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <LayoutList className="h-5 w-5 text-cyan-300" /> Governed entities
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every Generator agent and every Outer Control API key on this account, in one list — the two are
          separate things by design (an agent you built here vs. an external AI you're governing), but both
          report into the same rules and the same decision feed below. The numbers here are the proof: if the
          pipeline is actually connected end to end, decisions from all three sources show up live.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded border border-white/10 bg-white/[0.02] p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Generator agents</div>
            <div className="mt-1 text-lg font-semibold">{agentCount}</div>
          </div>
          <div className="rounded border border-white/10 bg-white/[0.02] p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Outer Control keys</div>
            <div className="mt-1 text-lg font-semibold">{keyCount}</div>
          </div>
          <div className="rounded border border-white/10 bg-white/[0.02] p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Account-wide rules</div>
            <div className="mt-1 text-lg font-semibold">{accountWideRuleCount}</div>
          </div>
          <div className="rounded border border-white/10 bg-white/[0.02] p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Spend today</div>
            <div className="mt-1 text-lg font-semibold">{spendToday === null ? "—" : `$${spendToday.toFixed(2)}`}</div>
          </div>
        </div>

        <div className="mt-3 rounded border border-white/10 bg-white/[0.02] p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Decisions today, by source</div>
          {decisionsToday === null ? (
            <div className="mt-1 text-sm text-zinc-500">Loading…</div>
          ) : decisionsToday.total === 0 ? (
            <div className="mt-1 text-sm text-zinc-500">No decisions logged yet today.</div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="text-zinc-200">{decisionsToday.total} total</span>
              <span className="flex items-center gap-1.5 text-zinc-400"><Bot className="h-3.5 w-3.5 text-cyan-400" /> {decisionsToday.viaAgents} via agents</span>
              <span className="flex items-center gap-1.5 text-zinc-400"><KeyRound className="h-3.5 w-3.5 text-violet-400" /> {decisionsToday.viaKeys} via API keys</span>
              <span className="text-zinc-400">{decisionsToday.viaChat} via chat</span>
            </div>
          )}
        </div>

        <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 font-mono">Name</th>
                <th className="px-3 py-2 font-mono">Type</th>
                <th className="px-3 py-2 font-mono">Status</th>
                <th className="px-3 py-2 font-mono">Rules applied</th>
                <th className="px-3 py-2 font-mono" title="90-day composite of confidence-calibration accuracy, hard/safety rule trigger rate, and repair-engine intervention rate.">Trust score</th>
                <th className="px-3 py-2 font-mono">Decisions today</th>
                <th className="px-3 py-2 font-mono">Created</th>
              </tr>
            </thead>
            <tbody>
              {entities === null ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">Loading…</td></tr>
              ) : entities.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  Nothing governed yet — create an agent in Generator or an API key under Outer Control to see it here.
                </td></tr>
              ) : (
                entities.map((e) => (
                  <tr
                    key={`${e.kind}:${e.id}`}
                    onClick={() => navigate(e.kind === "agent" ? `/control-system/agent-policy?agent=${e.id}` : `/control-system/api-keys`)}
                    className="cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-3 py-2 text-zinc-200">{e.name}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                        {e.kind === "agent" ? <Bot className="h-3.5 w-3.5 text-cyan-400" /> : <KeyRound className="h-3.5 w-3.5 text-violet-400" />}
                        {e.kind === "agent" ? "Generator agent" : "Outer Control key"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${statusBadgeClass(e.status)}`}>{e.status}</span>
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{e.rulesApplied}</td>
                    <td className="px-3 py-2">
                      {e.trustScore === null ? (
                        <span className="text-zinc-500">—</span>
                      ) : (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${trustScoreBadgeClass(e.trustScore.score)}`}
                          title={e.trustScore.components.map((c) => c.detail).join(" ")}
                        >
                          {e.trustScore.score}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{e.decisionsToday}</td>
                    <td className="px-3 py-2 text-zinc-500">{new Date(e.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bot, KeyRound, LayoutList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { selectRulesForAgent } from "@/lib/agent-policy";

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
};

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
                <th className="px-3 py-2 font-mono">Decisions today</th>
                <th className="px-3 py-2 font-mono">Created</th>
              </tr>
            </thead>
            <tbody>
              {entities === null ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">Loading…</td></tr>
              ) : entities.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
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

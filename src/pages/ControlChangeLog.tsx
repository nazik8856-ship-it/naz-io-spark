import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, History, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { summarizeConfigChange } from "@/lib/config-change-diff";

// rollback_config_change and the "agents"/"agent_strictness_overrides"/
// "circuit_breakers" table names aren't in the generated Supabase types yet.
const anyDb = supabase as any;

type ChangeRow = {
  id: string;
  table_name: string;
  action: "insert" | "update" | "delete";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

const TABLE_LABEL: Record<string, string> = {
  hard_rules: "Hard rule",
  safety_rules: "Safety rule",
  ai_spend_caps: "Spend cap",
  profiles: "Account setting",
  agents: "Agent",
  agent_strictness_overrides: "Agent strictness override",
  circuit_breakers: "Circuit breaker",
};

const ACTION_LABEL: Record<string, string> = { insert: "created", update: "changed", delete: "deleted" };

/**
 * SETTINGS CHANGE LOG — every AI action is already audited in
 * agent_decisions; this is the parallel record for changes to the
 * controls themselves (hard rules, safety rules, spend cap, strictness,
 * kill switch). DB-level triggers write here, so nothing can be quietly
 * skipped by an app code path.
 */
export default function ControlChangeLog() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let query = supabase
      .from("config_changes")
      .select("id, table_name, action, before, after, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter !== "all") query = query.eq("table_name", filter);
    const { data, error } = await query;
    if (error) toast({ title: "Couldn't load the change log", description: error.message, variant: "destructive" });
    setRows((data ?? []) as unknown as ChangeRow[]);
    setLoading(false);
  }, [user, filter]);

  useEffect(() => { load(); }, [load]);

  const handleRollback = async (id: string) => {
    setRollingBack(id);
    const { error } = await anyDb.rpc("rollback_config_change", { _change_id: id });
    setRollingBack(null);
    if (error) {
      toast({ title: "Couldn't roll back", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Rolled back", description: "The agent's prior configuration was restored." });
    load();
  };

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
        <nav className="ml-auto flex items-center gap-2">
          {["all", "hard_rules", "safety_rules", "ai_spend_caps", "profiles", "agents"].map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`rounded border px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider ${
                filter === t ? "border-white/40 bg-white/10 text-white" : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
              }`}
            >
              {t === "all" ? "All" : TABLE_LABEL[t]}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <History className="h-5 w-5 text-cyan-400" /> Settings change log
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every change to hard rules, safety rules, spend cap, strictness, agents, and the kill switch — who, what, when.
        </p>

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            No changes recorded yet.
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  <span className="text-cyan-300">{TABLE_LABEL[row.table_name] ?? row.table_name}</span>
                  <span>{ACTION_LABEL[row.action]}</span>
                  <span className="ml-auto">{new Date(row.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 break-words text-xs text-zinc-300">{summarizeConfigChange(row.before, row.after)}</p>
                {row.table_name === "agents" && row.action === "update" && row.before ? (
                  <button
                    onClick={() => handleRollback(row.id)}
                    disabled={rollingBack === row.id}
                    className="mt-2 flex items-center gap-1.5 rounded border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    <Undo2 className="h-3 w-3" />
                    {rollingBack === row.id ? "Rolling back…" : "Roll back to this"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

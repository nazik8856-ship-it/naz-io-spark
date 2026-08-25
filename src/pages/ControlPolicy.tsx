import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canWriteAsOwner } from "@/lib/account-switcher";
import { toast } from "@/hooks/use-toast";
import { diffPolicySnapshots, type PolicySnapshotShape } from "@/lib/policy-diff";

type PolicyVersion = {
  id: string;
  version: number;
  status: "draft" | "active" | "archived";
  notes: string | null;
  snapshot: Record<string, unknown>;
  created_at: string;
  activated_at: string | null;
};

type DiffRow = {
  id: string;
  name: string;
  expected: string;
  active: { gate_outcome: string; gate_detail: string | null; status: string };
  draft: { gate_outcome: string; gate_detail: string | null; status: string };
  change: string;
};

type Replay = {
  safe_to_activate: boolean;
  active_version: { version: number | null };
  draft_version: { version: number };
  summary: { total: number; active_pass: number; draft_pass: number; regressions: number; improvements: number; changed: number };
  regressions: DiffRow[];
  results: DiffRow[];
};

type RealTrafficChangedRow = {
  id: string;
  action_type: string;
  provider: string;
  description: string;
  active: { gate_outcome: string; gate_detail: string | null };
  draft: { gate_outcome: string; gate_detail: string | null };
  diff: "regression" | "improvement";
};

type RealTrafficReplay = {
  active_version: { version: number | null };
  draft_version: { version: number };
  summary: { total: number; same: number; regressions: number; improvements: number };
  changed: RealTrafficChangedRow[];
};

/**
 * POLICY VERSIONS — every decision is judged by an exact policy snapshot.
 * Drafts must pass a scenario replay before they can be activated: a draft
 * that regresses any scenario the active policy passes is refused.
 */
export default function ControlPolicy() {
  const navigate = useNavigate();
  const { accountId, role } = useActiveAccount();
  const canWrite = canWriteAsOwner(role);
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [openSnapshot, setOpenSnapshot] = useState<string | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayFor, setReplayFor] = useState<string | null>(null);
  const [realReplay, setRealReplay] = useState<RealTrafficReplay | null>(null);
  const [realReplayFor, setRealReplayFor] = useState<string | null>(null);
  const [realReplayBusy, setRealReplayBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const { data } = await supabase
      .from("policy_versions")
      .select("id, version, status, notes, snapshot, created_at, activated_at")
      .eq("user_id", accountId)
      .order("version", { ascending: false });
    setVersions((data ?? []) as unknown as PolicyVersion[]);
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const call = async (path: string, payload: Record<string, unknown> = {}) => {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/control-engine${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${sess?.session?.access_token ?? SUPABASE_ANON}`,
      },
      // account_id lets control-engine act on the account being VIEWED,
      // not just the caller's own -- verified server-side via
      // is_account_member, same as api-keys/index.ts's create/revoke.
      body: JSON.stringify({ ...payload, account_id: accountId }),
    });
    return { ok: res.ok, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  };

  const runReplay = async (v: PolicyVersion) => {
    setBusy(v.id);
    setReplayFor(v.id);
    const { ok, body } = await call("/replay", { policy_version_id: v.id });
    setBusy(null);
    if (!ok) {
      setReplay(null);
      toast({ title: "Replay failed", description: String(body.error ?? "Unknown error"), variant: "destructive" });
      return;
    }
    setReplay(body as unknown as Replay);
  };

  const runRealTrafficReplay = async (v: PolicyVersion) => {
    setRealReplayBusy(v.id);
    setRealReplayFor(v.id);
    const { ok, body } = await call("/replay-real", { policy_version_id: v.id });
    setRealReplayBusy(null);
    if (!ok) {
      setRealReplay(null);
      toast({ title: "Real-traffic replay failed", description: String(body.error ?? "Unknown error"), variant: "destructive" });
      return;
    }
    setRealReplay(body as unknown as RealTrafficReplay);
  };

  const activate = async (v: PolicyVersion) => {
    if (!canWrite) return;
    setBusy(v.id);
    const { ok, body } = await call(`/policy/${v.id}/activate`);
    setBusy(null);
    if (!ok) {
      if (body.replay) { setReplay(body.replay as unknown as Replay); setReplayFor(v.id); }
      toast({ title: "Activation blocked", description: String(body.error ?? "Unknown error"), variant: "destructive" });
      return;
    }
    toast({ title: `Policy v${v.version} is now active` });
    await load();
  };

  const rollback = async () => {
    if (!canWrite) return;
    const active = versions.find((v) => v.status === "active");
    const previous = versions.find((v) => v.status === "archived");
    if (!previous) {
      toast({ title: "Nothing to roll back to", description: "There is no earlier policy version.", variant: "destructive" });
      return;
    }
    setBusy(previous.id);
    if (active) {
      await supabase.from("policy_versions").update({ status: "archived" }).eq("id", active.id).eq("user_id", accountId);
    }
    const { error } = await supabase
      .from("policy_versions")
      .update({ status: "active", activated_at: new Date().toISOString() })
      .eq("id", previous.id)
      .eq("user_id", accountId);
    setBusy(null);
    if (error) {
      toast({ title: "Rollback failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Rolled back to policy v${previous.version}` });
    await load();
  };

  const snapshotOf = versions.find((v) => v.id === openSnapshot);

  const [diffFor, setDiffFor] = useState<string | null>(null);
  const activeVersion = versions.find((v) => v.status === "active");
  const diffOf = versions.find((v) => v.id === diffFor);
  const diff = diffOf && activeVersion
    ? diffPolicySnapshots(activeVersion.snapshot as PolicySnapshotShape, diffOf.snapshot as PolicySnapshotShape)
    : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <button
          onClick={() => navigate("/control-system")}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Control System
        </button>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Policy versions</h1>
            <p className="text-sm text-zinc-400">
              Each decision is judged by one pinned snapshot of your hard rules, safety rules, thresholds and spend cap.
              A draft can only go live if it doesn't regress any scenario the active policy passes.
            </p>
          </div>
          {canWrite && (
            <button
              onClick={rollback}
              disabled={busy !== null}
              className="rounded border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              Rollback to previous
            </button>
          )}
        </div>

        <table className="w-full text-sm border border-white/10">
          <thead className="bg-white/5 text-left text-zinc-400">
            <tr>
              <th className="p-2">Version</th>
              <th className="p-2">Status</th>
              <th className="p-2">Notes</th>
              <th className="p-2">Created</th>
              <th className="p-2">Activated</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className="border-t border-white/10 align-top">
                <td className="p-2">v{v.version}</td>
                <td className="p-2">{v.status}</td>
                <td className="p-2 text-zinc-400">{v.notes ?? "—"}</td>
                <td className="p-2 text-zinc-400">{new Date(v.created_at).toLocaleString()}</td>
                <td className="p-2 text-zinc-400">{v.activated_at ? new Date(v.activated_at).toLocaleString() : "—"}</td>
                <td className="p-2 space-x-2 whitespace-nowrap">
                  <button
                    onClick={() => setOpenSnapshot(openSnapshot === v.id ? null : v.id)}
                    className="rounded border border-white/15 px-2 py-1 hover:bg-white/10"
                  >
                    {openSnapshot === v.id ? "Hide snapshot" : "View snapshot"}
                  </button>
                  <button
                    onClick={() => runReplay(v)}
                    disabled={busy === v.id}
                    className="rounded border border-white/15 px-2 py-1 hover:bg-white/10 disabled:opacity-50"
                  >
                    {busy === v.id ? "Running…" : "Run replay"}
                  </button>
                  <button
                    onClick={() => runRealTrafficReplay(v)}
                    disabled={realReplayBusy === v.id}
                    className="rounded border border-cyan-500/30 px-2 py-1 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
                  >
                    {realReplayBusy === v.id ? "Running…" : "Replay against real traffic"}
                  </button>
                  {activeVersion && v.id !== activeVersion.id && (
                    <button
                      onClick={() => setDiffFor(diffFor === v.id ? null : v.id)}
                      className="rounded border border-cyan-500/30 px-2 py-1 text-cyan-300 hover:bg-cyan-500/10"
                    >
                      {diffFor === v.id ? "Hide diff" : "Diff vs active"}
                    </button>
                  )}
                  {v.status !== "active" && canWrite && (
                    <button
                      onClick={() => activate(v)}
                      disabled={busy === v.id}
                      className="rounded border border-white/15 px-2 py-1 hover:bg-white/10 disabled:opacity-50"
                    >
                      Activate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!versions.length && (
              <tr><td className="p-3 text-zinc-500" colSpan={6}>No policy versions yet.</td></tr>
            )}
          </tbody>
        </table>

        {snapshotOf && (
          <div>
            <h2 className="text-sm font-semibold mb-1">Snapshot — v{snapshotOf.version}</h2>
            <pre className="max-h-96 overflow-auto border border-white/10 bg-black/40 p-3 text-xs">
{JSON.stringify(snapshotOf.snapshot ?? {}, null, 2)}
            </pre>
          </div>
        )}

        {diff && activeVersion && diffOf && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">
              Diff — active v{activeVersion.version} → v{diffOf.version}
              {!diff.hasChanges && <span className="ml-2 text-zinc-500">(no differences)</span>}
            </h2>

            {(["hardRules", "safetyRules"] as const).map((section) => {
              const d = diff[section];
              const label = section === "hardRules" ? "Hard rules" : "Safety rules";
              if (d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0) return null;
              return (
                <div key={section} className="rounded border border-white/10 bg-black/20 p-3 text-xs">
                  <div className="mb-1 font-mono uppercase tracking-wider text-zinc-500">{label}</div>
                  {d.added.map((r) => (
                    <div key={`add-${r.id}`} className="text-emerald-300">+ {("rule_text" in r ? r.rule_text : r.name)}</div>
                  ))}
                  {d.removed.map((r) => (
                    <div key={`rm-${r.id}`} className="text-rose-300">− {("rule_text" in r ? r.rule_text : r.name)}</div>
                  ))}
                  {d.changed.map((c) => (
                    <div key={`ch-${c.id}`} className="text-amber-300">
                      ~ {("rule_text" in c.after ? c.after.rule_text : c.after.name)} (changed)
                    </div>
                  ))}
                </div>
              );
            })}

            {diff.thresholds.added.length + diff.thresholds.removed.length + diff.thresholds.changed.length > 0 && (
              <div className="rounded border border-white/10 bg-black/20 p-3 text-xs">
                <div className="mb-1 font-mono uppercase tracking-wider text-zinc-500">Agent thresholds</div>
                {diff.thresholds.added.map((t) => <div key={`add-${t.agent_id}`} className="text-emerald-300">+ {t.slug ?? t.agent_id}</div>)}
                {diff.thresholds.removed.map((t) => <div key={`rm-${t.agent_id}`} className="text-rose-300">− {t.slug ?? t.agent_id}</div>)}
                {diff.thresholds.changed.map((c) => <div key={`ch-${c.id}`} className="text-amber-300">~ {c.after.slug ?? c.id} (changed)</div>)}
              </div>
            )}

            {diff.spendCapChanged && (
              <div className="rounded border border-white/10 bg-black/20 p-3 text-xs">
                <div className="mb-1 font-mono uppercase tracking-wider text-zinc-500">Spend cap</div>
                <div className="text-amber-300">
                  ${diff.spendCapBefore?.daily_cap_usd ?? "—"} → ${diff.spendCapAfter?.daily_cap_usd ?? "—"}
                  {" · "}
                  {diff.spendCapBefore?.enabled ? "on" : "off"} → {diff.spendCapAfter?.enabled ? "on" : "off"}
                </div>
              </div>
            )}
          </div>
        )}

        {replay && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">
              Replay — draft v{replay.draft_version.version} vs active{" "}
              {replay.active_version.version ? `v${replay.active_version.version}` : "(none)"}
              {replayFor && versions.find((v) => v.id === replayFor) ? "" : ""}
            </h2>
            <p className="text-sm text-zinc-400">
              {replay.summary.total} scenarios · active passes {replay.summary.active_pass}, draft passes{" "}
              {replay.summary.draft_pass} · {replay.summary.regressions} regressions,{" "}
              {replay.summary.improvements} improvements, {replay.summary.changed} changed ·{" "}
              {replay.safe_to_activate ? "safe to activate" : "activation blocked"}
            </p>
            <table className="w-full text-xs border border-white/10">
              <thead className="bg-white/5 text-left text-zinc-400">
                <tr>
                  <th className="p-2">ID</th>
                  <th className="p-2">Scenario</th>
                  <th className="p-2">Expected</th>
                  <th className="p-2">Active</th>
                  <th className="p-2">Draft</th>
                  <th className="p-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {replay.results.map((r) => (
                  <tr key={r.id} className="border-t border-white/10">
                    <td className="p-2">{r.id}</td>
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.expected}</td>
                    <td className="p-2">{r.active.gate_outcome}</td>
                    <td className="p-2">{r.draft.gate_outcome}</td>
                    <td className="p-2">{r.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {realReplay && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">
              Real-traffic replay — draft v{realReplay.draft_version.version} vs active{" "}
              {realReplay.active_version.version ? `v${realReplay.active_version.version}` : "(none)"}
            </h2>
            <p className="text-sm text-zinc-400">
              {realReplay.summary.total} real decision(s) replayed · {realReplay.summary.same} unchanged ·{" "}
              {realReplay.summary.regressions} regression(s), {realReplay.summary.improvements} improvement(s).
              Only decisions with a captured action payload are replayable — plain historical allows aren't included.
            </p>
            {realReplay.changed.length === 0 ? (
              <p className="rounded border border-emerald-500/30 bg-emerald-500/[0.04] p-3 text-xs text-emerald-300">
                No real decisions in this sample would have gone differently under the draft policy.
              </p>
            ) : (
              <table className="w-full text-xs border border-white/10">
                <thead className="bg-white/5 text-left text-zinc-400">
                  <tr>
                    <th className="p-2">Action</th>
                    <th className="p-2">Description</th>
                    <th className="p-2">Active</th>
                    <th className="p-2">Draft</th>
                    <th className="p-2">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {realReplay.changed.map((r) => (
                    <tr key={r.id} className="border-t border-white/10 align-top">
                      <td className="p-2 font-mono">{r.action_type} · {r.provider}</td>
                      <td className="p-2 text-zinc-400">{r.description}</td>
                      <td className="p-2">{r.active.gate_outcome}</td>
                      <td className="p-2">{r.draft.gate_outcome}</td>
                      <td className={`p-2 ${r.diff === "regression" ? "text-rose-300" : "text-emerald-300"}`}>{r.diff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

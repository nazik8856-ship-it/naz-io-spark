import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

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

/**
 * POLICY VERSIONS — every decision is judged by an exact policy snapshot.
 * Drafts must pass a scenario replay before they can be activated: a draft
 * that regresses any scenario the active policy passes is refused.
 */
export default function ControlPolicy() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [openSnapshot, setOpenSnapshot] = useState<string | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayFor, setReplayFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("policy_versions")
      .select("id, version, status, notes, snapshot, created_at, activated_at")
      .eq("user_id", user.id)
      .order("version", { ascending: false });
    setVersions((data ?? []) as unknown as PolicyVersion[]);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const call = async (path: string) => {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/control-engine${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${sess?.session?.access_token ?? SUPABASE_ANON}`,
      },
      body: "{}",
    });
    return { ok: res.ok, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  };

  const runReplay = async (v: PolicyVersion) => {
    setBusy(v.id);
    setReplayFor(v.id);
    const { ok, body } = await call(`/replay?policy_version_id=${v.id}`);
    setBusy(null);
    if (!ok) {
      setReplay(null);
      toast({ title: "Replay failed", description: String(body.error ?? "Unknown error"), variant: "destructive" });
      return;
    }
    setReplay(body as unknown as Replay);
  };

  const activate = async (v: PolicyVersion) => {
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
    const active = versions.find((v) => v.status === "active");
    const previous = versions.find((v) => v.status === "archived");
    if (!previous) {
      toast({ title: "Nothing to roll back to", description: "There is no earlier policy version.", variant: "destructive" });
      return;
    }
    setBusy(previous.id);
    if (active) {
      await supabase.from("policy_versions").update({ status: "archived" }).eq("id", active.id);
    }
    const { error } = await supabase
      .from("policy_versions")
      .update({ status: "active", activated_at: new Date().toISOString() })
      .eq("id", previous.id);
    setBusy(null);
    if (error) {
      toast({ title: "Rollback failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Rolled back to policy v${previous.version}` });
    await load();
  };

  const snapshotOf = versions.find((v) => v.id === openSnapshot);

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
          <button
            onClick={rollback}
            disabled={busy !== null}
            className="rounded border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            Rollback to previous
          </button>
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
                  {v.status !== "active" && (
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
      </div>
    </div>
  );
}

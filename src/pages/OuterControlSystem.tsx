import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Globe2, ShieldCheck, Gauge, ArrowUpRight, KeyRound } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { supabase } from "@/integrations/supabase/client";
// outer_control_evaluations isn't in the generated Supabase types yet --
// same established workaround as every other page touching a table this
// sandbox can't regenerate types for.
const anyDb = supabase as any;

type Verdict = "allow" | "modify" | "block" | "escalate";

type EvaluationRow = {
  id: string;
  source_model: string;
  verdict: Verdict;
  trust_score: number;
  summary: string | null;
  created_at: string;
};

const VERDICT_STYLE: Record<Verdict, { label: string; dot: string; text: string; border: string; bg: string }> = {
  allow: { label: "Allow", dot: "bg-emerald-400", text: "text-emerald-300", border: "border-emerald-500/40", bg: "bg-emerald-500/10" },
  modify: { label: "Modify", dot: "bg-cyan-400", text: "text-cyan-300", border: "border-cyan-500/40", bg: "bg-cyan-500/10" },
  escalate: { label: "Escalate", dot: "bg-amber-400", text: "text-amber-300", border: "border-amber-500/40", bg: "bg-amber-500/10" },
  block: { label: "Block", dot: "bg-rose-400", text: "text-rose-300", border: "border-rose-500/40", bg: "bg-rose-500/10" },
};

const HEX_CLIP = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * OUTER CONTROL SYSTEM — the layer that governs a response from an
 * EXTERNAL AI (ChatGPT, Claude, a connected CRM bot, etc.), as distinct
 * from the Inner Control System page this links back to, which governs
 * NazAI's own generated agents. Deliberately built with its own visual
 * language (glass panels, a verdict-health honeycomb) rather than reusing
 * Inner Control's terminal/mono styling, so the two are easy to tell apart
 * at a glance while the toggle in either header jumps straight to the
 * other.
 */
export default function OuterControlSystem() {
  const navigate = useNavigate();
  const { accountId } = useActiveAccount();
  const [loading, setLoading] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [rows, setRows] = useState<EvaluationRow[]>([]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [keysRes, evalRes] = await Promise.all([
        anyDb
          .from("api_keys")
          .select("id", { count: "exact", head: true })
          .eq("user_id", accountId)
          .is("revoked_at", null)
          .contains("scopes", ["control:verdict"]),
        anyDb
          .from("outer_control_evaluations")
          .select("id, source_model, verdict, trust_score, summary, created_at")
          .eq("user_id", accountId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      setHasApiKey((keysRes.count ?? 0) > 0);
      setRows((evalRes.data ?? []) as EvaluationRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  const stats = useMemo(() => {
    const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = rows.filter((r) => new Date(r.created_at).getTime() >= since7d);
    const total = recent.length;
    const avgTrust = total ? Math.round(recent.reduce((s, r) => s + r.trust_score, 0) / total) : null;
    const nonAllow = recent.filter((r) => r.verdict !== "allow").length;
    return { total, avgTrust, nonAllow };
  }, [rows]);

  // Setup progress: two genuinely measurable milestones, not a decorative
  // number -- 0% until a usable key exists, 50% once one does but nothing
  // has been evaluated yet, 100% once real traffic has actually flowed
  // through the endpoint.
  const setupPercent = !hasApiKey ? 0 : rows.length === 0 ? 50 : 100;
  const setupLabel = !hasApiKey
    ? "Create a full-access API key to connect your first external AI tool"
    : rows.length === 0
      ? "Key ready — call POST /outer-control/evaluate to see your first verdict here"
      : "Outer Control is actively governing your connected external AI output";

  // Honeycomb: up to 24 of the most recent evaluations, newest first,
  // each cell colored by its own verdict -- a real, if small, live map of
  // recent traffic rather than a purely decorative graphic. Unfilled
  // cells (no data yet) render as a dim, unlit hex.
  const hexCells = useMemo(() => {
    const cells: (Verdict | null)[] = rows.slice(0, 24).map((r) => r.verdict);
    while (cells.length < 24) cells.push(null);
    return cells;
  }, [rows]);

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#050810" }}>
      <header className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-mono uppercase tracking-wider">Back</span>
        </button>

        <div className="ml-2 flex items-center rounded-full border border-white/10 bg-white/5 p-1 text-[11px] font-mono uppercase tracking-wider">
          <button
            onClick={() => navigate("/control-system")}
            className="rounded-full px-3 py-1 text-zinc-400 hover:text-white transition-colors"
          >
            Inner
          </button>
          <button
            className="rounded-full px-3 py-1 text-white"
            style={{ background: "linear-gradient(135deg, rgba(56,189,248,0.35), rgba(52,211,153,0.35))" }}
          >
            Outer
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          <Globe2 className="h-4 w-4 text-cyan-300" />
          <span className="font-mono uppercase tracking-wider">Governs external AI output</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        {/* Setup progress */}
        <div className="hud-glass rounded-2xl px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Setup progress</div>
              <div className="mt-1 text-sm text-zinc-200">{setupLabel}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-semibold text-gradient">{setupPercent}%</span>
              {!hasApiKey && (
                <button
                  onClick={() => navigate("/control-system/api-keys")}
                  className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Create API key
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${setupPercent}%`,
                background: "linear-gradient(90deg, #34d399, #22d3ee)",
              }}
            />
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="hud-glass rounded-2xl px-5 py-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Evaluations (7d)</div>
            <div className="mt-1 text-3xl font-semibold">{stats.total}</div>
            <div className="mt-1 text-xs text-zinc-500">External AI responses checked against your criteria</div>
          </div>
          <div className="hud-glass rounded-2xl px-5 py-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Avg trust score</div>
            <div className="mt-1 text-3xl font-semibold">{stats.avgTrust ?? "—"}</div>
            <div className="mt-1 text-xs text-zinc-500">100 minus a cost per rule match, floored at 0</div>
          </div>
          <div className="hud-glass rounded-2xl px-5 py-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Non-allow rate</div>
            <div className="mt-1 text-3xl font-semibold">
              {stats.total ? `${Math.round((stats.nonAllow / stats.total) * 100)}%` : "—"}
            </div>
            <div className="mt-1 text-xs text-zinc-500">Modified, escalated, or blocked in the last 7 days</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Verdict health honeycomb */}
          <div className="hud-glass rounded-2xl px-6 py-6 lg:col-span-3">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" />
              Verdict health — most recent evaluations
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {hexCells.map((v, i) => {
                const style = v ? VERDICT_STYLE[v] : null;
                return (
                  <div
                    key={i}
                    title={v ? VERDICT_STYLE[v].label : "No data yet"}
                    className={`h-9 w-9 shrink-0 ${style ? style.bg : "bg-white/[0.03]"}`}
                    style={{
                      clipPath: HEX_CLIP,
                      border: `1px solid ${style ? "currentColor" : "rgba(255,255,255,0.08)"}`,
                      color: style
                        ? style.dot.includes("emerald") ? "#34d399"
                          : style.dot.includes("cyan") ? "#22d3ee"
                            : style.dot.includes("amber") ? "#fbbf24"
                              : "#fb7185"
                        : undefined,
                    }}
                  />
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap gap-4 text-[11px] font-mono uppercase tracking-wider">
              {(Object.keys(VERDICT_STYLE) as Verdict[]).map((v) => (
                <div key={v} className="flex items-center gap-1.5 text-zinc-400">
                  <span className={`h-2 w-2 rounded-full ${VERDICT_STYLE[v].dot}`} />
                  {VERDICT_STYLE[v].label}
                </div>
              ))}
            </div>
          </div>

          {/* Recent evaluations feed */}
          <div className="hud-glass rounded-2xl px-5 py-5 lg:col-span-2 flex flex-col min-h-[22rem]">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              <Gauge className="h-3.5 w-3.5 text-cyan-300" />
              Recent external AI evaluations
            </div>
            <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
              {loading && <div className="text-sm text-zinc-500">Loading…</div>}
              {!loading && rows.length === 0 && (
                <div className="text-sm text-zinc-500">
                  Nothing evaluated yet. Once a connected external AI tool calls{" "}
                  <code className="text-cyan-300">POST /outer-control/evaluate</code>, its verdicts will show up here.
                </div>
              )}
              {rows.slice(0, 12).map((r) => {
                const style = VERDICT_STYLE[r.verdict];
                return (
                  <div key={r.id} className={`rounded-xl border ${style.border} ${style.bg} px-3 py-2.5`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-200 truncate">{r.source_model}</span>
                      <span className={`shrink-0 rounded-full border ${style.border} px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${style.text}`}>
                        {style.label}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
                      <span>Trust {r.trust_score}</span>
                      <span>{timeAgo(r.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => navigate("/control-system/api-docs")}
              className="mt-4 flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
            >
              View API docs
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

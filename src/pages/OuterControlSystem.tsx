import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Globe2, ShieldCheck, Gauge, ArrowUpRight, KeyRound, Lock, Plug, ScanEye } from "lucide-react";
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

// Status colors, reserved for verdict meaning only (never reused as a
// generic categorical series elsewhere on this page) -- each is always
// paired with a text label, never color alone, per every badge and the
// legend below.
const VERDICT_STYLE: Record<Verdict, { label: string; hex: string; text: string; border: string; bg: string }> = {
  allow: { label: "Allow", hex: "#34d399", text: "text-emerald-300", border: "border-emerald-500/40", bg: "bg-emerald-500/10" },
  modify: { label: "Modify", hex: "#22d3ee", text: "text-cyan-300", border: "border-cyan-500/40", bg: "bg-cyan-500/10" },
  escalate: { label: "Escalate", hex: "#fbbf24", text: "text-amber-300", border: "border-amber-500/40", bg: "bg-amber-500/10" },
  block: { label: "Block", hex: "#fb7185", text: "text-rose-300", border: "border-rose-500/40", bg: "bg-rose-500/10" },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ---- Verdict network: a fixed, organic node layout computed once (a
// seeded pseudo-random scatter, not Math.random, so it's stable across
// renders/reloads) with each node wired to its two nearest neighbors --
// this is a status overview, not an analytical chart, so the connecting
// lines are pure structure (neutral, never carrying data) and every node's
// color IS its verdict, always paired with a hover title (never color
// alone). Reused for however many of the most recent evaluations exist;
// empty slots render as small unlit dots. ------------------------------
const NETWORK_NODE_COUNT = 20;
const NETWORK_VIEWBOX = { w: 400, h: 190 };

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 999.7) * 10000;
  return x - Math.floor(x);
}

const NETWORK_LAYOUT: { x: number; y: number }[] = Array.from({ length: NETWORK_NODE_COUNT }, (_, i) => ({
  x: 24 + seededRandom(i * 2 + 1) * (NETWORK_VIEWBOX.w - 48),
  y: 22 + seededRandom(i * 2 + 2) * (NETWORK_VIEWBOX.h - 44),
}));

function nearestNeighborEdges(points: { x: number; y: number }[], k: number): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  points.forEach((p, i) => {
    const nearest = points
      .map((q, j) => ({ j, d: (q.x - p.x) ** 2 + (q.y - p.y) ** 2 }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const { j } of nearest) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([i, j]);
      }
    }
  });
  return edges;
}

const NETWORK_EDGES = nearestNeighborEdges(NETWORK_LAYOUT, 2);

function VerdictNetwork({ verdicts }: { verdicts: (Verdict | null)[] }) {
  return (
    <svg viewBox={`0 0 ${NETWORK_VIEWBOX.w} ${NETWORK_VIEWBOX.h}`} className="w-full h-auto" role="img" aria-label="Verdict health network">
      <g stroke="rgba(255,255,255,0.08)" strokeWidth="1">
        {NETWORK_EDGES.map(([a, b], i) => (
          <line key={i} x1={NETWORK_LAYOUT[a].x} y1={NETWORK_LAYOUT[a].y} x2={NETWORK_LAYOUT[b].x} y2={NETWORK_LAYOUT[b].y} />
        ))}
      </g>
      {NETWORK_LAYOUT.map((p, i) => {
        const v = verdicts[i];
        const hex = v ? VERDICT_STYLE[v].hex : "rgba(255,255,255,0.18)";
        return (
          <g key={i}>
            {v && <circle cx={p.x} cy={p.y} r={11} fill={hex} opacity={0.18} />}
            <circle cx={p.x} cy={p.y} r={v ? 5 : 2.5} fill={hex}>
              <title>{v ? VERDICT_STYLE[v].label : "No data yet"}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

// ---- Stat-tile sparklines: 7 daily buckets, a thin 2px de-emphasis line
// (never the accent) with only the CURRENT (most recent) point picked out
// in the tile's own accent -- no axis, no gridlines, no per-point labels,
// per the stat-tile trend spec. -----------------------------------------
function Sparkline({ values, accent }: { values: (number | null)[]; accent: string }) {
  const w = 96;
  const h = 28;
  const nums = values.map((v) => v ?? 0);
  const max = Math.max(1, ...nums);
  const points = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * w;
    const y = h - 2 - (v / max) * (h - 6);
    return { x, y };
  });
  const last = points[points.length - 1];
  return (
    <svg width={w} height={h} className="overflow-visible" role="img" aria-label="7-day trend">
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="rgba(161,161,170,0.45)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r="3" fill={accent} />
    </svg>
  );
}

function Header({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
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
  );
}

/**
 * Shown until this account has a real, usable API key -- Outer Control has
 * nothing to govern without one (there's no in-app chat surface like Inner
 * Control's; every real call comes in through the API, whether that's from
 * NazAI's own internal use of a connected tool or an external platform
 * calling directly), so the live dashboard stays behind this setup step
 * rather than showing a mostly-empty shell with a small CTA buried in it.
 */
function SetupRequired({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="hud-glass rounded-2xl px-8 py-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10">
          <Lock className="h-6 w-6 text-cyan-300" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-gradient">Set up API access to unlock Outer Control</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Outer Control governs responses from external AI tools — it has nothing to show until an API key exists for
          this account. Create one below, then this page turns into a live dashboard.
        </p>

        <div className="mt-8 space-y-4 text-left">
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs font-mono text-zinc-300">1</div>
            <div>
              <div className="text-sm font-medium text-zinc-200">Create a full-access API key</div>
              <div className="text-xs text-zinc-500">Same keys Inner Control's public API already uses — no separate system to set up.</div>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs font-mono text-zinc-300">2</div>
            <div>
              <div className="text-sm font-medium text-zinc-200 flex items-center gap-1.5"><Plug className="h-3.5 w-3.5 text-cyan-300" /> Paste it wherever your external AI actually lives</div>
              <div className="text-xs text-zinc-500">A custom GPT action, a CRM's webhook step, a support bot's post-processing hook — or call it directly from your own backend.</div>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs font-mono text-zinc-300">3</div>
            <div>
              <div className="text-sm font-medium text-zinc-200 flex items-center gap-1.5"><ScanEye className="h-3.5 w-3.5 text-cyan-300" /> Watch verdicts land here</div>
              <div className="text-xs text-zinc-500">Every call is scored, logged, and shown on this dashboard in real time.</div>
            </div>
          </div>
        </div>

        <button
          onClick={() => navigate("/control-system/api-keys?for=outer-control")}
          className="mt-8 inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-5 py-2.5 text-xs font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
        >
          <KeyRound className="h-4 w-4" />
          Create your API key
        </button>
      </div>
    </div>
  );
}

/**
 * OUTER CONTROL SYSTEM — the layer that governs a response from an
 * EXTERNAL AI (ChatGPT, Claude, a connected CRM bot, etc.), as distinct
 * from the Inner Control System page this links back to, which governs
 * NazAI's own generated agents. Its own visual language (the circuit-bg
 * texture, glass panels, a verdict-health node network) rather than
 * reusing Inner Control's terminal/mono styling, so the two are easy to
 * tell apart at a glance while the toggle in either header jumps straight
 * to the other. Gated behind having a real API key (see SetupRequired
 * above) -- only the header and toggle are always reachable.
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

  // 7 daily buckets, oldest to newest, feeding each stat tile's own
  // sparkline -- real day-over-day shape, not a decorative squiggle.
  const dailyBuckets = useMemo(() => {
    const days = Array.from({ length: 7 }, () => ({ count: 0, trustSum: 0, nonAllow: 0 }));
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    for (const r of rows) {
      const age = now - new Date(r.created_at).getTime();
      const dayIndex = 6 - Math.floor(age / dayMs);
      if (dayIndex < 0 || dayIndex > 6) continue;
      days[dayIndex].count += 1;
      days[dayIndex].trustSum += r.trust_score;
      if (r.verdict !== "allow") days[dayIndex].nonAllow += 1;
    }
    return {
      counts: days.map((d) => d.count),
      avgTrusts: days.map((d) => (d.count ? Math.round(d.trustSum / d.count) : null)),
      nonAllowPcts: days.map((d) => (d.count ? Math.round((d.nonAllow / d.count) * 100) : null)),
    };
  }, [rows]);

  // Once a key exists, the only remaining milestone is real traffic --
  // 50% "ready, nothing's called it yet" vs 100% "actively governing."
  const setupPercent = rows.length === 0 ? 50 : 100;
  const setupLabel = rows.length === 0
    ? "Key ready — call POST /outer-control/evaluate to see your first verdict here"
    : "Outer Control is actively governing your connected external AI output";

  const networkVerdicts = useMemo(() => {
    const cells: (Verdict | null)[] = rows.slice(0, NETWORK_NODE_COUNT).map((r) => r.verdict);
    while (cells.length < NETWORK_NODE_COUNT) cells.push(null);
    return cells;
  }, [rows]);

  return (
    <div className="circuit-bg min-h-screen w-full text-white">
      <Header navigate={navigate} />

      {loading && (
        <div className="mx-auto max-w-6xl px-6 py-16 text-center text-sm text-zinc-500">Loading…</div>
      )}

      {!loading && !hasApiKey && <SetupRequired navigate={navigate} />}

      {!loading && hasApiKey && (
        <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
          {/* Setup progress */}
          <div className="hud-glass rounded-2xl px-6 py-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Setup progress</div>
                <div className="mt-1 text-sm text-zinc-200">{setupLabel}</div>
              </div>
              <span className="text-2xl font-semibold text-gradient">{setupPercent}%</span>
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

          {/* Stat tiles, each with a real 7-day sparkline */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="hud-glass rounded-2xl px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Evaluations (7d)</div>
                  <div className="mt-1 text-3xl font-semibold">{stats.total}</div>
                </div>
                <Sparkline values={dailyBuckets.counts} accent="#22d3ee" />
              </div>
              <div className="mt-1 text-xs text-zinc-500">External AI responses checked against your criteria</div>
            </div>
            <div className="hud-glass rounded-2xl px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Avg trust score</div>
                  <div className="mt-1 text-3xl font-semibold">{stats.avgTrust ?? "—"}</div>
                </div>
                <Sparkline values={dailyBuckets.avgTrusts} accent="#34d399" />
              </div>
              <div className="mt-1 text-xs text-zinc-500">100 minus a cost per rule match, floored at 0</div>
            </div>
            <div className="hud-glass rounded-2xl px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Non-allow rate</div>
                  <div className="mt-1 text-3xl font-semibold">
                    {stats.total ? `${Math.round((stats.nonAllow / stats.total) * 100)}%` : "—"}
                  </div>
                </div>
                <Sparkline values={dailyBuckets.nonAllowPcts} accent="#fbbf24" />
              </div>
              <div className="mt-1 text-xs text-zinc-500">Modified, escalated, or blocked in the last 7 days</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Verdict health network */}
            <div className="hud-glass rounded-2xl px-6 py-6 lg:col-span-3">
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" />
                Verdict health — most recent evaluations
              </div>
              <div className="mt-4">
                <VerdictNetwork verdicts={networkVerdicts} />
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-[11px] font-mono uppercase tracking-wider">
                {(Object.keys(VERDICT_STYLE) as Verdict[]).map((v) => (
                  <div key={v} className="flex items-center gap-1.5 text-zinc-400">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: VERDICT_STYLE[v].hex }} />
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
                {rows.length === 0 && (
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
      )}
    </div>
  );
}

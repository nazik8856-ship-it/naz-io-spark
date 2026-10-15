import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Globe2, ShieldCheck, KeyRound, Lock, Plug, ScanEye } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { selectRulesForEntity, type EntityScopedLike } from "@/lib/agent-policy";
// outer_control_evaluations isn't in the generated Supabase types yet --
// same established workaround as every other page touching a table this
// sandbox can't regenerate types for.
const anyDb = supabase as any;

import ActiveSessionsCard from "@/components/control/outer/ActiveSessionsCard";
import WorkflowsCard from "@/components/control/outer/WorkflowsCard";
import OuterStatusBar, { type Attention } from "@/components/control/outer/OuterStatusBar";
import RecentDecisions, { type DecisionRow } from "@/components/control/outer/RecentDecisions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { healthText, type Verdict } from "@/lib/outer-control-ui";

type EvaluationRow = DecisionRow;

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
              <div className="text-xs text-zinc-500">
                A custom GPT action, a CRM's webhook step, a support bot's post-processing hook — or call it directly
                from your own backend.{" "}
                <button
                  onClick={() => navigate("/control-system/api-docs#custom-gpt-action")}
                  className="text-cyan-300 underline decoration-dotted hover:text-cyan-200"
                >
                  Copy-paste ChatGPT setup →
                </button>
              </div>
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
  // GAP 2 (Outer Control Full Activation, 2026-10-10): a registered api key
  // that has NEVER sent anything to POST /outer-control/evaluate is
  // structurally indistinguishable from one that's working fine but just
  // hasn't fired recently -- both show an empty-ish feed. Per-key last-seen
  // (or never) makes an inert key visible instead of silently zero.
  const [keyHealth, setKeyHealth] = useState<{ id: string; name: string; lastEvaluatedAt: string | null; ruleCount: number }[]>([]);
  // The default view is calm: the graph, the stats and the workflows open in a window from "Advanced".
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // LOOP 3 (Outer Control Incomplete Activation, 2026-10-10): which key's
  // test evaluation is currently in flight, if any.
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);

  const runSelfTest = async (keyId: string) => {
    setTestingKeyId(keyId);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? SUPABASE_ANON;
      const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/api-keys/${keyId}/self-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
        body: JSON.stringify({}),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok || !body?.ok) {
        toast.error(body?.message || "Test evaluation failed.");
        return;
      }
      toast.success(`Test evaluation sent — verdict: ${body.verdict}.`);
      // Clears the never-received-traffic warning for this key immediately,
      // without waiting on a full page refetch.
      setKeyHealth((prev) => prev.map((k) => (k.id === keyId ? { ...k, lastEvaluatedAt: body.evaluated_at ?? new Date().toISOString() } : k)));
    } catch {
      toast.error("Test evaluation failed — please try again.");
    } finally {
      setTestingKeyId(null);
    }
  };

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [keysRes, evalRes, keyActivityRes, hardRulesRes, safetyRulesRes] = await Promise.all([
        anyDb
          .from("api_keys")
          .select("id, name")
          .eq("user_id", accountId)
          .is("revoked_at", null)
          .contains("scopes", ["control:verdict"]),
        anyDb
          .from("outer_control_evaluations")
          .select("id, source_model, verdict, trust_score, summary, created_at, content_kind, action_type, executed, matches, input_excerpt, output_text, action_params, corrected_params, execution_summary, changes, next_step, shadow_matches, approval_id")
          .eq("user_id", accountId)
          .order("created_at", { ascending: false })
          .limit(50),
        // GAP 2: ordered newest-first, so the FIRST row seen per api_key_id
        // while walking this (client-side, below) is that key's most recent
        // evaluation -- avoids a separate GROUP BY/aggregate round trip for
        // what's normally a handful of keys.
        anyDb
          .from("outer_control_evaluations")
          .select("api_key_id, created_at")
          .eq("user_id", accountId)
          .not("api_key_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(500),
        // LOOP 2 (Low/Zero Rule Coverage, 2026-10-10): account-wide + this
        // key's own hard_rules/safety_rules -- mirrors GeneratedDashboard.tsx's
        // own agentRuleCount query. Built-in content scanning (safety-scanner.ts's
        // BUILTIN_SAFETY_RULES) always applies regardless of this count, so a
        // 0 here means "no account-specific business rule," never "unprotected."
        anyDb.from("hard_rules").select("id, agent_id, api_key_id, enabled").eq("user_id", accountId),
        anyDb.from("safety_rules").select("id, agent_id, api_key_id, enabled").eq("user_id", accountId),
      ]);
      if (cancelled) return;
      const keys = (keysRes.data ?? []) as { id: string; name: string }[];
      setHasApiKey(keys.length > 0);
      const lastSeenByKey = new Map<string, string>();
      for (const row of (keyActivityRes.data ?? []) as { api_key_id: string; created_at: string }[]) {
        if (!lastSeenByKey.has(row.api_key_id)) lastSeenByKey.set(row.api_key_id, row.created_at);
      }
      const hardRules = (hardRulesRes.data ?? []) as (EntityScopedLike & { id: string; enabled: boolean })[];
      const safetyRules = (safetyRulesRes.data ?? []) as (EntityScopedLike & { id: string; enabled: boolean })[];
      const ruleCountFor = (keyId: string) =>
        selectRulesForEntity(hardRules, "api_key", keyId).filter((r) => r.enabled !== false).length
        + selectRulesForEntity(safetyRules, "api_key", keyId).filter((r) => r.enabled !== false).length;
      setKeyHealth(keys.map((k) => ({
        id: k.id, name: k.name,
        lastEvaluatedAt: lastSeenByKey.get(k.id) ?? null,
        ruleCount: ruleCountFor(k.id),
      })));
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

  const neverSeen = keyHealth.filter((k) => !k.lastEvaluatedAt);
  const noRule = keyHealth.filter((k) => k.ruleCount === 0);
  const attention: Attention[] = [
    ...neverSeen.map((k) => ({
      id: `never-${k.id}`,
      message: `API key "${k.name}" has never received traffic.`,
      actionLabel: testingKeyId === k.id ? "Testing…" : "Send test evaluation",
      onAction: () => runSelfTest(k.id),
      busy: testingKeyId === k.id,
    })),
    ...noRule.map((k) => ({
      id: `rule-${k.id}`,
      message: `No account rule applies to API key "${k.name}" yet. Built-in scanning still applies.`,
      actionLabel: "Add a rule",
      onAction: () => navigate("/control-system"),
    })),
  ];

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
        <div className="mx-auto max-w-4xl px-6 py-8 space-y-5">
          {/* 1. Status */}
          <OuterStatusBar
            trust={stats.avgTrust}
            health={healthText({ total7d: stats.total, nonAllow7d: stats.nonAllow, anyEver: rows.length > 0 })}
            attention={attention}
            onOpenAdvanced={() => setAdvancedOpen(true)}
            onApiDocs={() => navigate("/control-system/api-docs")}
          />

          {/* 2. Connected tools (the main focus) */}
          <ActiveSessionsCard accountId={accountId} />

          {/* 3. Recent decisions */}
          <RecentDecisions rows={rows} onOpenApprovals={() => navigate("/control-system/approvals")} />

          {/* Advanced: a closable window, opened from the button in the status bar */}
          <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <DialogContent
              className="max-h-[88vh] w-[calc(100%-2rem)] max-w-4xl gap-5 overflow-y-auto border-white/10 bg-[#050b1a] text-white sm:rounded-2xl"
              data-testid="advanced-panel"
            >
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold text-zinc-100">Advanced</DialogTitle>
                <DialogDescription className="text-sm text-zinc-400">
                  Statistics for the last 7 days, the most recent decisions as a graph, and workflows that run several tools toward one goal.
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="hud-glass rounded-2xl px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-zinc-400">Replies checked (7 days)</div>
                      <div className="mt-1 text-2xl font-semibold">{stats.total}</div>
                    </div>
                    <Sparkline values={dailyBuckets.counts} accent="#22d3ee" />
                  </div>
                </div>
                <div className="hud-glass rounded-2xl px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-zinc-400">Average trust score</div>
                      <div className="mt-1 text-2xl font-semibold">{stats.avgTrust ?? "—"}</div>
                    </div>
                    <Sparkline values={dailyBuckets.avgTrusts} accent="#34d399" />
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">100 minus a cost per rule match, floored at 0</div>
                </div>
                <div className="hud-glass rounded-2xl px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-zinc-400">Changed, blocked or escalated</div>
                      <div className="mt-1 text-2xl font-semibold">
                        {stats.total ? `${Math.round((stats.nonAllow / stats.total) * 100)}%` : "—"}
                      </div>
                    </div>
                    <Sparkline values={dailyBuckets.nonAllowPcts} accent="#fbbf24" />
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">Share of replies that were not simply allowed, last 7 days</div>
                </div>
              </div>

              <div className="hud-glass rounded-2xl px-6 py-5">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <ShieldCheck className="h-4 w-4 text-cyan-300" />
                  Verdict health — the 20 most recent decisions
                </div>
                <div className="mt-3">
                  <VerdictNetwork verdicts={networkVerdicts} />
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">
                  {(Object.keys(VERDICT_STYLE) as Verdict[]).map((v) => (
                    <div key={v} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: VERDICT_STYLE[v].hex }} />
                      {VERDICT_STYLE[v].label}
                    </div>
                  ))}
                </div>
              </div>

              <WorkflowsCard accountId={accountId} />
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}

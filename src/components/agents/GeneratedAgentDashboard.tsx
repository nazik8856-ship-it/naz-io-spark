// Bespoke per-agent dashboard. The agent compiler produces a `ui` spec
// (theme, accent, layout, widgets). This component renders that spec
// against the live event stream so every deployed agent gets its own UI.
import { useMemo } from "react";
import {
  Activity, AlertTriangle, BarChart3, Brain, CheckCircle2, Cpu, Crosshair,
  Eye, Flame, Gauge, Globe2, LineChart, Radar, Rocket, ShieldCheck, Signal,
  Sparkles, Terminal, TrendingUp, Wallet, Wrench, Zap,
} from "lucide-react";

export type Widget =
  | { kind: "hero_metric"; title: string; valueFrom?: string; staticValue?: string; subtitle?: string; accent?: string; span?: number }
  | { kind: "decision_log"; title: string; limit?: number; span?: number }
  | { kind: "action_timeline"; title: string; limit?: number; span?: number }
  | { kind: "live_thoughts"; title: string; limit?: number; span?: number }
  | { kind: "alert_feed"; title: string; severity?: string; span?: number }
  | { kind: "tool_grid"; title: string; span?: number }
  | { kind: "kpi_radar"; title: string; span?: number }
  | { kind: "status_grid"; title: string; items: { label: string; valueFrom: string }[]; span?: number }
  | { kind: "guardrail_panel"; title: string; span?: number }
  | { kind: "tool_call_stream"; title: string; limit?: number; span?: number };

export type AgentUiSpec = {
  theme?: "obsidian" | "cyber" | "terminal" | "market" | "command" | "lab";
  accent?: string;
  accentSecondary?: string;
  hero?: { title?: string; tagline?: string; icon?: string };
  layout?: "command-deck" | "market-board" | "lab-console" | "stacked" | "two-col";
  widgets: Widget[];
};

type AgentEvent = { id: string; kind: string; payload: Record<string, unknown>; created_at: string };
type Manifest = {
  name: string; goal: string;
  tools: { name: string; description: string; kind: string; config: Record<string, unknown> }[];
  guardrails: { rule: string; requiresApproval: boolean }[];
  kpis: { name: string; target: string }[];
  ui?: AgentUiSpec;
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  brain: Brain, activity: Activity, wallet: Wallet, gauge: Gauge, signal: Signal,
  radar: Radar, terminal: Terminal, rocket: Rocket, eye: Eye, crosshair: Crosshair,
  shield: ShieldCheck, flame: Flame, sparkles: Sparkles, cpu: Cpu, globe: Globe2,
  line: LineChart, bars: BarChart3, trending: TrendingUp, zap: Zap, alert: AlertTriangle,
  check: CheckCircle2, wrench: Wrench,
};

export default function GeneratedAgentDashboard({
  manifest, events,
}: { manifest: Manifest; events: AgentEvent[] }) {
  const ui = manifest.ui ?? defaultUiFor(manifest);
  const accent = ui.accent || "#34d399";
  const accent2 = ui.accentSecondary || "#22d3ee";
  const HeroIcon = ICONS[(ui.hero?.icon || "sparkles").toLowerCase()] || Sparkles;

  const stats = useMemo(() => deriveStats(events), [events]);
  const isLive = events.length > 0 && !events.some((e) => e.kind === "finished");

  return (
    <div
      className="space-y-5"
      style={{ ["--agent-accent" as any]: accent, ["--agent-accent2" as any]: accent2 }}
    >
      {/* Hero — premium glass header */}
      <header
        className="group relative overflow-hidden rounded-3xl p-5 sm:p-6 transition-all duration-500"
        style={{
          background: `
            linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%),
            radial-gradient(120% 90% at 0% 0%, ${accent}22, transparent 55%),
            radial-gradient(120% 90% at 100% 100%, ${accent2}1a, transparent 55%),
            #08090c
          `,
          border: `1px solid ${accent}33`,
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          boxShadow: `
            0 0 0 1px ${accent}11 inset,
            0 30px 80px -40px ${accent}80,
            0 0 120px -50px ${accent2}66
          `,
        }}
      >
        {/* animated top sheen */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70"
          style={{ background: `linear-gradient(90deg, transparent, ${accent}, ${accent2}, transparent)` }}
        />
        {/* subtle moving grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(${accent} 1px, transparent 1px), linear-gradient(90deg, ${accent} 1px, transparent 1px)`,
            backgroundSize: "32px 32px",
            maskImage: "radial-gradient(ellipse at top right, black, transparent 70%)",
          }}
        />

        <div className="relative flex items-start gap-4">
          <div className="relative shrink-0">
            <div
              className="absolute inset-0 rounded-2xl blur-xl opacity-60"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})` }}
            />
            <div
              className="relative h-14 w-14 sm:h-16 sm:w-16 rounded-2xl flex items-center justify-center transition-transform duration-500 group-hover:scale-105"
              style={{
                background: `linear-gradient(135deg, ${accent}, ${accent2})`,
                boxShadow: `0 10px 30px -8px ${accent}80, inset 0 1px 0 rgba(255,255,255,0.4)`,
              }}
            >
              <HeroIcon className="h-7 w-7 sm:h-8 sm:w-8 text-black" />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.22em] font-mono font-semibold"
                style={{
                  background: isLive ? `${accent}22` : "rgba(255,255,255,0.05)",
                  color: isLive ? accent : "#71717a",
                  border: `1px solid ${isLive ? accent + "55" : "rgba(255,255,255,0.08)"}`,
                  boxShadow: isLive ? `0 0 12px ${accent}66` : "none",
                }}
              >
                <span className="relative flex h-1.5 w-1.5">
                  {isLive && (
                    <span
                      className="absolute inset-0 animate-ping rounded-full opacity-75"
                      style={{ background: accent }}
                    />
                  )}
                  <span
                    className="relative inline-flex h-1.5 w-1.5 rounded-full"
                    style={{ background: isLive ? accent : "#52525b" }}
                  />
                </span>
                {isLive ? "Live" : "Idle"}
              </span>
              <span className="text-[9px] uppercase tracking-[0.22em] font-mono text-zinc-500">
                {ui.theme || "autonomous"} · agent
              </span>
            </div>
            <h2
              className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight truncate"
              style={{ fontFamily: "'Space Grotesk', 'Inter', sans-serif" }}
            >
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: `linear-gradient(135deg, #ffffff, ${accent}, ${accent2})` }}
              >
                {ui.hero?.title || manifest.name}
              </span>
            </h2>
            <p className="text-[13px] text-zinc-400 line-clamp-2 mt-1 leading-relaxed">
              {ui.hero?.tagline || manifest.goal}
            </p>
          </div>
        </div>
      </header>

      {/* Widget grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4">
        {ui.widgets.map((w, i) => (
          <div key={i} className={spanClass(w.span ?? defaultSpan(w.kind))}>
            <WidgetCard widget={w} events={events} manifest={manifest} stats={stats} accent={accent} accent2={accent2} />
          </div>
        ))}
      </div>
    </div>
  );
}

function spanClass(n: number) {
  const map: Record<number, string> = {
    1: "lg:col-span-1",
    2: "lg:col-span-2",
    3: "lg:col-span-3",
    4: "lg:col-span-4",
    5: "lg:col-span-5",
    6: "lg:col-span-6 sm:col-span-2",
  };
  return map[Math.max(1, Math.min(6, n))] + " sm:col-span-2";
}

function defaultSpan(kind: string): number {
  if (kind === "decision_log" || kind === "action_timeline" || kind === "live_thoughts" || kind === "tool_call_stream") return 4;
  if (kind === "tool_grid" || kind === "guardrail_panel" || kind === "kpi_radar") return 2;
  return 2;
}

function deriveStats(events: AgentEvent[]) {
  return {
    total: events.length,
    decisions: events.filter((e) => e.kind === "decision").length,
    actions: events.filter((e) => e.kind === "action").length,
    tool_calls: events.filter((e) => e.kind === "tool_call").length,
    thoughts: events.filter((e) => e.kind === "reason").length,
    errors: events.filter((e) => e.kind === "error" || e.kind === "tool_error").length,
    finished: events.filter((e) => e.kind === "finished").length,
  };
}

/* ============================ premium card shell ============================ */

function GlassCard({
  children, accent, glow = true, className = "",
}: { children: React.ReactNode; accent: string; glow?: boolean; className?: string }) {
  return (
    <div
      className={`group/card relative overflow-hidden rounded-2xl h-full transition-all duration-300 hover:-translate-y-0.5 ${className}`}
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%), #0a0b0f",
        border: `1px solid ${accent}26`,
        backdropFilter: "blur(14px) saturate(160%)",
        WebkitBackdropFilter: "blur(14px) saturate(160%)",
        boxShadow: glow
          ? `0 1px 0 rgba(255,255,255,0.03) inset, 0 18px 40px -28px ${accent}80, 0 0 0 1px rgba(255,255,255,0.02)`
          : "0 1px 0 rgba(255,255,255,0.03) inset",
      }}
    >
      {/* hover glow ring */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover/card:opacity-100 transition-opacity duration-500"
        style={{ boxShadow: `0 0 0 1px ${accent}55 inset, 0 0 40px -10px ${accent}66 inset` }}
      />
      {/* top highlight */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}99, transparent)` }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}

function CardHeading({ label, accent, right }: { label: string; accent: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <span
          className="h-1 w-1 rounded-full"
          style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
        />
        <div
          className="text-[10px] uppercase tracking-[0.24em] font-mono font-semibold"
          style={{ color: accent }}
        >
          {label}
        </div>
      </div>
      {right}
    </div>
  );
}

/* ============================ widgets ============================ */

function WidgetCard({
  widget, events, manifest, stats, accent, accent2,
}: {
  widget: Widget;
  events: AgentEvent[];
  manifest: Manifest;
  stats: ReturnType<typeof deriveStats>;
  accent: string;
  accent2: string;
}) {
  if (widget.kind === "hero_metric") {
    const value =
      widget.staticValue ??
      (widget.valueFrom === "events_count" ? stats.total
        : widget.valueFrom === "decisions_count" ? stats.decisions
        : widget.valueFrom === "actions_count" ? stats.actions
        : widget.valueFrom === "tool_calls_count" ? stats.tool_calls
        : widget.valueFrom === "thoughts_count" ? stats.thoughts
        : widget.valueFrom === "errors_count" ? stats.errors
        : 0);
    const numeric = typeof value === "number" ? value : Number(value) || 0;
    const pct = Math.min(100, numeric > 0 ? Math.min(100, 12 + Math.log2(numeric + 1) * 18) : 4);
    return (
      <GlassCard accent={accent}>
        <div className="p-4 sm:p-5 h-full flex flex-col justify-between min-h-[140px]">
          <CardHeading label={widget.title} accent={accent} />
          <div className="space-y-3">
            <div
              className="text-4xl sm:text-5xl font-black tracking-tight font-mono leading-none"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                background: `linear-gradient(135deg, #ffffff, ${accent})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {typeof value === "number" ? value.toLocaleString() : value}
            </div>
            {/* progress bar */}
            <div className="space-y-1.5">
              <div className="h-1 w-full rounded-full overflow-hidden bg-white/[0.04]">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${accent}, ${accent2})`,
                    boxShadow: `0 0 10px ${accent}aa`,
                  }}
                />
              </div>
              {widget.subtitle && (
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
                  {widget.subtitle}
                </div>
              )}
            </div>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (widget.kind === "live_thoughts" || widget.kind === "decision_log" || widget.kind === "action_timeline" || widget.kind === "tool_call_stream" || widget.kind === "alert_feed") {
    const filterKind = widget.kind === "live_thoughts" ? "reason"
      : widget.kind === "decision_log" ? "decision"
      : widget.kind === "action_timeline" ? "action"
      : widget.kind === "tool_call_stream" ? "tool_call"
      : null;
    let list = filterKind
      ? events.filter((e) => e.kind === filterKind)
      : events.filter((e) => e.kind === "action" || e.kind === "error" || e.kind === "guardrail_block");
    if (widget.kind === "alert_feed" && (widget as any).severity && (widget as any).severity !== "all") {
      list = list.filter((e) => String((e.payload as any)?.severity || "info") === (widget as any).severity);
    }
    const limit = (widget as any).limit ?? 8;
    list = list.slice(-limit).reverse();
    return (
      <GlassCard accent={accent}>
        <div className="h-full flex flex-col">
          <div className="px-4 pt-3.5 pb-2">
            <CardHeading
              label={widget.title}
              accent={accent}
              right={
                <span
                  className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: `${accent}18`, color: accent }}
                >
                  {list.length}
                </span>
              }
            />
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2 font-mono text-[11.5px] max-h-[280px] min-h-[140px] custom-scroll">
            {list.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-6">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center mb-2"
                  style={{ background: `${accent}10`, border: `1px solid ${accent}30` }}
                >
                  <Activity className="h-4 w-4 animate-pulse" style={{ color: accent }} />
                </div>
                <div className="text-zinc-500 text-[11px]">Waiting for signal…</div>
              </div>
            ) : list.map((e, i) => (
              <div
                key={e.id}
                className="group/row relative pl-3 py-1 rounded-md hover:bg-white/[0.025] transition-colors"
                style={{ animation: `fadeSlideIn 0.3s ease-out both`, animationDelay: `${i * 30}ms` }}
              >
                <span
                  className="absolute left-0 top-2 h-1.5 w-1.5 rounded-full"
                  style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
                />
                <div className="text-[9.5px] text-zinc-500 uppercase tracking-wider mb-0.5">
                  {new Date(e.created_at).toLocaleTimeString()}
                </div>
                <div className="text-zinc-200 break-words leading-snug">
                  {renderInline(e)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </GlassCard>
    );
  }

  if (widget.kind === "tool_grid") {
    return (
      <GlassCard accent={accent}>
        <div className="p-4 h-full">
          <CardHeading label={widget.title} accent={accent} />
          <ul className="space-y-2">
            {manifest.tools.map((t) => {
              const needsSecret = t.kind === "custom" && (t.config as any)?.needsSecret;
              return (
                <li
                  key={t.name}
                  className="group/tool rounded-lg p-2.5 transition-all"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Wrench className="h-3 w-3 shrink-0" style={{ color: accent2 }} />
                      <div className="text-xs font-semibold text-white truncate">{t.name}</div>
                    </div>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase tracking-wider"
                      style={{
                        background: needsSecret ? "rgba(251,191,36,0.15)" : `${accent2}1a`,
                        color: needsSecret ? "#fbbf24" : accent2,
                        border: `1px solid ${needsSecret ? "rgba(251,191,36,0.3)" : accent2 + "33"}`,
                      }}
                    >
                      {needsSecret ? "secret" : t.kind}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1 line-clamp-2 leading-relaxed">{t.description}</div>
                </li>
              );
            })}
          </ul>
        </div>
      </GlassCard>
    );
  }

  if (widget.kind === "kpi_radar") {
    return (
      <GlassCard accent={accent}>
        <div className="p-4 h-full">
          <CardHeading label={widget.title} accent={accent} />
          <ul className="space-y-2.5">
            {manifest.kpis.map((k, i) => (
              <li key={i} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-zinc-300 truncate">{k.name}</span>
                  <span className="font-mono font-bold shrink-0" style={{ color: accent }}>
                    {k.target}
                  </span>
                </div>
                <div className="h-0.5 rounded-full overflow-hidden bg-white/[0.04]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${30 + (i * 17) % 65}%`,
                      background: `linear-gradient(90deg, ${accent}, ${accent2})`,
                      boxShadow: `0 0 6px ${accent}80`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </GlassCard>
    );
  }

  if (widget.kind === "guardrail_panel") {
    return (
      <GlassCard accent="#fbbf24">
        <div className="p-4 h-full">
          <CardHeading label={widget.title} accent="#fbbf24" />
          <ul className="space-y-2">
            {manifest.guardrails.map((g, i) => (
              <li
                key={i}
                className="text-[11px] text-zinc-300 flex gap-2 p-2 rounded-md"
                style={{ background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.1)" }}
              >
                <ShieldCheck className="h-3.5 w-3.5 text-amber-300 mt-0.5 shrink-0" />
                <span className="flex-1 leading-snug">
                  {g.rule}
                  {g.requiresApproval && (
                    <span className="ml-1.5 text-[9px] uppercase font-mono bg-amber-400/20 text-amber-200 px-1 rounded">
                      approval
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </GlassCard>
    );
  }

  if (widget.kind === "status_grid") {
    const map: Record<string, number> = {
      events_count: stats.total,
      decisions_count: stats.decisions,
      actions_count: stats.actions,
      tool_calls_count: stats.tool_calls,
      thoughts_count: stats.thoughts,
      errors_count: stats.errors,
    };
    return (
      <GlassCard accent={accent}>
        <div className="p-4 h-full">
          <CardHeading label={widget.title} accent={accent} />
          <div className="grid grid-cols-2 gap-2.5">
            {widget.items.map((it, i) => (
              <div
                key={i}
                className="rounded-lg p-3 relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(0,0,0,0.4))",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono mb-1">
                  {it.label}
                </div>
                <div
                  className="text-2xl font-black font-mono"
                  style={{
                    background: `linear-gradient(135deg, #ffffff, ${accent2})`,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  {map[it.valueFrom] ?? 0}
                </div>
              </div>
            ))}
          </div>
        </div>
      </GlassCard>
    );
  }

  return null;
}

function renderInline(e: AgentEvent): string {
  const p = e.payload || {};
  if (e.kind === "reason") return String((p as any).thought ?? "");
  if (e.kind === "decision") return `◆ ${(p as any).decision ?? ""}${(p as any).rationale ? ` — ${(p as any).rationale}` : ""}`;
  if (e.kind === "action") return `✔ ${(p as any).type ?? "action"} [${(p as any).severity ?? "info"}] ${(p as any).message ?? ""}`;
  if (e.kind === "tool_call") return `→ ${(p as any).tool}(${JSON.stringify((p as any).input ?? {})})`;
  if (e.kind === "error") return `✖ ${(p as any).message ?? "error"}`;
  if (e.kind === "guardrail_block") return `🛡 ${(p as any).message ?? (p as any).reason ?? ""}`;
  return JSON.stringify(p);
}

function defaultUiFor(m: Manifest): AgentUiSpec {
  return {
    theme: "command",
    accent: "#34d399",
    accentSecondary: "#22d3ee",
    hero: { title: m.name, tagline: m.goal, icon: "sparkles" },
    layout: "command-deck",
    widgets: [
      { kind: "hero_metric", title: "Decisions", valueFrom: "decisions_count", subtitle: "autonomous calls", span: 2 },
      { kind: "hero_metric", title: "Actions taken", valueFrom: "actions_count", span: 2 },
      { kind: "hero_metric", title: "Tool calls", valueFrom: "tool_calls_count", span: 2 },
      { kind: "live_thoughts", title: "Reasoning stream", limit: 8, span: 3 },
      { kind: "decision_log", title: "Decision log", limit: 6, span: 3 },
      { kind: "action_timeline", title: "Action timeline", limit: 6, span: 3 },
      { kind: "tool_grid", title: "Tools", span: 3 },
      { kind: "guardrail_panel", title: "Guardrails", span: 3 },
      { kind: "kpi_radar", title: "KPI targets", span: 3 },
    ],
  };
}

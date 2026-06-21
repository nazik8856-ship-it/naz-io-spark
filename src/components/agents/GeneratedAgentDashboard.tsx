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
  accent?: string;          // hex like #34d399
  accentSecondary?: string; // hex
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

  return (
    <div
      className="space-y-4"
      style={{ ["--agent-accent" as any]: accent, ["--agent-accent2" as any]: accent2 }}
    >
      {/* Hero */}
      <header
        className="rounded-2xl border p-4 sm:p-5 relative overflow-hidden"
        style={{
          borderColor: `${accent}55`,
          background: `radial-gradient(120% 80% at 0% 0%, ${accent}1a, transparent 55%), radial-gradient(120% 80% at 100% 100%, ${accent2}14, transparent 55%), #000`,
          boxShadow: `0 0 60px -25px ${accent}aa inset`,
        }}
      >
        <div className="flex items-start gap-3 sm:gap-4">
          <div
            className="shrink-0 h-12 w-12 sm:h-14 sm:w-14 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})` }}
          >
            <HeroIcon className="h-6 w-6 sm:h-7 sm:w-7 text-black" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.22em] font-mono mb-0.5" style={{ color: accent }}>
              {ui.theme || "autonomous"} agent · live
            </div>
            <div className="text-base sm:text-lg md:text-xl font-bold text-white truncate">
              {ui.hero?.title || manifest.name}
            </div>
            <div className="text-xs text-zinc-300 line-clamp-2">
              {ui.hero?.tagline || manifest.goal}
            </div>
          </div>
        </div>
      </header>

      {/* Widget grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4">
        {ui.widgets.map((w, i) => (
          <div
            key={i}
            className={spanClass(w.span ?? defaultSpan(w.kind))}
          >
            <WidgetCard widget={w} events={events} manifest={manifest} stats={stats} accent={accent} accent2={accent2} />
          </div>
        ))}
      </div>
    </div>
  );
}

function spanClass(n: number) {
  // map widget span (1-6) → grid columns
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
  const frame: React.CSSProperties = {
    borderColor: `${accent}33`,
    background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.6))",
  };

  if (widget.kind === "hero_metric") {
    const value =
      widget.staticValue ??
      (widget.valueFrom === "events_count" ? String(stats.total)
        : widget.valueFrom === "decisions_count" ? String(stats.decisions)
        : widget.valueFrom === "actions_count" ? String(stats.actions)
        : widget.valueFrom === "tool_calls_count" ? String(stats.tool_calls)
        : widget.valueFrom === "thoughts_count" ? String(stats.thoughts)
        : widget.valueFrom === "errors_count" ? String(stats.errors)
        : "—");
    return (
      <div className="rounded-xl border p-4 h-full" style={frame}>
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono" style={{ color: accent }}>{widget.title}</div>
        <div className="text-3xl sm:text-4xl font-black text-white mt-2 font-mono">{value}</div>
        {widget.subtitle && <div className="text-[11px] text-zinc-400 mt-1">{widget.subtitle}</div>}
      </div>
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
      <div className="rounded-xl border h-full flex flex-col" style={frame}>
        <div className="flex items-center justify-between px-3.5 py-2 border-b" style={{ borderColor: `${accent}22` }}>
          <div className="text-[10px] uppercase tracking-[0.2em] font-mono" style={{ color: accent }}>{widget.title}</div>
          <span className="text-[10px] text-zinc-500 font-mono">{list.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3.5 py-2.5 space-y-2 font-mono text-[11px] max-h-[260px] min-h-[120px]">
          {list.length === 0 ? (
            <div className="text-zinc-500 italic">Waiting for activity…</div>
          ) : list.map((e) => (
            <div key={e.id} className="text-zinc-200 break-words">
              <span className="text-zinc-500">{new Date(e.created_at).toLocaleTimeString()} · </span>
              {renderInline(e)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (widget.kind === "tool_grid") {
    return (
      <div className="rounded-xl border p-3.5 h-full" style={frame}>
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono mb-2.5" style={{ color: accent }}>{widget.title}</div>
        <ul className="space-y-2">
          {manifest.tools.map((t) => {
            const needsSecret = t.kind === "custom" && (t.config as any)?.needsSecret;
            return (
              <li key={t.name} className="rounded-md border border-white/5 bg-white/[0.02] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-white truncate">{t.name}</div>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                    style={{
                      background: needsSecret ? "rgba(251,191,36,0.15)" : `${accent2}22`,
                      color: needsSecret ? "#fbbf24" : accent2,
                    }}
                  >
                    {needsSecret ? "needs secret" : t.kind}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">{t.description}</div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (widget.kind === "kpi_radar") {
    return (
      <div className="rounded-xl border p-3.5 h-full" style={frame}>
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono mb-2.5" style={{ color: accent }}>{widget.title}</div>
        <ul className="space-y-2">
          {manifest.kpis.map((k, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-zinc-300 truncate">{k.name}</span>
              <span className="font-mono font-bold shrink-0" style={{ color: accent }}>{k.target}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (widget.kind === "guardrail_panel") {
    return (
      <div className="rounded-xl border p-3.5 h-full" style={frame}>
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono mb-2.5 text-amber-300">{widget.title}</div>
        <ul className="space-y-1.5">
          {manifest.guardrails.map((g, i) => (
            <li key={i} className="text-[11px] text-zinc-300 flex gap-2">
              <ShieldCheck className="h-3 w-3 text-amber-300 mt-0.5 shrink-0" />
              <span className="flex-1">
                {g.rule}
                {g.requiresApproval && <span className="ml-1.5 text-[9px] uppercase font-mono bg-amber-400/20 text-amber-200 px-1 rounded">approval</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (widget.kind === "status_grid") {
    const map: Record<string, string> = {
      events_count: String(stats.total),
      decisions_count: String(stats.decisions),
      actions_count: String(stats.actions),
      tool_calls_count: String(stats.tool_calls),
      thoughts_count: String(stats.thoughts),
      errors_count: String(stats.errors),
    };
    return (
      <div className="rounded-xl border p-3.5 h-full" style={frame}>
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono mb-2.5" style={{ color: accent }}>{widget.title}</div>
        <div className="grid grid-cols-2 gap-2.5">
          {widget.items.map((it, i) => (
            <div key={i} className="rounded-md border border-white/5 bg-black/40 p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono">{it.label}</div>
              <div className="text-lg font-bold font-mono mt-0.5" style={{ color: accent2 }}>{map[it.valueFrom] ?? "—"}</div>
            </div>
          ))}
        </div>
      </div>
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
  // Fallback when the compiler did not produce a ui spec — keep something useful.
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

// Blueprint task #63: the reference dashboard's "Rule Coverage & System
// Health" visualization. Both numbers are real: coveragePct is
// ControlCoverageGaps.tsx's own gap-finder (real connectable capabilities
// with no live hard rule matching them), healthPct is ControlHealthView's
// gate-error-rate complement -- rendered as two radial gauges instead of
// a hex network, since that's the honest NazAI-dark-theme equivalent of
// "two coverage numbers at a glance" without implying a graph topology the
// product doesn't actually compute.
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts";
import { ShieldCheck, Activity } from "lucide-react";

function Gauge({ pct, color, icon, label, sub }: { pct: number | null; color: string; icon: React.ReactNode; label: string; sub: string }) {
  const value = pct ?? 0;
  const data = [{ name: label, value, fill: color }];
  return (
    <div className="flex flex-1 items-center gap-4">
      <div className="relative h-24 w-24 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="72%"
            outerRadius="100%"
            data={data}
            startAngle={90}
            endAngle={pct === null ? 90 : 90 - (360 * value) / 100}
            barSize={8}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar background={{ fill: "rgba(255,255,255,0.06)" }} dataKey="value" cornerRadius={8} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {icon}
          <span className="mt-0.5 text-sm font-bold text-white">{pct === null ? "—" : `${pct}%`}</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{label}</div>
        <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>
      </div>
    </div>
  );
}

export default function RuleCoverageHealthCard({
  coveragePct,
  coverageGapCount,
  coverageTotal,
  healthPct,
  onCoverageClick,
  onHealthClick,
}: {
  coveragePct: number | null;
  coverageGapCount: number;
  coverageTotal: number;
  healthPct: number | null;
  onCoverageClick: () => void;
  onHealthClick: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Rule Coverage &amp; System Health</div>
      <div className="mt-4 flex flex-col gap-5 sm:flex-row">
        <button onClick={onCoverageClick} className="flex-1 text-left">
          <Gauge
            pct={coveragePct}
            color="#22d3ee"
            icon={<ShieldCheck className="h-4 w-4 text-cyan-300" />}
            label="Rule coverage"
            sub={
              coverageTotal === 0
                ? "No connected capabilities yet"
                : coverageGapCount > 0
                ? `${coverageGapCount} of ${coverageTotal} capabilities ungoverned`
                : `All ${coverageTotal} capabilities have a live rule`
            }
          />
        </button>
        <div className="hidden w-px self-stretch bg-white/10 sm:block" />
        <button onClick={onHealthClick} className="flex-1 text-left">
          <Gauge
            pct={healthPct}
            color="#d4af37"
            icon={<Activity className="h-4 w-4 text-amber-300" />}
            label="System health"
            sub={healthPct === null ? "No decisions in the last 7 days" : "Engine uptime, last 7 days"}
          />
        </button>
      </div>
    </div>
  );
}

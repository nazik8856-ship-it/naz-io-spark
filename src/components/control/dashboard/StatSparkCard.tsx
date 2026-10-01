// Blueprint task #63: a real stat card with a sparkline, matching the
// reference dashboard's Daily Spend / Recent Incidents / AI Agent Efficiency
// cards -- but every number here comes from useControlDashboardData's real
// queries, not placeholder data.
import { AreaChart, Area, ResponsiveContainer } from "recharts";

export type StatTone = "ok" | "warn" | "bad" | "neutral";

const TONE_COLOR: Record<StatTone, string> = {
  ok: "#34d399",
  warn: "#f59e0b",
  bad: "#fb7185",
  neutral: "#22d3ee",
};

export default function StatSparkCard({
  label,
  value,
  sub,
  tone = "neutral",
  series,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTone;
  series: (number | null)[];
  onClick?: () => void;
}) {
  const color = TONE_COLOR[tone];
  const data = series.map((v, i) => ({ i, v }));
  const hasData = series.some((v) => v !== null && v !== undefined);

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full flex-col rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-default"
    >
      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
      <div className="mt-2 h-10 w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${label.replace(/\s+/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#spark-${label.replace(/\s+/g, "")})`}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center text-[10px] font-mono uppercase text-zinc-700">No data yet</div>
        )}
      </div>
    </button>
  );
}

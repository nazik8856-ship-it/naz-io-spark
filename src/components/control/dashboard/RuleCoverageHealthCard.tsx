// Blueprint task #63 follow-up: replaced the two radial gauges with the hex
// grid from the reference mockup, per explicit feedback. Every hexagon is a
// real, connectable capability (same list ControlCoverageGaps.tsx audits) --
// green when a live hard rule covers it, amber when only a disabled/shadow
// rule matches (drafted, not actually enforcing), red when nothing matches
// at all. coverage-gaps.ts's classifyCoverage is the single source of truth
// shared with the hook; this component only renders it.
import type { CapabilityForCoverage, CoverageCellStatus } from "@/lib/coverage-gaps";
import { Activity } from "lucide-react";

type Cell = CapabilityForCoverage & { status: CoverageCellStatus };

const STATUS_COLOR: Record<CoverageCellStatus, string> = {
  covered: "#34d399",
  shadow: "#f59e0b",
  gap: "#fb7185",
};

const HEX_W = 30;
const HEX_H = 26;
const GAP = 3;
const COLS = 10;

function HexGrid({ cells }: { cells: Cell[] }) {
  if (cells.length === 0) {
    return <p className="text-xs text-zinc-600">No connected capabilities yet — connect an integration to see it governed here.</p>;
  }
  const rows: Cell[][] = [];
  for (let i = 0; i < cells.length; i += COLS) rows.push(cells.slice(i, i + COLS));
  return (
    <div className="flex flex-col items-start">
      {rows.map((row, ri) => (
        <div
          key={ri}
          className="flex"
          style={{
            gap: GAP,
            marginLeft: ri % 2 === 1 ? HEX_W / 2 + GAP / 2 : 0,
            marginTop: ri === 0 ? 0 : -(HEX_H * 0.27),
          }}
        >
          {row.map((cell, ci) => (
            <div
              key={ci}
              title={`${cell.kind} · ${cell.provider} — ${cell.status === "covered" ? "covered by a live rule" : cell.status === "shadow" ? "only a disabled/shadow rule matches" : "no rule covers this"}`}
              style={{
                width: HEX_W,
                height: HEX_H,
                clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                background: STATUS_COLOR[cell.status],
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function RuleCoverageHealthCard({
  coveragePct,
  coverageGapCount,
  coverageTotal,
  coverageCells,
  healthPct,
  onCoverageClick,
  onHealthClick,
}: {
  coveragePct: number | null;
  coverageGapCount: number;
  coverageTotal: number;
  coverageCells: Cell[];
  healthPct: number | null;
  onCoverageClick: () => void;
  onHealthClick: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Rule Coverage &amp; System Health</div>
        <div className="flex items-center gap-3 text-[11px]">
          <button onClick={onCoverageClick} className="flex items-center gap-1.5 text-zinc-400 hover:text-white">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR.covered }} />
            Coverage {coveragePct === null ? "—" : `${coveragePct}%`}
          </button>
          <button onClick={onHealthClick} className="flex items-center gap-1.5 text-zinc-400 hover:text-white">
            <Activity className="h-3 w-3 text-amber-300" />
            Health {healthPct === null ? "—" : `${healthPct}%`}
          </button>
        </div>
      </div>

      <button onClick={onCoverageClick} className="mt-4 block w-full overflow-x-auto text-left">
        <HexGrid cells={coverageCells} />
      </button>

      <div className="mt-3 flex items-center gap-4 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR.covered }} /> Covered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR.shadow }} /> Shadow / disabled
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR.gap }} /> Ungoverned
        </span>
        <span className="ml-auto">
          {coverageTotal === 0 ? "No connected capabilities yet" : `${coverageGapCount} of ${coverageTotal} ungoverned`}
        </span>
      </div>
    </div>
  );
}

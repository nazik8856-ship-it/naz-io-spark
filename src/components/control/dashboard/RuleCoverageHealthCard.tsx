// Blueprint task #64: a real node-link hex NETWORK, not a flat tile grid --
// per explicit reference-image feedback, every hexagon is a raised/beveled
// node (gradient fill + glossy highlight + drop shadow), sized and clustered
// by provider (capabilities under the same connected tool are genuinely
// related, so clustering -- and later connecting -- them this way reflects
// real structure, not an arbitrary layout), and linked by a k-nearest-
// neighbour graph over the resulting point cloud -- a standard, explainable
// way to turn a point cloud into a network, which mostly traces the
// provider clusters while still picking up a few organic cross-links, same
// as the reference's scattered mesh. coverage-gaps.ts's classifyCoverage is
// still the single source of truth; this component only lays it out.
import { useId, useMemo, useState } from "react";
import type { CapabilityForCoverage, CoverageCellStatus } from "@/lib/coverage-gaps";
import { Activity } from "lucide-react";

type Cell = CapabilityForCoverage & { status: CoverageCellStatus };

const STATUS_PALETTE: Record<CoverageCellStatus, { base: string; light: string; dark: string; glow: string }> = {
  covered: { base: "#22d3ee", light: "#bbf7d0", dark: "#065f46", glow: "#34d399" },
  shadow: { base: "#f59e0b", light: "#fde68a", dark: "#92400e", glow: "#fbbf24" },
  gap: { base: "#fb7185", light: "#fecdd3", dark: "#9f1239", glow: "#ec4899" },
};
// Extrusion height per status -- critical/ungoverned cells pop up taller so
// they read as the most urgent thing on the board, not just a different color.
const STATUS_DEPTH: Record<CoverageCellStatus, number> = { covered: 0.3, shadow: 0.42, gap: 0.55 };

const VIEW_W = 760;
const VIEW_H = 300;

type LaidOutNode = Cell & { x: number; y: number; r: number };

// Deterministic PRNG (not Math.random) so the same data always lays out the
// same way -- a layout that jittered on every render would make hover
// targets and the "organic" look feel buggy rather than designed.
function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function layoutNetwork(cells: Cell[]): { nodes: LaidOutNode[]; edges: [number, number][] } {
  if (cells.length === 0) return { nodes: [], edges: [] };

  const groups = new Map<string, Cell[]>();
  for (const c of cells) {
    const key = c.provider || "internal";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  // Shuffle cluster placement order (seeded by each key) instead of walking
  // insertion order left-to-right -- otherwise clusters lay out in a strict
  // row-major flow that reads as a flowchart, not a scattered mesh.
  const clusterKeys = [...groups.keys()].sort(
    (a, b) => seededRandom(hashStr(`order:${a}`))() - seededRandom(hashStr(`order:${b}`))(),
  );
  const numClusters = clusterKeys.length;

  // Scatter cluster centers across the WHOLE canvas (a jittered square-ish
  // grid, not a ring) -- a ring of clusters draws a necklace/loop, while the
  // reference fills the area with an organic mesh. Padding keeps clusters
  // off the edges.
  const padX = VIEW_W * 0.1;
  const padY = VIEW_H * 0.12;
  const cols = Math.max(1, Math.ceil(Math.sqrt(numClusters)));
  const rows = Math.max(1, Math.ceil(numClusters / cols));
  const cellW = (VIEW_W - 2 * padX) / cols;
  const cellH = (VIEW_H - 2 * padY) / rows;

  const nodes: LaidOutNode[] = [];

  clusterKeys.forEach((key, i) => {
    const rnd = seededRandom(hashStr(key));
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellCx = padX + (col + 0.5) * cellW;
    const cellCy = padY + (row + 0.5) * cellH;
    const ccx = cellCx + (rnd() - 0.5) * cellW * 0.75;
    const ccy = cellCy + (rnd() - 0.5) * cellH * 0.75;

    const members = groups.get(key)!;
    const subR = members.length <= 1 ? 0 : 20 + Math.min(members.length, 8) * 6;
    members.forEach((m, j) => {
      const mRnd = seededRandom(hashStr(key + m.kind + j));
      const mAngle = (j / members.length) * Math.PI * 2 + mRnd() * 0.6;
      const spread = 0.65 + mRnd() * 0.35;
      const x = ccx + (members.length <= 1 ? 0 : Math.cos(mAngle) * subR * spread);
      const y = ccy + (members.length <= 1 ? 0 : Math.sin(mAngle) * subR * spread);
      // Bigger clusters (more capabilities under one provider) read as more
      // prominent nodes -- a wide organic size jitter on top, same as the
      // reference's dramatically varied node sizes.
      const r = 15 + Math.min(members.length, 6) * 2.5 + mRnd() * 10;
      nodes.push({ ...m, x, y, r });
    });
  });

  // k-nearest-neighbour over the WHOLE point cloud (not per-cluster) --
  // clusters placed close together on the canvas naturally pick up a few
  // cross-cluster bridges this way, same organic mesh look as the reference,
  // while still mostly tracing real same-provider relationships.
  const K = 3;
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];
  nodes.forEach((n, i) => {
    const nearest = nodes
      .map((o, j) => ({ j, d: i === j ? Infinity : Math.hypot(n.x - o.x, n.y - o.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, K);
    for (const { j } of nearest) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([i, j]);
      }
    }
  });

  return { nodes, edges };
}

/** Pointy-top hexagon vertices around (cx, cy) with circumradius r, as [x, y] pairs. */
function hexVerts(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return pts;
}

function hexPoints(cx: number, cy: number, r: number): string {
  return hexVerts(cx, cy, r).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

type Tooltip = { cell: Cell; x: number; y: number };

function HexNetwork({ cells }: { cells: Cell[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { nodes, edges } = useMemo(() => layoutNetwork(cells), [cells]);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  if (cells.length === 0) {
    return <p className="text-xs text-zinc-600">No connected capabilities yet — connect an integration to see it governed here.</p>;
  }

  const showTooltip = (cell: Cell, e: React.MouseEvent) => {
    const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ cell, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // UX audit: tooltips were hover-only, so a cell's kind/provider/status
  // detail was simply unreachable on a touch device (the "View all"
  // button was the only touch-accessible fallback). Tapping now toggles
  // the same tooltip state hover already uses.
  const toggleTooltip = (cell: Cell, e: React.MouseEvent) => {
    if (tooltip?.cell === cell) { setTooltip(null); return; }
    showTooltip(cell, e);
  };

  // Pulsing "data packet" dots only ride a third of the edges -- animating
  // every edge on a 50-node graph would be ~150 concurrent SMIL animations
  // for no extra legibility, just visual noise and a cheaper-looking result.
  const pulseEdges = useMemo(() => edges.filter((_, i) => i % 3 === 0), [edges]);

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-gradient-to-br from-[#05070f] via-[#070c1c] to-[#06040f] p-2">
      {/* Ambient cyan/purple glow -- ::before-style blurred blobs, not part of the data. */}
      <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 -right-10 h-44 w-44 rounded-full bg-fuchsia-500/10 blur-3xl" />

      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="relative w-full h-auto" style={{ display: "block" }}>
        <defs>
          {(Object.keys(STATUS_PALETTE) as CoverageCellStatus[]).map((status) => (
            <radialGradient key={status} id={`${uid}-grad-${status}`} cx="32%" cy="26%" r="85%">
              <stop offset="0%" stopColor={STATUS_PALETTE[status].light} />
              <stop offset="45%" stopColor={STATUS_PALETTE[status].base} />
              <stop offset="100%" stopColor={STATUS_PALETTE[status].dark} />
            </radialGradient>
          ))}
          {(Object.keys(STATUS_PALETTE) as CoverageCellStatus[]).map((status) => (
            <linearGradient key={`wall-${status}`} id={`${uid}-wall-${status}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={STATUS_PALETTE[status].base} stopOpacity={0.85} />
              <stop offset="100%" stopColor={STATUS_PALETTE[status].dark} stopOpacity={0.95} />
            </linearGradient>
          ))}
          <filter id={`${uid}-shadow`} x="-80%" y="-80%" width="260%" height="260%">
            <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#000000" floodOpacity="0.55" />
          </filter>
          {(Object.keys(STATUS_PALETTE) as CoverageCellStatus[]).map((status) => (
            <filter key={`glow-${status}`} id={`${uid}-glow-${status}`} x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="2.6" result="blur" />
              <feFlood floodColor={STATUS_PALETTE[status].glow} floodOpacity="0.85" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
          <filter id={`${uid}-dotglow`} x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Node-link graph -- thin neon threads, same role as the old gray lines. */}
        <g stroke="#67e8f9" strokeOpacity={0.14} strokeWidth={1}>
          {edges.map(([a, b], i) => (
            <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} />
          ))}
        </g>

        {/* Live "data packet" dots traveling the graph, staggered so they don't pulse in lockstep. */}
        <g filter={`url(#${uid}-dotglow)`}>
          {pulseEdges.map(([a, b], i) => {
            const rnd = seededRandom(hashStr(`pulse:${a}:${b}`));
            const dur = (2.4 + rnd() * 2.6).toFixed(2);
            const begin = (-rnd() * 4).toFixed(2);
            return (
              <circle key={i} r={1.8} fill="#a5f3fc">
                <animateMotion
                  dur={`${dur}s`}
                  begin={`${begin}s`}
                  repeatCount="indefinite"
                  path={`M ${nodes[a].x} ${nodes[a].y} L ${nodes[b].x} ${nodes[b].y}`}
                />
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;0.15;0.85;1"
                  dur={`${dur}s`}
                  begin={`${begin}s`}
                  repeatCount="indefinite"
                />
              </circle>
            );
          })}
        </g>

        <g filter={`url(#${uid}-shadow)`}>
          {nodes.map((n, i) => {
            const palette = STATUS_PALETTE[n.status];
            const depth = n.r * STATUS_DEPTH[n.status];
            const top = hexVerts(n.x, n.y, n.r);
            const bot = hexVerts(n.x, n.y + depth, n.r);
            const floatRnd = seededRandom(hashStr(`float:${n.kind}:${n.provider}:${i}`));
            const floatDur = (2.8 + floatRnd() * 2).toFixed(2);
            const floatBegin = (-floatRnd() * 3).toFixed(2);
            return (
              <g
                key={i}
                onMouseEnter={(e) => showTooltip(n, e)}
                onMouseMove={(e) => showTooltip(n, e)}
                onMouseLeave={() => setTooltip(null)}
                onClick={(e) => toggleTooltip(n, e)}
                style={{ cursor: "pointer" }}
              >
                <title>{`${n.kind} · ${n.provider} — ${n.status === "covered" ? "covered by a live rule" : n.status === "shadow" ? "only a disabled/shadow rule matches" : "no rule covers this"}`}</title>
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values="0 0; 0 -3; 0 0"
                  dur={`${floatDur}s`}
                  begin={`${floatBegin}s`}
                  repeatCount="indefinite"
                  calcMode="spline"
                  keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                  keyTimes="0;0.5;1"
                />

                {/* Two bottom-facing extrusion walls -- the only side faces visible from
                    this near-top-down isometric angle -- give the hex a raised-prism look. */}
                <polygon points={`${top[2].join(",")} ${top[3].join(",")} ${bot[3].join(",")} ${bot[2].join(",")}`} fill={`url(#${uid}-wall-${n.status})`} />
                <polygon points={`${top[3].join(",")} ${top[4].join(",")} ${bot[4].join(",")} ${bot[3].join(",")}`} fill={`url(#${uid}-wall-${n.status})`} fillOpacity={0.85} />

                {/* Top face -- the neon-glowing cap. */}
                <g filter={`url(#${uid}-glow-${n.status})`}>
                  <polygon
                    points={hexPoints(n.x, n.y, n.r * 0.94)}
                    fill={`url(#${uid}-grad-${n.status})`}
                    stroke={palette.light}
                    strokeOpacity={0.5}
                    strokeWidth={0.75}
                  />
                </g>
                <polygon points={hexPoints(n.x, n.y, n.r)} fill="none" stroke={palette.dark} strokeOpacity={0.9} strokeWidth={n.r * 0.09} />
                {/* Glossy specular highlight, offset toward the light source. */}
                <ellipse
                  cx={n.x - n.r * 0.28}
                  cy={n.y - n.r * 0.32}
                  rx={n.r * 0.42}
                  ry={n.r * 0.26}
                  fill="#ffffff"
                  fillOpacity={0.32}
                  style={{ pointerEvents: "none" }}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 max-w-[220px] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-cyan-500/20 bg-[#0a0f1e]/95 px-2.5 py-1.5 text-[11px] shadow-xl shadow-cyan-500/10 backdrop-blur-sm"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-medium text-zinc-100">{tooltip.cell.kind}</div>
          <div className="text-zinc-500">{tooltip.cell.provider}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_PALETTE[tooltip.cell.status].base, boxShadow: `0 0 6px ${STATUS_PALETTE[tooltip.cell.status].glow}` }} />
            <span className="text-zinc-400">
              {tooltip.cell.status === "covered" ? "Covered by a live rule" : tooltip.cell.status === "shadow" ? "Shadow/disabled rule only" : "No rule covers this"}
            </span>
          </div>
        </div>
      )}
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
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Rule Coverage &amp; System Health</div>
        <div className="flex items-center gap-3 text-[11px]">
          <button
            onClick={onCoverageClick}
            title="How much of what your AI can do is actually governed by a live rule"
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_PALETTE.covered.base }} />
            Coverage {coveragePct === null ? "—" : `${coveragePct}%`}
          </button>
          <button
            onClick={onHealthClick}
            title="How reliably the Control System itself is running"
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white"
          >
            <Activity className="h-3 w-3 text-amber-300" />
            Health {healthPct === null ? "—" : `${healthPct}%`}
          </button>
        </div>
      </div>

      <button onClick={onCoverageClick} className="mt-4 block w-full text-left">
        <HexNetwork cells={coverageCells} />
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_PALETTE.covered.base }} /> Covered
        </span>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_PALETTE.shadow.base }} /> Shadow/disabled
        </span>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_PALETTE.gap.base }} /> Ungoverned
        </span>
        <span className="whitespace-nowrap sm:ml-auto">
          {coverageTotal === 0 ? "No connected capabilities yet" : `${coverageGapCount} of ${coverageTotal} ungoverned`}
        </span>
      </div>
    </div>
  );
}

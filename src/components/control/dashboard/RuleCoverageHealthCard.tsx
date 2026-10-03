// Blueprint task #64 (revised per reference-image feedback, round 2): the
// mockup is a real tessellating hex TILE FLOOR -- flat glass chips
// interlocking edge-to-edge on an axial grid, flattened to a shallow
// isometric angle -- with a separate, sparser node-graph (small circles +
// thin lines) floating above the tiles. Round 1 built a scattered point-
// cloud of raised 3D pillars instead; this rewrites the layout to a proper
// hex-grid (spiral-filled so same-provider capabilities land contiguous,
// tessellating rather than scattered-island) and renders tiles as flat,
// translucent, stroke-glowing chips. coverage-gaps.ts's classifyCoverage is
// still the single source of truth; this component only lays it out.
import { useId, useMemo, useState } from "react";
import type { CapabilityForCoverage, CoverageCellStatus } from "@/lib/coverage-gaps";
import { Activity } from "lucide-react";

type Cell = CapabilityForCoverage & { status: CoverageCellStatus };

const STATUS_PALETTE: Record<CoverageCellStatus, { from: string; to: string; glow: string; base: string }> = {
  covered: { from: "#00f2fe", to: "#4facfe", glow: "#22d3ee", base: "#4facfe" },
  shadow: { from: "#ffd866", to: "#ff9100", glow: "#fbbf24", base: "#ffb300" },
  gap: { from: "#ff0844", to: "#ffb199", glow: "#fb7185", base: "#ff4d6d" },
};
// Extrusion height range per status (fraction of hex size) -- jittered per
// tile within the range so cells don't all read as one uniform flat slab;
// critical/ungoverned cells get the tallest range so they read as the most
// urgent thing on the board.
const STATUS_DEPTH_RANGE: Record<CoverageCellStatus, [number, number]> = {
  covered: [0.1, 0.2],
  shadow: [0.2, 0.32],
  gap: [0.3, 0.48],
};

const VIEW_W = 760;
const VIEW_H = 300;
// Vertical squash applied to the whole grid -- this, combined with the
// per-tile extrusion, is what gives the shallow isometric tilt the
// reference uses.
const SQUASH = 0.56;

type LaidOutTile = Cell & { x: number; y: number; q: number; r: number; depth: number };
type GraphNode = { provider: string; x: number; y: number; status: CoverageCellStatus; gapShare: number };
type Centroid = { x: number; y: number };

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

/** One ring (radius > 0) of flat-top axial hex coordinates around a center. */
function hexRing(center: [number, number], radius: number): [number, number][] {
  if (radius === 0) return [center];
  const dirs: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const results: [number, number][] = [];
  let [q, r] = [center[0] + dirs[4][0] * radius, center[1] + dirs[4][1] * radius];
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push([q, r]);
      q += dirs[side][0];
      r += dirs[side][1];
    }
  }
  return results;
}

/** Spiral-fills outward from the origin, one ring at a time -- consecutive
 * indices land on adjacent hexes, so a provider-grouped input list keeps
 * each provider's tiles clustered together on the tessellating grid. */
function axialSpiral(count: number): [number, number][] {
  const coords: [number, number][] = [[0, 0]];
  let ring = 1;
  while (coords.length < count) {
    coords.push(...hexRing([0, 0], ring));
    ring++;
  }
  return coords.slice(0, count);
}

function axialToWorld(q: number, r: number): [number, number] {
  return [1.5 * q, (Math.sqrt(3) / 2) * q + Math.sqrt(3) * r];
}

/** Flat-top hexagon vertices around (cx, cy) with circumradius r, as [x, y] pairs. */
function hexVerts(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return pts;
}

function hexPoints(cx: number, cy: number, r: number): string {
  return hexVerts(cx, cy, r).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

function layoutGrid(cells: Cell[]): {
  tiles: LaidOutTile[];
  ghostCoords: [number, number][];
  size: number;
  nodes: GraphNode[];
  edges: [number, number][];
  centroids: Partial<Record<CoverageCellStatus, Centroid>>;
} {
  if (cells.length === 0) return { tiles: [], ghostCoords: [], size: 0, nodes: [], edges: [], centroids: {} };

  const groups = new Map<string, Cell[]>();
  for (const c of cells) {
    const key = c.provider || "internal";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  // Shuffle cluster order (seeded by each key) so the spiral doesn't always
  // start with the same provider in the dead center.
  const clusterKeys = [...groups.keys()].sort(
    (a, b) => seededRandom(hashStr(`order:${a}`))() - seededRandom(hashStr(`order:${b}`))(),
  );

  // Spiral-fill with one skipped (ghost) slot between each provider cluster --
  // breathing room between clusters instead of every slot being painted, so
  // the floor reads as clusters-on-a-grid rather than one solid color mass.
  const totalMembers = clusterKeys.reduce((s, k) => s + groups.get(k)!.length, 0);
  const interiorGapCount = Math.max(0, clusterKeys.length - 1);
  const spiral = axialSpiral(totalMembers + interiorGapCount);

  const tiles: LaidOutTile[] = [];
  const interiorGaps: [number, number][] = [];
  let cursor = 0;
  clusterKeys.forEach((key, ci) => {
    for (const cell of groups.get(key)!) {
      const [q, r] = spiral[cursor++];
      const [x, y] = axialToWorld(q, r);
      const [lo, hi] = STATUS_DEPTH_RANGE[cell.status];
      const depthRnd = seededRandom(hashStr(`depth:${key}:${cell.kind}:${cell.status}:${cursor}`))();
      tiles.push({ ...cell, x, y, q, r, depth: lo + depthRnd * (hi - lo) });
    }
    if (ci < clusterKeys.length - 1) interiorGaps.push(spiral[cursor++]);
  });

  // Size the grid to fill the viewport: find the world-space bounding box at
  // unit hex size, then solve for the largest size that fits VIEW_W/VIEW_H
  // once the vertical squash is applied.
  const maxAbsX = Math.max(1, ...tiles.map((t) => Math.abs(t.x))) + 1;
  const maxAbsY = Math.max(1, ...tiles.map((t) => Math.abs(t.y))) + 1;
  const sizeX = (VIEW_W * 0.46) / maxAbsX;
  const sizeY = (VIEW_H * 0.46) / (maxAbsY * SQUASH);
  const size = Math.max(12, Math.min(30, sizeX, sizeY));

  // One extra faint outline ring beyond the data, so the floor reads as a
  // continuous grid rather than stopping abruptly at the data's edge --
  // plus the interior gaps left between clusters above.
  let usedRing = 0;
  while (1 + 3 * usedRing * (usedRing + 1) < totalMembers + interiorGapCount) usedRing++;
  const ghostCoords = [...interiorGaps, ...hexRing([0, 0], usedRing + 1)];

  // Graph overlay: one floating node per provider cluster (its centroid),
  // not one per tile -- the reference's mesh is far sparser than the tile
  // floor beneath it.
  const tilesByProvider = new Map<string, LaidOutTile[]>();
  for (const t of tiles) {
    const key = t.provider || "internal";
    if (!tilesByProvider.has(key)) tilesByProvider.set(key, []);
    tilesByProvider.get(key)!.push(t);
  }
  const nodes: GraphNode[] = clusterKeys.map((key) => {
    const members = tilesByProvider.get(key)!;
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    const gapShare = members.filter((m) => m.status === "gap").length / members.length;
    const dominant: CoverageCellStatus = gapShare >= 0.4 ? "gap" : members.some((m) => m.status === "shadow") ? "shadow" : "covered";
    return { provider: key, x: cx, y: cy, status: dominant, gapShare };
  });

  // Triangulated mesh -- K=3 so the sparse node graph still reads as a dense
  // structural web with crossing diagonals, not just a thin chain.
  const K = Math.min(3, nodes.length - 1);
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];
  if (K > 0) {
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
  }

  // Per-status centroid (in final pixel units) so the ambient glow halos can
  // sit under the actual color clusters instead of fixed decorative corners.
  const centroids: Partial<Record<CoverageCellStatus, Centroid>> = {};
  (["covered", "shadow", "gap"] as CoverageCellStatus[]).forEach((status) => {
    const members = tiles.filter((t) => t.status === status);
    if (members.length === 0) return;
    centroids[status] = {
      x: (members.reduce((s, m) => s + m.x, 0) / members.length) * size,
      y: (members.reduce((s, m) => s + m.y, 0) / members.length) * size,
    };
  });

  return { tiles, ghostCoords, size, nodes, edges, centroids };
}

type Tooltip = { cell: Cell; x: number; y: number };

function HexNetwork({ cells }: { cells: Cell[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { tiles, ghostCoords, size, nodes, edges, centroids } = useMemo(() => layoutGrid(cells), [cells]);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  // Rules-of-hooks: this useMemo must run on every render, including when
  // cells is empty and we're about to bail to the empty-state JSX below --
  // a hook called only on the non-empty path crashed production with
  // "Rendered more hooks than during the previous render" the moment a
  // card went from populated to empty (or vice versa) across a re-render.
  const beamNodeIdx = useMemo(
    () => nodes.map((n, i) => i).filter((i) => nodes[i].gapShare > 0).sort((a, b) => nodes[b].gapShare - nodes[a].gapShare).slice(0, 2),
    [nodes],
  );

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

  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  // Floating node mesh sits visually above the tile plane -- a world-space
  // lift here becomes a smaller on-screen offset once SQUASH is applied.
  const lift = size * 1.35;

  // Soft ambient radial halos anchored under the real color clusters -- not
  // harsh drop-shadows, and not fixed decorative corners.
  const halos = (["covered", "shadow", "gap"] as CoverageCellStatus[])
    .map((status) => {
      const c = centroids[status];
      if (!c) return null;
      return {
        status,
        leftPct: ((VIEW_W / 2 + c.x) / VIEW_W) * 100,
        topPct: ((VIEW_H / 2 + c.y * SQUASH) / VIEW_H) * 100,
      };
    })
    .filter((h): h is { status: CoverageCellStatus; leftPct: number; topPct: number } => h !== null);

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-gradient-to-br from-[#05070f] via-[#070c1c] to-[#06040f] p-2">
      {halos.map((h) => (
        <div
          key={h.status}
          className="pointer-events-none absolute h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{ left: `${h.leftPct}%`, top: `${h.topPct}%`, background: STATUS_PALETTE[h.status].glow, opacity: 0.16 }}
        />
      ))}

      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="relative w-full h-auto" style={{ display: "block" }}>
        <defs>
          {/* Faint HUD grid texture across the whole backdrop. */}
          <pattern id={`${uid}-gridtex`} width={18} height={18} patternUnits="userSpaceOnUse">
            <path d="M 18 0 L 0 0 0 18" fill="none" stroke="#67e8f9" strokeOpacity={0.05} strokeWidth={0.5} />
          </pattern>
          {(Object.keys(STATUS_PALETTE) as CoverageCellStatus[]).map((status) => (
            <linearGradient key={status} id={`${uid}-grad-${status}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={STATUS_PALETTE[status].from} stopOpacity={0.4} />
              <stop offset="100%" stopColor={STATUS_PALETTE[status].to} stopOpacity={0.18} />
            </linearGradient>
          ))}
          {/* Frosted, semi-transparent side-wall gradient -- lighter near the
              top face, fading toward the base, per status hue. */}
          {(Object.keys(STATUS_PALETTE) as CoverageCellStatus[]).map((status) => (
            <linearGradient key={`wall-${status}`} id={`${uid}-wall-${status}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={STATUS_PALETTE[status].from} stopOpacity={0.32} />
              <stop offset="100%" stopColor={STATUS_PALETTE[status].to} stopOpacity={0.08} />
            </linearGradient>
          ))}
          {/* Glossy sphere-node gradient per status -- highlight top-left,
              status glow mid, dark edge -- so nodes read as 3D joints. */}
          {(Object.keys(STATUS_PALETTE) as CoverageCellStatus[]).map((status) => (
            <radialGradient key={`sphere-${status}`} id={`${uid}-sphere-${status}`} cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
              <stop offset="45%" stopColor={STATUS_PALETTE[status].glow} stopOpacity={0.95} />
              <stop offset="100%" stopColor="#0f172a" stopOpacity={0.9} />
            </radialGradient>
          ))}
          {(Object.keys(STATUS_PALETTE) as CoverageCellStatus[]).map((status) => (
            <filter key={`glow-${status}`} id={`${uid}-glow-${status}`} x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feFlood floodColor={STATUS_PALETTE[status].glow} floodOpacity="0.9" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
          <filter id={`${uid}-dotglow`} x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={`${uid}-beam`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill={`url(#${uid}-gridtex)`} />

        <g transform={`translate(${cx}, ${cy}) scale(1, ${SQUASH})`}>
          {/* Faint grey outline hexes extending the floor past the real data. */}
          <g fill="none" stroke="#94a3b8" strokeOpacity={0.12} strokeWidth={1}>
            {ghostCoords.map(([q, r], i) => {
              const [x, y] = axialToWorld(q, r);
              return <polygon key={i} points={hexPoints(x * size, y * size, size * 0.94)} />;
            })}
          </g>

          {/* The tile floor -- translucent glass chips with real volumetric
              extrusion (frosted side walls, per-tile jittered height) and a
              beveled top-face highlight. */}
          {tiles.map((t, i) => {
            const palette = STATUS_PALETTE[t.status];
            const px = t.x * size;
            const py = t.y * size;
            const depthPx = size * t.depth;
            const top = hexVerts(px, py, size * 0.96);
            const bot = hexVerts(px, py + depthPx, size * 0.96);
            return (
              <g
                key={i}
                onMouseEnter={(e) => showTooltip(t, e)}
                onMouseMove={(e) => showTooltip(t, e)}
                onMouseLeave={() => setTooltip(null)}
                onClick={(e) => toggleTooltip(t, e)}
                style={{ cursor: "pointer" }}
                filter={`url(#${uid}-glow-${t.status})`}
              >
                <title>{`${t.kind} · ${t.provider} — ${t.status === "covered" ? "covered by a live rule" : t.status === "shadow" ? "only a disabled/shadow rule matches" : "no rule covers this"}`}</title>
                {/* Two bottom-facing frosted walls -- the only side faces
                    visible from this near-top-down isometric angle. */}
                <polygon points={`${top[2].join(",")} ${top[3].join(",")} ${bot[3].join(",")} ${bot[2].join(",")}`} fill={`url(#${uid}-wall-${t.status})`} />
                <polygon points={`${top[3].join(",")} ${top[4].join(",")} ${bot[4].join(",")} ${bot[3].join(",")}`} fill={`url(#${uid}-wall-${t.status})`} fillOpacity={0.85} />
                {/* Top face. */}
                <polygon points={hexPoints(px, py, size * 0.96)} fill={`url(#${uid}-grad-${t.status})`} stroke={palette.from} strokeOpacity={0.9} strokeWidth={1.25} />
                {/* Beveled inner highlight ring. */}
                <polygon points={hexPoints(px, py, size * 0.72)} fill="none" stroke="#ffffff" strokeOpacity={0.22} strokeWidth={0.75} />
              </g>
            );
          })}

          {/* Node-link graph, floating above the tile plane. */}
          <g stroke="#67e8f9" strokeOpacity={0.35} strokeWidth={1}>
            {edges.map(([a, b], i) => (
              <line
                key={i}
                x1={nodes[a].x * size}
                y1={nodes[a].y * size - lift}
                x2={nodes[b].x * size}
                y2={nodes[b].y * size - lift}
              />
            ))}
          </g>
          {/* Thin stems tying each floating node back down to its tile, with
              a small joint dot marking the real vertex where it lands. */}
          <g stroke="#94a3b8" strokeOpacity={0.3} strokeWidth={0.75}>
            {nodes.map((n, i) => (
              <line key={i} x1={n.x * size} y1={n.y * size - lift} x2={n.x * size} y2={n.y * size} />
            ))}
          </g>
          <g fill="#cbd5e1" fillOpacity={0.6}>
            {nodes.map((n, i) => (
              <circle key={i} cx={n.x * size} cy={n.y * size} r={1.6} />
            ))}
          </g>

          <g filter={`url(#${uid}-dotglow)`}>
            {edges.map(([a, b], i) => {
              const rnd = seededRandom(hashStr(`pulse:${a}:${b}`));
              const dur = (2.4 + rnd() * 2.6).toFixed(2);
              const begin = (-rnd() * 4).toFixed(2);
              const x1 = nodes[a].x * size, y1 = nodes[a].y * size - lift;
              const x2 = nodes[b].x * size, y2 = nodes[b].y * size - lift;
              return (
                <circle key={i} r={1.8} fill="#a5f3fc">
                  <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" path={`M ${x1} ${y1} L ${x2} ${y2}`} />
                  <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" />
                </circle>
              );
            })}
          </g>

          {/* Vertical light shafts on the worst-covered clusters. */}
          {beamNodeIdx.map((i) => (
            <line
              key={i}
              x1={nodes[i].x * size}
              y1={nodes[i].y * size - lift}
              x2={nodes[i].x * size}
              y2={nodes[i].y * size - lift - size * 2.4}
              stroke={`url(#${uid}-beam)`}
              strokeWidth={2}
            />
          ))}

          {nodes.map((n, i) => {
            const floatRnd = seededRandom(hashStr(`float:${n.provider}:${i}`));
            const floatDur = (2.8 + floatRnd() * 2).toFixed(2);
            const floatBegin = (-floatRnd() * 3).toFixed(2);
            return (
              <g key={i} filter={`url(#${uid}-glow-${n.status})`}>
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values="0 0; 0 -2.5; 0 0"
                  dur={`${floatDur}s`}
                  begin={`${floatBegin}s`}
                  repeatCount="indefinite"
                  calcMode="spline"
                  keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                  keyTimes="0;0.5;1"
                />
                <circle cx={n.x * size} cy={n.y * size - lift} r={4} fill={`url(#${uid}-sphere-${n.status})`} stroke={STATUS_PALETTE[n.status].glow} strokeOpacity={0.6} strokeWidth={0.75} />
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

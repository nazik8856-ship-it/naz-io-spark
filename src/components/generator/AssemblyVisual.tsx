import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  ASSEMBLY_STAGES, CARD_STATE_LABEL, cardState, summarizeAssembly,
  type AssemblyPage, type AssemblyPhase,
} from "@/lib/assembly";
import type { QualityCheck } from "@/lib/site-structures";

/**
 * The generation "assembly" visual: Intake → Calibration → Synthesis →
 * Synchronization → Output, drawn as a stack of isometric layers.
 *
 * Everything on it is real:
 *  - the page cards are the actual pages (and section counts) of the site being
 *    built -- not sample text -- and there are exactly as many as the site has;
 *  - `phase` comes from generation_progress (see lib/assembly.ts), never a timer,
 *    so a page is only shown as merged once the saved site exists;
 *  - the four calibration cells show the real quality-check states.
 * In the last phase the page layers drop through the funnel and come out as one
 * site frame whose bars are the combined sections of every page.
 */

const VB_W = 520;
const VB_H = 652;
const CX = 300;
const HALF = 128; // half-width of a layer diamond
const S = Math.round(HALF * Math.SQRT2); // side of the square that becomes the diamond
const Y_INTAKE = 68;
const Y_CAL = 152;
const SYN_TOP = 252;
const SYN_SPAN = 132;
const Y_FUNNEL = 470;
const FRAME = { x: 180, y: 552, w: 240, h: 88 };

const COLORS = {
  cyan: "#22d3ee",
  teal: "#2dd4bf",
  violet: "#a78bfa",
  pink: "#f472b6",
  amber: "#fbbf24",
  green: "#34d399",
  red: "#fb7185",
};

const TYPE_COLOR: Record<string, string> = {
  hero: COLORS.cyan, about: COLORS.teal, "feature-split": COLORS.teal, services: COLORS.violet,
  gallery: COLORS.pink, process: COLORS.violet, faq: COLORS.violet, pricing: COLORS.amber,
  cta: COLORS.pink, contact: COLORS.green,
};
const colorFor = (type: string) => TYPE_COLOR[type] ?? COLORS.cyan;

const CHECK_COLOR: Record<string, string> = {
  passed: COLORS.green, fixed: COLORS.cyan, flagged: COLORS.amber, checking: COLORS.cyan, pending: "rgba(255,255,255,0.18)",
};

/** Layer centre y for page `i` of `n`. */
function synY(i: number, n: number): number {
  if (n <= 1) return SYN_TOP + SYN_SPAN / 2;
  return SYN_TOP + (i * SYN_SPAN) / (n - 1);
}

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

const ISO = (cx: number, cy: number) => `translate(${cx} ${cy}) scale(1 0.5) rotate(45)`;

export type AssemblyVisualProps = {
  pages: AssemblyPage[];
  phase: AssemblyPhase;
  checks?: QualityCheck[];
  siteName?: string;
  /** Overrides the caption under the visual (defaults to the phase caption). */
  statusText?: string;
  compact?: boolean;
  className?: string;
};

const PLACEHOLDER_PAGES: AssemblyPage[] = [
  { slug: "p1", title: "Planning pages…", sections: [] },
  { slug: "p2", title: "Planning pages…", sections: [] },
  { slug: "p3", title: "Planning pages…", sections: [] },
];

export default function AssemblyVisual({ pages, phase, checks = [], siteName, statusText, compact = false, className }: AssemblyVisualProps) {
  const real = pages.length > 0;
  const shown = real ? pages.slice(0, 6) : PLACEHOLDER_PAGES;
  const n = shown.length;
  const totals = useMemo(() => summarizeAssembly(shown), [shown]);
  const state = cardState(phase);
  const stage = ASSEMBLY_STAGES[phase];
  const caption = statusText ?? stage.caption;

  const allSections = useMemo(() => shown.flatMap((p, pi) => p.sections.map((t) => ({ t, pi }))).slice(0, 16), [shown]);

  return (
    <div
      data-assembly-phase={phase}
      data-testid="assembly-visual"
      className={cn("av-root w-full", compact ? "" : "rounded-2xl border border-white/10 bg-[#050813]/80 p-3 md:p-5", className)}
    >
      <style>{AV_CSS}</style>
      <div className={cn("flex gap-4", compact ? "flex-col" : "flex-col md:flex-row md:items-center")}>
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          aria-label={`${siteName ? `${siteName}: ` : ""}${stage.label} — ${caption}. ${totals.pages} page${totals.pages === 1 ? "" : "s"}, ${totals.sections} section${totals.sections === 1 ? "" : "s"}.`}
          className={cn("mx-auto h-auto w-full", compact ? "max-w-[340px]" : "max-w-[440px]")}
        >
          <defs>
            <linearGradient id="av-layer" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#0f1a33" />
              <stop offset="1" stopColor="#0a1124" />
            </linearGradient>
            <linearGradient id="av-beam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={COLORS.cyan} stopOpacity="0.0" />
              <stop offset="0.6" stopColor={COLORS.cyan} stopOpacity="0.22" />
              <stop offset="1" stopColor={COLORS.violet} stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="av-ring" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={COLORS.cyan} />
              <stop offset="1" stopColor={COLORS.violet} />
            </linearGradient>
            <filter id="av-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Vertical flow lines between the stages (dashes travel downward while that stage is active). */}
          {[
            { y1: Y_INTAKE + 28, y2: Y_CAL - 28, on: phase >= 0 && phase <= 1 },
            { y1: Y_CAL + 28, y2: SYN_TOP - 26, on: phase >= 1 && phase <= 2 },
            { y1: synY(n - 1, n) + 22, y2: Y_FUNNEL - 36, on: phase >= 3 },
          ].map((l, i) => (
            <line
              key={i}
              x1={CX} x2={CX} y1={l.y1} y2={l.y2}
              stroke={COLORS.cyan} strokeWidth="1.6" strokeLinecap="round"
              strokeDasharray="2 9"
              className={l.on ? "av-flow" : undefined}
              opacity={l.on ? 0.85 : 0.22}
            />
          ))}

          {/* INTAKE layer: the prompt as a lattice of hexagons. */}
          <g data-layer="intake" className="av-bob" style={{ animationDelay: "0s" }}>
            <g transform={ISO(CX, Y_INTAKE)}>
              <rect x={-S / 2} y={-S / 2} width={S} height={S} rx="10" fill="url(#av-layer)" stroke={phase === 0 ? COLORS.cyan : "rgba(255,255,255,0.18)"} strokeWidth={phase === 0 ? 2 : 1} filter={phase === 0 ? "url(#av-glow)" : undefined} />
            </g>
            <g transform={ISO(CX, Y_INTAKE)} opacity={phase === 0 ? 1 : 0.55}>
              {Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => (
                <polygon
                  key={`${r}-${c}`}
                  points={hexPoints(-S / 2 + 22 + c * 34 + (r % 2 ? 17 : 0), -S / 2 + 24 + r * 31, 12)}
                  fill={phase === 0 && (r + c) % 3 === 0 ? "rgba(34,211,238,0.28)" : "rgba(255,255,255,0.04)"}
                  stroke="rgba(148,163,184,0.45)" strokeWidth="1"
                  className={phase === 0 ? "av-twinkle" : undefined}
                  style={{ animationDelay: `${((r * 5 + c) % 7) * 0.22}s` }}
                />
              )))}
            </g>
          </g>

          {/* CALIBRATION layer: a hex grid; four cells are the real quality checks. */}
          <g data-layer="calibration" className="av-bob" style={{ animationDelay: "0.4s" }}>
            <g transform={ISO(CX, Y_CAL)}>
              <rect x={-S / 2} y={-S / 2} width={S} height={S} rx="10" fill="url(#av-layer)" stroke={phase === 1 ? COLORS.cyan : "rgba(255,255,255,0.18)"} strokeWidth={phase === 1 ? 2 : 1} filter={phase === 1 ? "url(#av-glow)" : undefined} />
            </g>
            <g transform={ISO(CX, Y_CAL)} opacity={phase >= 1 ? 1 : 0.4}>
              {Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => {
                const idx = r * 5 + c;
                const checkIdx = [6, 8, 16, 18].indexOf(idx);
                const check = checkIdx >= 0 ? checks[checkIdx] : undefined;
                const fill = check
                  ? CHECK_COLOR[phase >= 3 ? check.status : check.status === "pending" ? "pending" : check.status]
                  : phase === 1 && idx % 4 === 0 ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.04)";
                return (
                  <polygon
                    key={idx}
                    data-check={check?.id}
                    points={hexPoints(-S / 2 + 22 + c * 34 + (r % 2 ? 17 : 0), -S / 2 + 24 + r * 31, 12)}
                    fill={fill}
                    fillOpacity={check ? 0.75 : 1}
                    stroke="rgba(148,163,184,0.45)" strokeWidth="1"
                    className={phase === 1 && !check ? "av-twinkle" : undefined}
                    style={{ animationDelay: `${(idx % 6) * 0.25}s` }}
                  />
                );
              }))}
            </g>
          </g>

          {/* SYNTHESIS layers: one per real page; its bars are that page's real sections. */}
          {shown.map((p, i) => {
            const y = synY(i, n);
            const active = phase === 2;
            const merging = phase >= 3;
            const visible = phase >= 2;
            const dy = merging ? Y_FUNNEL - 6 - y : 0;
            const scale = merging ? 0.22 : 1;
            const secs = p.sections.slice(0, 8);
            const slot = secs.length ? (S - 28) / secs.length : 0;
            return (
              <g
                key={p.slug}
                data-layer="page"
                data-page={p.slug}
                className="av-page"
                style={{
                  transformOrigin: `${CX}px ${y}px`,
                  transform: `translateY(${dy}px) scale(${scale})`,
                  opacity: !visible ? 0 : phase >= 4 ? 0 : merging ? 0.9 : 1,
                  transitionDelay: `${merging ? i * 0.16 : i * 0.12}s`,
                }}
              >
                <g transform={ISO(CX, y)}>
                  <rect x={-S / 2} y={-S / 2} width={S} height={S} rx="10" fill="url(#av-layer)" stroke={active ? COLORS.cyan : merging ? COLORS.green : "rgba(255,255,255,0.18)"} strokeWidth={active || merging ? 2 : 1} filter={active ? "url(#av-glow)" : undefined} />
                  {secs.map((t, k) => (
                    <rect
                      key={k}
                      className={active ? "av-fill" : undefined}
                      style={{ animationDelay: `${i * 0.18 + k * 0.14}s` }}
                      x={-S / 2 + 14}
                      y={-S / 2 + 14 + k * slot}
                      width={(S - 28) * (t === "hero" ? 1 : t === "cta" ? 0.72 : t === "gallery" ? 0.9 : 0.82)}
                      height={Math.max(6, slot - 7)}
                      rx="3"
                      fill={colorFor(t)}
                      fillOpacity="0.55"
                    />
                  ))}
                  {!secs.length && <rect x={-S / 2 + 14} y={-S / 2 + 14} width={S - 28} height={S - 28} rx="6" fill="none" stroke="rgba(255,255,255,0.18)" strokeDasharray="4 5" />}
                </g>
                {/* Page number badge on the diamond's right corner: matches the card. */}
                <g transform={`translate(${CX + HALF + 4} ${y})`}>
                  <circle r="10" fill="#0b1226" stroke={merging ? COLORS.green : COLORS.cyan} strokeWidth="1.5" />
                  <text textAnchor="middle" dominantBaseline="central" fontSize="10" fill="#e2e8f0" fontWeight="700">{i + 1}</text>
                </g>
              </g>
            );
          })}

          {/* VORTEX: the funnel the page layers fall through. */}
          <g data-layer="vortex">
            <polygon points={`${CX - 96},${Y_FUNNEL - 34} ${CX + 96},${Y_FUNNEL - 34} ${CX + 22},${FRAME.y - 6} ${CX - 22},${FRAME.y - 6}`} fill="url(#av-beam)" opacity={phase >= 3 ? 1 : 0.4} />
            {Array.from({ length: 5 }, (_, k) => {
              const rx = 92 - k * 15;
              return (
                <ellipse
                  key={k} cx={CX} cy={Y_FUNNEL - 28 + k * 17} rx={rx} ry={rx * 0.27}
                  fill="none" stroke="url(#av-ring)" strokeWidth={k === 0 ? 2.2 : 1.6}
                  strokeDasharray={k % 2 ? "26 14" : "46 10"}
                  className={phase >= 3 ? (k % 2 ? "av-spin-rev" : "av-spin") : undefined}
                  opacity={phase >= 3 ? 0.95 - k * 0.1 : 0.32}
                  filter={phase >= 3 && k === 0 ? "url(#av-glow)" : undefined}
                />
              );
            })}
          </g>

          {/* OUTPUT: the site frame; its bars are every page's sections stacked into one site. */}
          <g
            data-layer="output"
            style={{
              transformOrigin: `${CX}px ${FRAME.y}px`,
              transform: phase >= 4 ? "translateY(0) scale(1)" : "translateY(-30px) scale(0.5)",
              opacity: phase >= 4 ? 1 : 0,
              transition: "transform 0.9s cubic-bezier(.2,.8,.2,1) 0.5s, opacity 0.7s ease 0.5s",
            }}
          >
            <rect x={FRAME.x} y={FRAME.y} width={FRAME.w} height={FRAME.h} rx="9" fill="#0b1226" stroke={COLORS.green} strokeWidth="1.6" filter="url(#av-glow)" />
            <rect x={FRAME.x} y={FRAME.y} width={FRAME.w} height="13" rx="9" fill="rgba(255,255,255,0.06)" />
            {[0, 1, 2].map((d) => <circle key={d} cx={FRAME.x + 11 + d * 9} cy={FRAME.y + 6.5} r="2.3" fill={["#fb7185", "#fbbf24", "#34d399"][d]} />)}
            {allSections.map((s, k) => {
              const areaH = FRAME.h - 22;
              const rowH = Math.min(9, areaH / allSections.length);
              return (
                <rect
                  key={k}
                  x={FRAME.x + 10} y={FRAME.y + 18 + k * (areaH / allSections.length)}
                  width={(FRAME.w - 20) * (s.t === "hero" ? 1 : 0.84)}
                  height={Math.max(3, rowH - 2)} rx="2"
                  fill={colorFor(s.t)} fillOpacity="0.7"
                />
              );
            })}
          </g>

          {/* Stage labels with leader lines, as in the reference. */}
          {[
            { label: "Intake", y: Y_INTAKE, p: 0 },
            { label: "Calibration", y: Y_CAL, p: 1 },
            { label: "Synthesis", y: SYN_TOP + SYN_SPAN / 2, p: 2 },
            { label: "Synchronization", y: Y_FUNNEL - 30, p: 3 },
            { label: "Vortex", y: FRAME.y + FRAME.h / 2, p: 4 },
          ].map((l) => {
            const done = phase > l.p;
            const active = phase === l.p;
            return (
              <g key={l.label} data-stage={l.label} data-stage-state={done ? "done" : active ? "active" : "pending"}>
                <line x1="8" x2={CX - HALF - 14} y1={l.y + 13} y2={l.y + 13} stroke={active ? COLORS.cyan : "rgba(255,255,255,0.14)"} strokeWidth="1" />
                <text x="8" y={l.y + 4} fontSize="15" fontWeight={active ? 700 : 500} fill={active ? "#e0faff" : done ? "#94a3b8" : "#64748b"}>
                  {done ? "✓ " : ""}{l.label}
                </text>
                {active && l.p < 4 && (
                  <text x="8" y={l.y + 29} fontSize="10.5" letterSpacing="1.2" fill={COLORS.cyan} className="av-blink">
                    {(statusText ?? "COMPILE TRACE ACTIVE").toUpperCase().replace(/…$/, "")}…
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* The real pages. */}
        <ol aria-label="Pages in this site" className={cn("grid gap-2 w-full", compact ? "grid-cols-2" : "md:max-w-[250px] md:grid-cols-1")}>
          {shown.map((p, i) => {
            const stateLabel = real ? CARD_STATE_LABEL[state] : "Planning";
            const merged = real && state === "merged";
            return (
              <li
                key={p.slug}
                data-card={p.slug}
                data-card-state={real ? state : "planning"}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2 min-w-0 transition-colors duration-500",
                  merged ? "border-emerald-400/50 bg-emerald-400/[0.07]" : state === "building" || state === "merging" ? "border-cyan-400/40 bg-cyan-400/[0.05]" : "border-white/10 bg-white/[0.03]",
                  !real && "border-dashed",
                )}
              >
                <span className={cn("h-6 w-6 shrink-0 rounded-full border text-[11px] font-bold flex items-center justify-center", merged ? "border-emerald-400 text-emerald-300" : "border-cyan-400/60 text-cyan-200")}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-white">{p.title}</span>
                  <span className="block truncate text-[10px] text-slate-400">
                    {real ? `${p.sections.length} section${p.sections.length === 1 ? "" : "s"}` : "waiting for the outline"}
                  </span>
                </span>
                <span className={cn("shrink-0 text-[9px] font-mono uppercase tracking-wider", merged ? "text-emerald-300" : "text-cyan-300/90")}>{stateLabel}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <p data-testid="assembly-caption" aria-live="polite" className="mt-3 text-center text-[11px] font-mono uppercase tracking-[0.2em] text-cyan-200/80">
        {phase >= 4 ? `Assembled · ${totals.pages} page${totals.pages === 1 ? "" : "s"} · ${totals.sections} section${totals.sections === 1 ? "" : "s"}` : caption}
      </p>
    </div>
  );
}

// Motion is opt-in: with prefers-reduced-motion the visual still shows every
// state, it just doesn't animate between them.
const AV_CSS = `
.av-root .av-page { transition: transform 1.1s cubic-bezier(.65,0,.35,1), opacity .7s ease; }
@media (prefers-reduced-motion: no-preference) {
  .av-root .av-bob { animation: av-bob 5.5s ease-in-out infinite; }
  .av-root .av-flow { animation: av-flow 1.1s linear infinite; }
  .av-root .av-twinkle { animation: av-twinkle 2.2s ease-in-out infinite; }
  .av-root .av-spin { animation: av-spin 7s linear infinite; transform-box: fill-box; transform-origin: center; }
  .av-root .av-spin-rev { animation: av-spin 9s linear infinite reverse; transform-box: fill-box; transform-origin: center; }
  .av-root .av-fill { animation: av-fill .7s ease-out both; }
  .av-root .av-blink { animation: av-blink 1.4s ease-in-out infinite; }
}
@media (prefers-reduced-motion: reduce) {
  .av-root .av-page { transition: none; }
}
@keyframes av-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes av-flow { to { stroke-dashoffset: -22; } }
@keyframes av-twinkle { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes av-spin { to { stroke-dashoffset: -112; } }
@keyframes av-fill { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
@keyframes av-blink { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
`;

import { ArrowRight, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// First-value onboarding: the one window a new user sees before anything else. The picture is the product in one glance:
// on the left one request splits into five messy AI answers, on the right those five lanes merge into one clean, checked result.

const MESSY = [
  { y: 26, color: "#fb7185", d: "M70 110 C 110 110, 120 20, 160 40 S 220 10, 286 26" },
  { y: 68, color: "#f59e0b", d: "M70 110 C 105 110, 130 120, 170 60 S 230 95, 286 68" },
  { y: 110, color: "#a78bfa", d: "M70 110 C 110 110, 125 160, 175 105 S 225 70, 286 110" },
  { y: 152, color: "#f97316", d: "M70 110 C 110 110, 115 70, 165 170 S 235 140, 286 152" },
  { y: 194, color: "#94a3b8", d: "M70 110 C 105 110, 140 210, 180 180 S 240 215, 286 194" },
];
const CLEAN_Y = [26, 68, 110, 152, 194];

export function LaneVisual() {
  return (
    <svg viewBox="0 0 640 220" className="h-auto w-full" role="img" aria-label="One request splits into five messy AI answers; NazAI merges them into one clean, checked result" data-testid="first-value-visual">
      <defs>
        <linearGradient id="fv-clean" x1="0" x2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <filter id="fv-glow" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Left: one lane in, five messy lanes out */}
      <line x1="16" y1="110" x2="70" y2="110" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="110" r="5" fill="#e2e8f0" />
      {MESSY.map((l, i) => (
        <g key={l.y}>
          <path d={l.d} fill="none" stroke={l.color} strokeOpacity="0.85" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={i % 2 ? "7 6" : "3 5"} className="fv-messy" style={{ animationDelay: `${i * -0.35}s` }} />
          <circle cx="286" cy={l.y} r="3.5" fill={l.color} />
        </g>
      ))}
      {/* small warning marks on two of the messy answers */}
      {[{ x: 168, y: 52 }, { x: 196, y: 172 }].map((m) => (
        <g key={m.x} transform={`translate(${m.x} ${m.y})`}>
          <circle r="7" fill="#1f0a10" stroke="#fb7185" strokeWidth="1.5" />
          <path d="M-2.5 -2.5 L2.5 2.5 M2.5 -2.5 L-2.5 2.5" stroke="#fb7185" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      ))}

      {/* Middle: NazAI */}
      <g filter="url(#fv-glow)">
        <rect x="298" y="78" width="44" height="64" rx="12" fill="#04101f" stroke="#22d3ee" strokeOpacity="0.8" strokeWidth="1.5" />
      </g>
      <path d="M320 94 l10 4 v8 c0 7 -4.5 11.5 -10 13.5 c-5.5 -2 -10 -6.5 -10 -13.5 v-8 z" fill="#22d3ee" fillOpacity="0.15" stroke="#67e8f9" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M315.5 106 l3 3 l6 -6" fill="none" stroke="#67e8f9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="320" y="134" textAnchor="middle" fontSize="8.5" fontFamily="ui-monospace, monospace" letterSpacing="1" fill="#67e8f9">NAZAI</text>

      {/* Right: five lanes merge into one clean lane */}
      {CLEAN_Y.map((y, i) => (
        <path key={y} d={`M354 ${y} C 430 ${y}, 470 110, 560 110`} fill="none" stroke="#22d3ee" strokeOpacity={0.3 + i * 0.05} strokeWidth="2" strokeLinecap="round" />
      ))}
      {CLEAN_Y.map((y) => <circle key={`c${y}`} cx="354" cy={y} r="3" fill="#22d3ee" fillOpacity="0.7" />)}
      <line x1="560" y1="110" x2="606" y2="110" stroke="url(#fv-clean)" strokeWidth="5" strokeLinecap="round" filter="url(#fv-glow)" />
      <line x1="354" y1="110" x2="606" y2="110" stroke="#ecfeff" strokeOpacity="0.9" strokeWidth="2" strokeDasharray="2 14" strokeLinecap="round" className="fv-clean" />
      <g transform="translate(618 110)" filter="url(#fv-glow)">
        <circle r="11" fill="#052e2b" stroke="#34d399" strokeWidth="2" />
        <path d="M-4.5 0 l3 3 l6 -6" fill="none" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export default function FirstValueWelcome({ open, onStart, onSkip }: { open: boolean; onStart: () => void; onSkip: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onSkip(); }}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-2xl gap-0 overflow-hidden border-cyan-400/25 bg-[#030a17] p-0 text-white shadow-[0_0_90px_-20px_rgba(34,211,238,0.45)] sm:rounded-2xl [&>button]:hidden"
        data-testid="first-value-welcome"
      >
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-cyan-500/15 blur-[90px] oc-glow" aria-hidden />
        <div className="pointer-events-none absolute -right-20 bottom-0 h-56 w-56 rounded-full bg-emerald-400/10 blur-[90px] oc-glow" aria-hidden />

        <div className="relative border-b border-white/5 bg-gradient-to-b from-white/[0.03] to-transparent px-5 pb-4 pt-6 sm:px-8">
          <LaneVisual />
          <div className="mt-2 grid grid-cols-2 gap-4 font-mono text-[10px] uppercase tracking-[0.16em]">
            <span className="text-rose-300/80">Many AI tools · messy answers</span>
            <span className="text-right text-cyan-300">One checked result</span>
          </div>
        </div>

        <div className="relative px-5 pb-6 pt-6 text-center sm:px-8 sm:pb-8">
          <div className="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/[0.08] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200">
            <ShieldCheck className="h-3.5 w-3.5" /> Welcome to NazAI
          </div>
          <DialogTitle className="text-2xl font-bold tracking-tight sm:text-3xl">Try your first controlled AI task</DialogTitle>
          <DialogDescription className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
            Ask for anything. NazAI checks every AI reply against your rules and hands you one clean result.
          </DialogDescription>
          <button
            type="button"
            onClick={onStart}
            autoFocus
            className="group mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-7 py-3 text-sm font-semibold text-[#03121a] shadow-[0_0_30px_-4px_rgba(34,211,238,0.7)] transition hover:shadow-[0_0_44px_-2px_rgba(34,211,238,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
            data-testid="first-value-start"
          >
            Start now <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <div className="mt-4">
            <button type="button" onClick={onSkip} className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline" data-testid="first-value-skip">
              Skip, show me everything
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

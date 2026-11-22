// Homepage demo of Clean it (Context Day 2): what an AI wrote, and the one clean result NazAI gives back, with what was found.
// The examples are illustrations, written here; nothing is sent anywhere.
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";

type Seg = { t: string; mark?: boolean };
type Demo = { source: string; before: Seg[]; after: Seg[]; found: { kind: "Rule" | "Your context" | "Built-in"; name: string }[] };

const CLEAN_DEMOS: Demo[] = [
  {
    source: "ChatGPT",
    before: [{ t: "Thanks for your order! It " }, { t: "will arrive tomorrow, guaranteed", mark: true }, { t: ". Refunds are possible " }, { t: "anytime", mark: true }, { t: "." }],
    after: [{ t: "Thanks for your order. " }, { t: "We will email you the tracking link as soon as it ships", mark: true }, { t: ". Refunds are possible " }, { t: "within 30 days of delivery", mark: true }, { t: "." }],
    found: [{ kind: "Rule", name: "No delivery promises" }, { kind: "Your context", name: "Refunds within 30 days" }],
  },
  {
    source: "Claude",
    before: [{ t: "Our Pro plan is " }, { t: "$49 a month", mark: true }, { t: " and includes " }, { t: "unlimited seats!!!", mark: true }],
    after: [{ t: "Our Pro plan is " }, { t: "$59 a month", mark: true }, { t: " and includes " }, { t: "up to 5 seats.", mark: true }],
    found: [{ kind: "Your context", name: "Pro: $59, 5 seats" }, { kind: "Rule", name: "No exclamation marks" }],
  },
  {
    source: "Gemini",
    before: [{ t: "Sure, here is the client's card: " }, { t: "4242 4242 4242 4242", mark: true }, { t: ". I will email it to the team." }],
    after: [{ t: "The client's payment is on file. " }, { t: "Card details are never shared by email.", mark: true }],
    found: [{ kind: "Built-in", name: "Card number hidden" }],
  },
];

const KIND = { Rule: "border-amber-300/30 text-amber-200", "Your context": "border-cyan-300/30 text-cyan-200", "Built-in": "border-rose-300/30 text-rose-200" } as const;

export default function CleanItDemo({ onTry }: { onTry: () => void }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (reduce || paused) return;
    const t = setInterval(() => setI((n) => (n + 1) % CLEAN_DEMOS.length), 6000);
    return () => clearInterval(t);
  }, [reduce, paused]);
  const d = CLEAN_DEMOS[i];

  return (
    <div
      className="relative rounded-2xl border border-[#22c55e]/30 bg-[#020617]/80 backdrop-blur-xl overflow-hidden text-left"
      style={{ boxShadow: "0 0 60px rgba(34,197,94,0.15), inset 0 0 40px rgba(0,0,0,0.4)" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-testid="home-clean-demo"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/5 bg-black/40">
        <div className="flex items-center gap-1" role="tablist" aria-label="Examples">
          {CLEAN_DEMOS.map((x, n) => (
            <button key={x.source} type="button" role="tab" aria-selected={n === i} onClick={() => setI(n)}
              className={`px-2 py-0.5 rounded-md text-[9px] tracking-[0.2em] uppercase font-bold transition-colors ${n === i ? "bg-white/10 text-white" : "text-white/35 hover:text-white/70"}`}>
              {x.source}
            </button>
          ))}
        </div>
        <span className="hidden sm:inline text-[8px] tracking-[0.4em] uppercase text-white/40 font-bold">nazai // clean_it</span>
        <span className="text-[8px] text-[#22c55e] font-bold whitespace-nowrap">● CONTROLLED</span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={i} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }} transition={{ duration: 0.35 }}
          className="grid md:grid-cols-2">
          <div className="p-5 md:p-6 border-b md:border-b-0 md:border-r border-white/5">
            <div className="text-[9px] tracking-[0.3em] text-white/30 mb-3 uppercase font-bold">{">"} pasted from {d.source}</div>
            <p className="text-[13px] md:text-sm leading-relaxed text-white/60" data-testid="home-demo-before">
              {d.before.map((s, n) => s.mark
                ? <span key={n} className="text-rose-200/90 line-through decoration-rose-400/70 decoration-2">{s.t}</span>
                : <span key={n}>{s.t}</span>)}
            </p>
          </div>
          <div className="p-5 md:p-6 bg-[#22c55e]/[0.03]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] tracking-[0.3em] text-[#22c55e]/80 uppercase font-bold">{">"} one clean result</span>
              <span className="inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase text-[#22c55e] font-bold"><Check size={11} /> checked again</span>
            </div>
            <p className="text-[13px] md:text-sm leading-relaxed text-white" data-testid="home-demo-after">
              {d.after.map((s, n) => s.mark
                ? <span key={n} className="bg-[#22c55e]/10 text-[#86efac] rounded px-0.5 shadow-[inset_0_-1px_0_rgba(34,197,94,0.6)]">{s.t}</span>
                : <span key={n}>{s.t}</span>)}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2 px-4 md:px-5 py-3 border-t border-white/5 bg-black/30">
        {d.found.map((f) => (
          <span key={f.name} className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${KIND[f.kind]}`} style={{ fontFamily: "'Inter', sans-serif" }}>
            <span className="opacity-60">{f.kind} · </span>{f.name}
          </span>
        ))}
        <button type="button" onClick={onTry} className="ml-auto text-[10px] tracking-[0.2em] uppercase font-bold text-[#22c55e] hover:text-white transition-colors">
          Try it with your AI →
        </button>
      </div>
    </div>
  );
}

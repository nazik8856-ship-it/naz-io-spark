import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Heart, ShieldCheck, Sparkles, X, ExternalLink, TrendingUp } from "lucide-react";

type Testimonial = {
  id: string;
  name: string;
  role: string;
  company: string;
  companyUrl?: string;
  initials: string;
  accent: string; // avatar gradient base
  metric: string; // headline business metric
  match: number; // Neural Match %
  quote: string;
  prompt: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    id: "t1",
    name: "Maya Rodriguez",
    role: "Founder",
    company: "LedgerLoop",
    companyUrl: "https://ledgerloop.com",
    initials: "MR",
    accent: "from-[#06b6d4] to-[#0891b2]",
    metric: "Saved 22 hrs/week on ops",
    match: 99.2,
    quote: "Spun up our entire ops dashboard, brand kit and pricing page in one prompt. Zero handoff to designers or devs.",
    prompt: "Launch a fintech SaaS for small-business invoicing with a free tier and Stripe billing.",
  },
  {
    id: "t2",
    name: "Devon Keller",
    role: "Solo Builder",
    company: "Keller Studio",
    initials: "DK",
    accent: "from-[#22c55e] to-[#15803d]",
    metric: "Shipped MVP in 3 days",
    match: 96.8,
    quote: "The Brand-Snap canvas auto-corrected three layout traps I would've shipped. Felt like a senior designer pairing with me.",
    prompt: "Generate a portfolio site for a motion designer with case studies and a contact funnel.",
  },
  {
    id: "t3",
    name: "Priya Sharma",
    role: "Ops Lead",
    company: "NorthBeam",
    companyUrl: "https://northbeam.io",
    initials: "PS",
    accent: "from-[#f5c451] to-[#d4a017]",
    metric: "Cut planning time 87%",
    match: 98.4,
    quote: "Our 12-month cash-flow model and hiring plan landed in the Vault before our standup ended.",
    prompt: "Build a 12-month cash flow model and hiring plan for a 14-person consultancy.",
  },
  {
    id: "t4",
    name: "Alex Nguyen",
    role: "Indie Developer",
    company: "Pixelmint",
    initials: "AN",
    accent: "from-[#a855f7] to-[#7c3aed]",
    metric: "Saved 18 hrs/week",
    match: 94.1,
    quote: "Asset Synthesis nailed our palette on the first pass. Every iteration archived to the Vault — replayable any time.",
    prompt: "Create a marketing site for an indie iOS app, dark mode, with App Store deeplinks.",
  },
  {
    id: "t5",
    name: "Jordan Tate",
    role: "Head of Growth",
    company: "Helio",
    companyUrl: "https://helio.app",
    initials: "JT",
    accent: "from-[#ec4899] to-[#be185d]",
    metric: "200 SEO pages in one afternoon",
    match: 97.5,
    quote: "Mission Briefs are a cheat code — I can replay any successful generation with one click and tweak the prompt.",
    prompt: "Draft a programmatic SEO plan for 200 city-pages plus the landing template to host them.",
  },
  {
    id: "t6",
    name: "Sana Malik",
    role: "Product Manager",
    company: "Quartzlab",
    companyUrl: "https://quartzlab.co",
    initials: "SM",
    accent: "from-[#06b6d4] to-[#22c55e]",
    metric: "GTM memo used verbatim",
    match: 99.7,
    quote: "Calibration against billion-dollar playbooks isn't marketing fluff — the strategy memo was usable as written.",
    prompt: "Produce a go-to-market memo for a vertical AI agent in legal-ops with a 90-day rollout.",
  },
];

// ── Animated Neural Match counter ──────────────────────────────────────────────
// Defaults to the target value so cards never look broken; re-animates from 0 on hover.
const MatchCounter: React.FC<{ target: number; active: boolean }> = ({ target, active }) => {
  const v = useMotionValue(target);
  const display = useTransform(v, (n) => `${n.toFixed(1)}% Match`);

  useEffect(() => {
    if (active) {
      v.set(0);
      const controls = animate(v, target, { duration: 1.2, ease: [0.22, 1, 0.36, 1] });
      return controls.stop;
    }
  }, [active, target, v]);

  return (
    <motion.span
      className="text-[10px] font-bold tracking-wider"
      style={{ fontFamily: "'JetBrains Mono', monospace", color: "#06b6d4" }}
    >
      {display}
    </motion.span>
  );
};

// ── Confetti burst on Like ─────────────────────────────────────────────────────
const ConfettiBurst: React.FC<{ trigger: number }> = ({ trigger }) => {
  const [bursts, setBursts] = useState<{ id: number; pieces: { dx: number; dy: number; r: number }[] }[]>([]);

  useEffect(() => {
    if (!trigger) return;
    const pieces = Array.from({ length: 14 }).map(() => ({
      dx: (Math.random() - 0.5) * 140,
      dy: -40 - Math.random() * 80,
      r: (Math.random() - 0.5) * 200,
    }));
    const id = Date.now();
    setBursts((b) => [...b, { id, pieces }]);
    const t = setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 900);
    return () => clearTimeout(t);
  }, [trigger]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {bursts.map((b) => (
        <div key={b.id} className="absolute left-1/2 top-1/2">
          {b.pieces.map((p, i) => (
            <motion.span
              key={i}
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
              animate={{ x: p.dx, y: p.dy, opacity: 0, rotate: p.r }}
              transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
              className="absolute block"
              style={{
                width: 6,
                height: 6,
                background: i % 2 === 0 ? "#06b6d4" : "#22d3ee",
                borderRadius: 1,
                boxShadow: "0 0 8px #06b6d4",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

// ── Single card with shimmer + verify glow ─────────────────────────────────────
const Card: React.FC<{ t: Testimonial; onOpen: () => void }> = ({ t, onOpen }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [likes, setLikes] = useState(0);
  const [burstTrigger, setBurstTrigger] = useState(0);
  const [shimmer, setShimmer] = useState({ x: 50, y: 50 });

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setShimmer({
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    });
  };

  const onLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLikes((n) => n + 1);
    setBurstTrigger((n) => n + 1);
  };

  return (
    <motion.button
      ref={ref}
      onClick={onOpen}
      onMouseMove={onMove}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      className="relative shrink-0 w-[320px] md:w-[360px] text-left rounded-2xl border bg-white/[0.02] backdrop-blur-xl p-5 overflow-hidden"
      style={{
        borderColor: "rgba(6,182,212,0.25)",
        boxShadow: hover
          ? "0 0 28px rgba(6,182,212,0.25), inset 0 0 24px rgba(6,182,212,0.05)"
          : "0 0 14px rgba(6,182,212,0.10)",
      }}
    >
      {/* Pulsing verify ring */}
      <motion.div
        aria-hidden
        className="absolute -inset-px rounded-2xl pointer-events-none"
        animate={{ opacity: [0.25, 0.55, 0.25] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        style={{
          border: "1px solid rgba(6,182,212,0.45)",
          borderRadius: 16,
        }}
      />

      {/* Glass shimmer that follows the mouse */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(220px circle at ${shimmer.x}% ${shimmer.y}%, rgba(6,182,212,0.18), transparent 60%)`,
          mixBlendMode: "screen",
          opacity: hover ? 1 : 0,
          transition: "opacity 220ms ease",
        }}
      />

      {/* Verified badge */}
      <div className="relative flex items-center justify-between mb-4">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[#06b6d4]/40 bg-[#06b6d4]/10 text-[#06b6d4]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <ShieldCheck size={10} />
          <span className="text-[9px] font-black tracking-[0.2em] uppercase">Verified Mission</span>
        </span>
        <MatchCounter target={t.match} active={hover} />
      </div>

      {/* Quote */}
      <p
        className="relative text-[13px] leading-relaxed text-white/85 mb-4"
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        "{t.quote}"
      </p>

      {/* Metric badge */}
      <div
        className="relative inline-flex items-center gap-1.5 mb-5 px-2.5 py-1 rounded-md border border-[#22c55e]/30 bg-[#22c55e]/5"
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        <TrendingUp size={11} className="text-[#22c55e]" />
        <span className="text-[11px] font-semibold text-[#22c55e]">{t.metric}</span>
      </div>

      {/* Author row */}
      <div className="relative flex items-end justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar — abstract gradient with initials */}
          <div
            className={`shrink-0 w-10 h-10 rounded-full bg-gradient-to-br ${t.accent} flex items-center justify-center text-white text-[11px] font-bold shadow-[0_0_16px_rgba(6,182,212,0.25)]`}
            style={{ fontFamily: "'Inter', sans-serif" }}
            aria-hidden
          >
            {t.initials}
          </div>
          <div className="min-w-0">
            <p
              className="text-[12px] font-semibold text-white truncate"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              {t.name}
            </p>
            <p
              className="text-[11px] text-white/45 truncate flex items-center gap-1"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              <span>{t.role} ·</span>
              {t.companyUrl ? (
                <a
                  href={t.companyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-[#06b6d4]/80 hover:text-[#06b6d4] transition-colors"
                >
                  {t.company}
                  <ExternalLink size={9} />
                </a>
              ) : (
                <span>{t.company}</span>
              )}
            </p>
          </div>
        </div>

        <div className="relative shrink-0">
          <ConfettiBurst trigger={burstTrigger} />
          <button
            onClick={onLike}
            className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/10 hover:border-[#06b6d4]/40 hover:bg-[#06b6d4]/10 transition-all"
            aria-label="Upvote testimonial"
          >
            <Heart size={11} className={likes > 0 ? "text-[#06b6d4] fill-[#06b6d4]" : "text-white/60"} />
            <span
              className="text-[11px] tabular-nums text-white/70"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {likes}
            </span>
          </button>
        </div>
      </div>
    </motion.button>
  );
};

// ── Marquee with pause on hover ────────────────────────────────────────────────
const NeuralFeedback: React.FC = () => {
  const navigate = useNavigate();
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<Testimonial | null>(null);

  // Duplicate list so the loop is seamless
  const loop = [...TESTIMONIALS, ...TESTIMONIALS];

  return (
    <section
      id="neural-feedback"
      data-cursor-trail
      className="relative py-20 md:py-24 px-6 md:px-8 border-t border-white/5 overflow-hidden"
    >
      <div className="max-w-6xl mx-auto mb-10">
        <div className="flex items-center gap-3 mb-3">
          <Sparkles size={14} className="text-[#06b6d4]" />
          <span
            className="text-[10px] tracking-[0.5em] text-[#06b6d4] font-black uppercase"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            Neural Feedback
          </span>
        </div>
        <h3
          className="text-2xl md:text-4xl font-black tracking-tight text-white"
          style={{ fontFamily: "'Inter', sans-serif" }}
        >
          Verified missions, calibrated by operators.
        </h3>
        <p
          className="text-[13px] text-white/50 mt-2 max-w-xl"
          style={{ fontFamily: "'Inter', sans-serif" }}
        >
          Hover to pause. Click any card to inspect the original Mission Brief.
        </p>
      </div>

      {/* Marquee track */}
      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        style={{
          maskImage:
            "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
        }}
      >
        <motion.div
          className="flex gap-5 w-max py-4"
          animate={{ x: paused ? undefined : ["0%", "-50%"] }}
          transition={{
            duration: 48,
            ease: "linear",
            repeat: Infinity,
          }}
        >
          {loop.map((t, i) => (
            <Card key={`${t.id}-${i}`} t={t} onOpen={() => setOpen(t)} />
          ))}
        </motion.div>
      </div>

      {/* Mission Brief modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
            className="fixed inset-0 z-[200] flex items-center justify-center p-6"
            style={{ background: "rgba(2,6,23,0.78)", backdropFilter: "blur(8px)" }}
          >
            <motion.div
              initial={{ y: 30, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-lg rounded-2xl border border-[#06b6d4]/40 bg-[#020617] p-7"
              style={{ boxShadow: "0 0 60px rgba(6,182,212,0.25)" }}
            >
              <button
                onClick={() => setOpen(null)}
                className="absolute top-3 right-3 p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/5"
                aria-label="Close mission brief"
              >
                <X size={16} />
              </button>

              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={14} className="text-[#06b6d4]" />
                <span
                  className="text-[9px] font-black tracking-[0.4em] uppercase text-[#06b6d4]"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  Mission Brief
                </span>
              </div>

              <div className="flex items-center gap-3 mb-2">
                <div
                  className={`shrink-0 w-12 h-12 rounded-full bg-gradient-to-br ${open.accent} flex items-center justify-center text-white text-sm font-bold shadow-[0_0_20px_rgba(6,182,212,0.3)]`}
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {open.initials}
                </div>
                <div>
                  <h4
                    className="text-xl font-black text-white tracking-tight leading-tight"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    {open.name}
                  </h4>
                  <p
                    className="text-[12px] text-white/50 flex items-center gap-1"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    {open.role} · {open.companyUrl ? (
                      <a
                        href={open.companyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-[#06b6d4]/80 hover:text-[#06b6d4] transition-colors"
                      >
                        {open.company}
                        <ExternalLink size={9} />
                      </a>
                    ) : open.company}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#22c55e]/30 bg-[#22c55e]/5 text-[11px] font-semibold text-[#22c55e]">
                  <TrendingUp size={11} />
                  {open.metric}
                </span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-md border border-[#06b6d4]/30 bg-[#06b6d4]/5 text-[11px] font-bold text-[#06b6d4]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  {open.match.toFixed(1)}% Match
                </span>
              </div>

              <div
                className="rounded-lg border border-white/10 bg-black/40 p-4 mb-4"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                <div className="text-[9px] tracking-[0.3em] text-white/30 mb-2 uppercase">
                  {">"} originating prompt
                </div>
                <p className="text-[12px] text-white/80 leading-relaxed">{open.prompt}</p>
              </div>

              <p
                className="text-[13px] text-white/70 leading-relaxed italic"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                "{open.quote}"
              </p>

              <button
                onClick={() => navigate("/workspace")}
                className="mt-5 w-full py-3 rounded-lg bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#020617] font-black uppercase text-[11px] tracking-[0.2em] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-shadow"
              >
                Replay this mission
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export default NeuralFeedback;

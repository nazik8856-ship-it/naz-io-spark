import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useInView, useMotionValue, useTransform, animate } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Check,
  X,
  Shield,
  Lock,
  Award,
  Globe,
  Zap,
  TrendingUp,
  Users,
  Star,
  ArrowRight,
  Sparkles,
  ChevronDown,
  Calendar,
  MessageSquare,
  Database,
  RefreshCw,
  FileCheck,
  Clock,
  Activity,
  Palette,
  Layers,
  Wand2,
  Sun,
  Minus,
} from "lucide-react";
import MagneticButton from "@/components/interactions/MagneticButton";

// ─── Animated Counter ─────────────────────────────────────────────
const Counter = ({ to, suffix = "", duration = 2 }: { to: number; suffix?: string; duration?: number }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    if (inView) {
      const controls = animate(count, to, { duration, ease: "easeOut" });
      return controls.stop;
    }
  }, [inView, to, duration, count]);

  return (
    <span ref={ref} className="tabular-nums">
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
};

// ─── Animated Price ───────────────────────────────────────────────
const AnimatedPrice = ({ value }: { value: number }) => {
  const count = useMotionValue(value);
  const rounded = useTransform(count, (v) => Math.round(v));
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const controls = animate(count, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1] });
    const unsub = rounded.on("change", (v) => setDisplay(v));
    return () => {
      controls.stop();
      unsub();
    };
  }, [value, count, rounded]);

  return <>{display}</>;
};

// ─── Background Orchestration Lines ───────────────────────────────
const OrchestrationBg = () => (
  <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
    <div
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse at top, #0c1a2e 0%, #050a14 45%, #020617 100%)",
      }}
    />
    {/* Soft glowing connection lines */}
    <svg className="absolute inset-0 w-full h-full opacity-[0.18]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
          <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="line-grad-2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f5c451" stopOpacity="0" />
          <stop offset="50%" stopColor="#f5c451" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#f5c451" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[...Array(8)].map((_, i) => (
        <motion.line
          key={i}
          x1={`${(i * 13) % 100}%`}
          y1="0%"
          x2={`${(i * 17 + 30) % 100}%`}
          y2="100%"
          stroke={i % 2 === 0 ? "url(#line-grad)" : "url(#line-grad-2)"}
          strokeWidth="1"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 6, delay: i * 0.4, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
        />
      ))}
    </svg>
    {/* Geometric soft glow nodes */}
    {[...Array(6)].map((_, i) => (
      <motion.div
        key={i}
        className="absolute rounded-full blur-3xl"
        style={{
          width: 400,
          height: 400,
          background: i % 2 === 0 ? "rgba(6,182,212,0.06)" : "rgba(245,196,81,0.04)",
          left: `${(i * 23) % 90}%`,
          top: `${(i * 31) % 80}%`,
        }}
        animate={{
          x: [0, 40, 0],
          y: [0, -30, 0],
        }}
        transition={{ duration: 18 + i * 3, repeat: Infinity, ease: "easeInOut" }}
      />
    ))}
  </div>
);

// ─── Pricing Tiers Data ───────────────────────────────────────────
const tiers = [
  {
    id: "explorer",
    name: "Explorer",
    tagline: "Test powerful orchestration on real ideas.",
    monthly: 0,
    annual: 0,
    free: true,
    cta: "Start Free — No Card Required",
    reassurance: "Free forever • No credit card • Full data export",
    power: 33,
    features: [
      "8 missions / month",
      "Core Input Sensor + basic Logic Gate",
      "Light & Dark mode switching only",
      "Dashboard with Recent Projects + basic Archives",
      "Standard execution (plans, simple deployments)",
    ],
    expanded: [
      "Up to 2 concurrent agents",
      "Community support",
      "Basic export (PDF, MD)",
      "No NazAI visual themes • No Brand-Snap Canvas • No Aura Studio",
    ],
    trust: "No card required • Cancel anytime • Full data export",
  },
  {
    id: "operator",
    name: "Operator",
    tagline: "Daily business operations and growth.",
    monthly: 34,
    annual: 25,
    popular: true,
    cta: "Upgrade to Operator",
    reassurance: "14-day free trial • Cancel anytime • No credit card required",
    power: 75,
    features: [
      "Unlimited missions & conversational orchestration",
      "Full access to NazAI visual themes",
      "Aura Studio included",
      "Advanced Logic Gate (multi-scenario, risk analysis)",
      "Up to 8 concurrent AI agents",
      "Rich Execution: websites, automations, exports, integrations",
      "Team invites (up to 5) + priority email support",
    ],
    expanded: [
      "Webhook & Zapier orchestration",
      "Custom domain deployments",
      "Advanced analytics dashboard",
      "Brand-Snap Canvas not included — upgrade to Titan for full canvas",
    ],
    trust: "30-day money-back • Upgrade/downgrade anytime",
  },
  {
    id: "titan",
    name: "Titan",
    tagline: "Scaling teams and complex enterprises.",
    monthly: 119,
    annual: 89,
    cta: "Talk to Sales — Enter Titan",
    reassurance: "30-day money-back • Concierge onboarding included",
    power: 100,
    features: [
      "Everything in Operator, truly unlimited",
      "Brand-Snap Canvas + NazAI visual themes (full design suite)",
      "Aura Studio included",
      "Fleet of 30+ concurrent agents with custom training",
      "Deep Finance, Legal, Operations & Scaling Orchestration",
      "Unlimited team seats + role-based collaboration Vault",
      "Dedicated priority support + personal strategy session",
    ],
    expanded: [
      "On-prem deployment options",
      "Custom agent training pipelines",
      "SLA-backed 99.99% uptime",
      "Audit logs + compliance reporting",
    ],
    trust: "Dedicated success manager • SOC2 Type II ready",
  },
];

const securityBadges = [
  { icon: Shield, label: "SOC2" },
  { icon: Lock, label: "GDPR" },
  { icon: Award, label: "ISO 27001" },
  { icon: Database, label: "Bank-grade Encryption" },
  { icon: FileCheck, label: "Private Data Vault" },
  { icon: X, label: "No Training on Your Data" },
  { icon: RefreshCw, label: "Third-party Audits" },
  { icon: Activity, label: "99.98% Uptime SLA" },
];

const stats = [
  { value: 14000, suffix: "+", label: "Missions successfully orchestrated" },
  { value: 92, suffix: "%", label: "Complete first mission in under 3 minutes" },
  { value: 4.2, suffix: "x", label: "Average time saved on business tasks", decimal: true },
  { value: 87, suffix: "%", label: "Report measurable impact within 30 days" },
];

const guarantees = [
  { icon: RefreshCw, title: "30-day money-back", desc: "On all paid plans, no questions asked." },
  { icon: Database, title: "Full data ownership", desc: "Export everything, anytime, in standard formats." },
  { icon: FileCheck, title: "Transparent usage", desc: "No surprise fees. Clear, predictable billing." },
  { icon: Zap, title: "Easy upgrade/downgrade", desc: "Switch tiers instantly, prorated automatically." },
];

const caseStudies = [
  {
    quote: "Solo founder launched & automated full SaaS operations in 47 minutes.",
    metric: "47 min",
    label: "from idea to live SaaS",
  },
  {
    quote: "Consulting firm orchestrated merger analysis + contracts in one afternoon.",
    metric: "1 afternoon",
    label: "vs 3 weeks traditional",
  },
  {
    quote: "Agency replaced 4 SaaS tools with NazAI's unified orchestration layer.",
    metric: "4→1",
    label: "tools consolidated",
  },
];

const comparisonRows = [
  { label: "Missions per month", values: ["8", "Unlimited", "Unlimited", "Custom"] },
  { label: "Concurrent agents", values: ["2", "8", "30+", "Unlimited"] },
  { label: "Brand-Snap Guardian", values: ["Basic", "Full", "Full + Custom", "Custom"] },
  { label: "Vault & version history", values: ["7 days", "Unlimited", "Unlimited", "Unlimited"] },
  { label: "Finance/Legal orchestration", values: [false, true, true, true] },
  { label: "Team collaboration", values: [false, "5 seats", "Unlimited", "Unlimited"] },
  { label: "Integrations & API", values: [false, "Standard", "Custom API", "White-label"] },
  { label: "Support level", values: ["Community", "Priority email", "Dedicated", "24/7 + CSM"] },
  { label: "Custom agent training", values: [false, false, true, true] },
  { label: "Audit logs", values: [false, false, true, true] },
];

const faqs = [
  {
    q: "What counts as a 'mission'?",
    a: "A mission is one orchestrated workflow — from a single prompt, NazAI may run multiple agents, generate documents, deploy assets, and execute integrations. You're billed per mission, not per agent action.",
  },
  {
    q: "Can I upgrade or downgrade anytime?",
    a: "Yes. Changes take effect immediately and are prorated to the day. No long-term contracts on Operator or Titan tiers.",
  },
  {
    q: "How is my data protected?",
    a: "All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We are SOC2 and GDPR compliant. Your data is never used to train models.",
  },
  {
    q: "Do you offer refunds?",
    a: "All paid plans include a 30-day money-back guarantee. Contact support for a full refund within the window — no questions asked.",
  },
  {
    q: "What languages do you support?",
    a: "NazAI orchestrates missions in 38+ languages. Interface is available in English, Spanish, French, German, Portuguese, Japanese, and more.",
  },
  {
    q: "Can I bring my own API keys?",
    a: "Titan and Enterprise tiers support BYOK for OpenAI, Anthropic, and Google AI. Lower tiers use NazAI's managed AI gateway.",
  },
  {
    q: "What happens if I exceed mission limits on Explorer?",
    a: "You'll be prompted to upgrade. Existing missions remain accessible — nothing is deleted or locked.",
  },
  {
    q: "Is there a free trial for paid plans?",
    a: "The Explorer tier is free forever. For Operator and Titan, the 30-day money-back guarantee acts as a risk-free trial.",
  },
  {
    q: "Do you offer educational or non-profit discounts?",
    a: "Yes — verified students, educators, and registered non-profits receive 50% off Operator and Titan tiers. Contact our team.",
  },
  {
    q: "How does team collaboration work?",
    a: "Operator includes 5 seats with shared Vault access. Titan offers unlimited seats with role-based permissions (Admin, Editor, Viewer).",
  },
  {
    q: "Can I self-host or get on-prem deployment?",
    a: "Enterprise customers can request on-prem or VPC deployments with dedicated infrastructure. Talk to our team to scope.",
  },
];

// ─── Main Pricing Page ────────────────────────────────────────────
const Pricing = () => {
  const navigate = useNavigate();
  const [annual, setAnnual] = useState(false);
  const [expandedTier, setExpandedTier] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="min-h-screen text-white font-sans relative" style={{ background: "#020617" }}>
      <OrchestrationBg />

      {/* ─── Top Nav ─── */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[#020617]/70 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="text-sm font-bold tracking-[0.2em] uppercase text-white/80 hover:text-white transition-colors"
          >
            ← NazAI
          </button>
          <div className="flex items-center gap-6 text-xs tracking-wider uppercase text-white/60">
            <a href="#tiers" className="hover:text-white transition-colors">Tiers</a>
            <a href="#trust" className="hover:text-white transition-colors hidden sm:inline">Trust</a>
            <a href="#compare" className="hover:text-white transition-colors hidden sm:inline">Compare</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>
        </div>
      </nav>

      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="relative pt-24 pb-16 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#06b6d4]/30 bg-[#06b6d4]/5 mb-8"
          >
            <Sparkles size={12} className="text-[#06b6d4]" />
            <span className="text-[11px] tracking-[0.3em] uppercase text-[#06b6d4] font-bold">
              Mission Tiers
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05] mb-6"
          >
            Choose Your <span className="bg-gradient-to-r from-[#06b6d4] to-[#f5c451] bg-clip-text text-transparent">NazAI Mission Tier</span>
            <br />
            <span className="text-white/90">— Built for Real Business Results</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-lg md:text-xl text-white/60 max-w-3xl mx-auto leading-relaxed mb-10"
          >
            From idea to full business orchestration in one prompt. Strategy, operations,
            finance, automation, and execution — all handled intelligently. Start free,
            scale with confidence.
          </motion.p>

          {/* Annual Toggle */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col items-center gap-3 mb-8"
          >
            <div className="inline-flex items-center gap-1 p-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm">
              <button
                onClick={() => setAnnual(false)}
                className={`relative px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-colors ${
                  !annual ? "text-[#020617]" : "text-white/60 hover:text-white"
                }`}
              >
                {!annual && (
                  <motion.div
                    layoutId="toggle-pill"
                    className="absolute inset-0 bg-white rounded-full"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative">Monthly</span>
              </button>
              <button
                onClick={() => setAnnual(true)}
                className={`relative px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${
                  annual ? "text-[#020617]" : "text-white/60 hover:text-white"
                }`}
              >
                {annual && (
                  <motion.div
                    layoutId="toggle-pill"
                    className="absolute inset-0 bg-gradient-to-r from-[#f5c451] to-[#f0b833] rounded-full"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative">Annual</span>
                <span
                  className={`relative text-[10px] px-2 py-0.5 rounded-full ${
                    annual ? "bg-[#020617]/20 text-[#020617]" : "bg-[#f5c451]/20 text-[#f5c451]"
                  }`}
                >
                  Save 25%
                </span>
              </button>
            </div>
            <p className="text-[11px] tracking-wider uppercase text-[#f5c451]/80">
              Unlock bonus orchestration credits + priority support
            </p>
          </motion.div>

          {/* Trust Bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] tracking-wider uppercase text-white/40"
          >
            <span className="flex items-center gap-1.5"><Users size={12} /> 8,700+ founders & teams</span>
            <span className="text-white/15">•</span>
            <span className="flex items-center gap-1.5"><Star size={12} className="text-[#f5c451]" /> 4.9/5 from 1,200+ reviews</span>
            <span className="text-white/15">•</span>
            <span className="flex items-center gap-1.5"><Shield size={12} /> SOC2 & GDPR</span>
            <span className="text-white/15">•</span>
            <span className="flex items-center gap-1.5"><Activity size={12} className="text-[#06b6d4]" /> 99.98% uptime</span>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════ PRICING TIERS ═══════════════════ */}
      <section id="tiers" className="relative py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {tiers.map((tier, idx) => (
              <motion.div
                key={tier.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.6, delay: idx * 0.1 }}
                whileHover={{ y: -6 }}
                className={`relative rounded-2xl p-8 backdrop-blur-sm transition-all duration-500 ${
                  tier.popular
                    ? "bg-gradient-to-b from-[#06b6d4]/10 via-white/[0.03] to-white/[0.02] border-2 border-[#06b6d4]/40 shadow-[0_0_60px_rgba(6,182,212,0.15)] md:scale-105"
                    : "bg-white/[0.02] border border-white/10 hover:border-[#f5c451]/40"
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <motion.div
                      animate={{ boxShadow: ["0 0 20px rgba(6,182,212,0.4)", "0 0 40px rgba(6,182,212,0.7)", "0 0 20px rgba(6,182,212,0.4)"] }}
                      transition={{ duration: 2.5, repeat: Infinity }}
                      className="px-4 py-1.5 rounded-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#020617] text-[10px] font-black tracking-[0.2em] uppercase"
                    >
                      Most Popular
                    </motion.div>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-2xl font-black tracking-tight mb-2">{tier.name}</h3>
                  <p className="text-sm text-white/50">{tier.tagline}</p>
                </div>

                {/* Price */}
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-5xl font-black tracking-tight">
                    ${tier.free ? 0 : <AnimatedPrice value={annual ? tier.annual : tier.monthly} />}
                  </span>
                  {!tier.free && <span className="text-white/40 text-sm">/ month</span>}
                </div>
                <p className="text-[11px] uppercase tracking-wider text-white/30 mb-6">
                  {tier.free ? "Forever free" : annual ? "billed annually" : "billed monthly"}
                </p>

                {/* Power level */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2 text-[10px] uppercase tracking-wider text-white/40">
                    <span>Orchestration Power</span>
                    <span>{tier.power}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${tier.power}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1.2, delay: 0.3 + idx * 0.1, ease: "easeOut" }}
                      className={`h-full rounded-full ${
                        tier.popular
                          ? "bg-gradient-to-r from-[#06b6d4] to-[#f5c451]"
                          : "bg-gradient-to-r from-white/40 to-white/60"
                      }`}
                    />
                  </div>
                </div>

                {/* CTA */}
                <MagneticButton radius={80} strength={0.2}>
                  <button
                    onClick={() => navigate(tier.free ? "/" : "/dashboard")}
                    className={`w-full py-3.5 rounded-lg font-black uppercase text-xs tracking-[0.15em] transition-all ${
                      tier.popular
                        ? "bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#020617] hover:shadow-[0_0_40px_rgba(6,182,212,0.5)]"
                        : tier.free
                          ? "bg-white/10 text-white hover:bg-white/15 border border-white/15"
                          : "bg-[#f5c451] text-[#020617] hover:shadow-[0_0_40px_rgba(245,196,81,0.4)]"
                    }`}
                  >
                    {tier.cta}
                  </button>
                </MagneticButton>

                {/* Features */}
                <ul className="mt-8 space-y-3">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm text-white/75">
                      <Check size={16} className={`flex-shrink-0 mt-0.5 ${tier.popular ? "text-[#06b6d4]" : "text-[#f5c451]"}`} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* Expandable */}
                <button
                  onClick={() => setExpandedTier(expandedTier === tier.id ? null : tier.id)}
                  className="mt-6 w-full flex items-center justify-center gap-2 text-[11px] uppercase tracking-wider text-white/40 hover:text-white/70 transition-colors"
                >
                  See full capabilities
                  <motion.div animate={{ rotate: expandedTier === tier.id ? 180 : 0 }}>
                    <ChevronDown size={12} />
                  </motion.div>
                </button>
                <AnimatePresence>
                  {expandedTier === tier.id && (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden space-y-2 mt-3"
                    >
                      {tier.expanded.map((f) => (
                        <li key={f} className="flex items-start gap-3 text-xs text-white/50">
                          <Sparkles size={12} className="flex-shrink-0 mt-0.5 text-[#06b6d4]/60" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>

                <p className="mt-6 pt-6 border-t border-white/5 text-[10px] uppercase tracking-wider text-white/30 text-center">
                  {tier.trust}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Enterprise Strip */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mt-12 rounded-2xl p-8 md:p-10 bg-gradient-to-r from-white/[0.03] to-[#06b6d4]/[0.05] border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6"
          >
            <div>
              <h3 className="text-2xl font-black mb-2">Enterprise / Custom</h3>
              <p className="text-white/60 max-w-2xl">
                Need dedicated capacity, on-prem options, or bespoke agent fleets? Our core team partners with you on architecture, security review, and rollout.
              </p>
            </div>
            <MagneticButton radius={90} strength={0.25}>
              <button className="px-8 py-4 bg-white text-[#020617] font-black uppercase text-xs tracking-[0.15em] rounded-lg hover:shadow-[0_0_40px_rgba(255,255,255,0.3)] transition-shadow flex items-center gap-2">
                <Calendar size={14} />
                Talk to Our Core Team
              </button>
            </MagneticButton>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════ TRUST & CREDIBILITY ═══════════════════ */}
      <section id="trust" className="relative py-24 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <span className="text-[11px] tracking-[0.4em] text-[#06b6d4] font-bold uppercase block mb-4">
              Trust Layer
            </span>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight">
              Built for Confidence. <span className="text-white/50">Backed by Results.</span>
            </h2>
          </motion.div>

          {/* Social Proof */}
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 mb-16 text-sm text-white/60">
            <div className="flex items-center gap-2">
              <div className="flex">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={14} className="text-[#f5c451] fill-[#f5c451]" />
                ))}
              </div>
              <span className="font-bold text-white">4.9/5</span>
              <span>average</span>
            </div>
            <span className="text-white/15">•</span>
            <span><span className="text-white font-bold">1,200+</span> verified reviews</span>
            <span className="text-white/15">•</span>
            <span className="uppercase text-[10px] tracking-[0.3em]">As featured in tech press</span>
          </div>

          {/* Security badges */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-20">
            {securityBadges.map((b, i) => (
              <motion.div
                key={b.label}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                whileHover={{ filter: "brightness(1.2)", y: -2 }}
                className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-[#06b6d4]/30 transition-colors"
              >
                <b.icon size={18} className="text-[#06b6d4] flex-shrink-0" />
                <span className="text-xs font-medium text-white/80">{b.label}</span>
              </motion.div>
            ))}
          </div>

          {/* Animated stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-20">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="text-center p-6 rounded-2xl bg-gradient-to-b from-white/[0.03] to-transparent border border-white/5"
              >
                <div className="text-4xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-[#06b6d4] to-[#f5c451] bg-clip-text text-transparent mb-2">
                  {s.decimal ? `${s.value}${s.suffix}` : <Counter to={s.value} suffix={s.suffix} />}
                </div>
                <p className="text-xs text-white/50 leading-relaxed">{s.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Guarantees */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-20">
            {guarantees.map((g, i) => (
              <motion.div
                key={g.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="p-6 rounded-xl bg-white/[0.02] border border-white/10 hover:border-[#06b6d4]/30 transition-colors"
              >
                <g.icon size={20} className="text-[#06b6d4] mb-3" />
                <h4 className="font-bold text-white mb-1.5">{g.title}</h4>
                <p className="text-sm text-white/50 leading-relaxed">{g.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* Case studies */}
          <div className="grid md:grid-cols-3 gap-4 mb-12">
            {caseStudies.map((c, i) => (
              <motion.div
                key={c.metric}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="p-6 rounded-2xl bg-gradient-to-br from-[#06b6d4]/[0.05] to-transparent border border-white/10"
              >
                <div className="text-3xl font-black bg-gradient-to-r from-[#06b6d4] to-[#f5c451] bg-clip-text text-transparent mb-1">
                  {c.metric}
                </div>
                <p className="text-[11px] uppercase tracking-wider text-white/40 mb-4">{c.label}</p>
                <p className="text-sm text-white/70 leading-relaxed italic">"{c.quote}"</p>
              </motion.div>
            ))}
          </div>

          <p className="text-center text-sm text-white/40 italic max-w-3xl mx-auto">
            Unlike basic website builders, NazAI delivers deep, ongoing business intelligence and execution.
          </p>
        </div>
      </section>

      {/* ═══════════════════ COMPARISON TABLE ═══════════════════ */}
      <section id="compare" className="relative py-24 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-[11px] tracking-[0.4em] text-[#06b6d4] font-bold uppercase block mb-4">
              Side by Side
            </span>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight">Compare every capability</h2>
          </div>
          <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/[0.02] backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02]">
                    <th className="text-left px-6 py-5 font-bold text-white/60 uppercase text-[11px] tracking-wider">Feature</th>
                    {["Explorer", "Operator", "Titan", "Enterprise"].map((c) => (
                      <th key={c} className={`px-6 py-5 font-black uppercase text-[11px] tracking-[0.15em] ${c === "Operator" ? "text-[#06b6d4]" : "text-white"}`}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row, i) => (
                    <motion.tr
                      key={row.label}
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.3, delay: i * 0.03 }}
                      className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-6 py-4 text-white/80">{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className={`px-6 py-4 text-center ${j === 1 ? "bg-[#06b6d4]/[0.04]" : ""}`}>
                          {typeof v === "boolean" ? (
                            v ? <Check size={16} className="text-[#06b6d4] inline" /> : <X size={16} className="text-white/20 inline" />
                          ) : (
                            <span className="text-white/80">{v}</span>
                          )}
                        </td>
                      ))}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ FAQ ═══════════════════ */}
      <section id="faq" className="relative py-24 px-6 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-[11px] tracking-[0.4em] text-[#06b6d4] font-bold uppercase block mb-4">
              Frequently Asked
            </span>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight">Answers, not surprises.</h2>
          </div>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <motion.div
                key={faq.q}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.04 }}
                className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors"
                >
                  <span className="font-bold text-white pr-4">{faq.q}</span>
                  <motion.div animate={{ rotate: openFaq === i ? 180 : 0 }} className="flex-shrink-0">
                    <ChevronDown size={16} className="text-white/40" />
                  </motion.div>
                </button>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-5 text-sm text-white/60 leading-relaxed">{faq.a}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ FINAL CTA ═══════════════════ */}
      <section className="relative py-24 px-6 border-t border-white/5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="max-w-4xl mx-auto text-center"
        >
          <h2 className="text-4xl md:text-6xl font-black tracking-tight leading-[1.05] mb-6">
            Ready to Orchestrate Your Business at a{" "}
            <span className="bg-gradient-to-r from-[#06b6d4] to-[#f5c451] bg-clip-text text-transparent">
              Higher Level?
            </span>
          </h2>
          <p className="text-lg text-white/60 mb-10 max-w-2xl mx-auto">
            Join 8,700+ founders and teams orchestrating their businesses with NazAI.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <MagneticButton radius={90} strength={0.3}>
              <button
                onClick={() => navigate("/")}
                className="px-10 py-4 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#020617] font-black uppercase text-xs tracking-[0.15em] rounded-lg hover:shadow-[0_0_60px_rgba(6,182,212,0.5)] transition-shadow flex items-center gap-2"
              >
                Start Your Free Mission Today
                <ArrowRight size={14} />
              </button>
            </MagneticButton>
            <MagneticButton radius={80} strength={0.25}>
              <button className="px-8 py-4 border border-white/15 text-white/70 hover:text-white hover:border-white/30 font-bold uppercase text-xs tracking-[0.15em] rounded-lg transition-colors flex items-center gap-2">
                <MessageSquare size={14} />
                Talk to a Human Strategist
              </button>
            </MagneticButton>
          </div>
        </motion.div>
      </section>

      {/* ═══════════════════ FOOTER ═══════════════════ */}
      <footer className="relative border-t border-white/5 py-16 px-6 overflow-hidden">
        <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none">
          <defs>
            <linearGradient id="footer-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
              <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[...Array(5)].map((_, i) => (
            <motion.line
              key={i}
              x1="0%" y1={`${20 + i * 15}%`} x2="100%" y2={`${30 + i * 12}%`}
              stroke="url(#footer-line)" strokeWidth="1"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 4, delay: i * 0.3, repeat: Infinity, repeatType: "reverse" }}
            />
          ))}
        </svg>
        <div className="relative max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2">
              <div className="text-2xl font-black tracking-tight mb-3">
                Naz<span className="bg-gradient-to-r from-[#06b6d4] to-[#f5c451] bg-clip-text text-transparent">AI</span>
              </div>
              <p className="text-sm text-white/50 max-w-xs">
                The orchestration layer for ambitious founders, operators, and teams.
              </p>
            </div>
            {[
              { title: "Platform", links: ["Workflower", "Dashboard", "Mission Vault", "Brand-Snap"] },
              { title: "Resources", links: ["Docs", "Changelog", "Status", "Roadmap"] },
              { title: "Company", links: ["About", "Careers", "Press", "Contact"] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-[11px] uppercase tracking-[0.2em] text-white/40 mb-4 font-bold">{col.title}</h4>
                <ul className="space-y-2">
                  {col.links.map((l) => (
                    <li key={l}>
                      <a href="#" className="text-sm text-white/70 hover:text-white transition-colors">{l}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-white/40">
              <motion.div
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-2 h-2 rounded-full bg-[#06b6d4]"
              />
              Core Orchestration Network Active • Supporting businesses in 38 countries
            </div>
            <div className="flex items-center gap-4 text-xs text-white/40">
              <select className="bg-transparent border border-white/10 rounded px-2 py-1 text-white/60">
                <option>English</option>
                <option>Español</option>
                <option>Français</option>
              </select>
              <span>© 2026 NazAI. All rights reserved.</span>
              <a href="/privacy" className="hover:text-white">Privacy</a>
              <a href="/terms" className="hover:text-white">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Pricing;

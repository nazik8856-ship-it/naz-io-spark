import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  DollarSign,
  Palette,
  Code2,
  Sparkles,
  Download,
  Copy as CopyIcon,
  Check,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

/**
 * LaunchSuite — premium tabbed panel rendered above the Comfort Designs
 * picker on the website preview pane after a generation completes.
 *
 * Tabs:
 *  • ROI Simulator — interactive revenue & growth simulator
 *  • Pricing Tiers — auto-generated 3-tier pricing preview
 *  • Brand Preview — palette + typography + logo concept
 *  • Code Export — full standalone HTML + clipboard / download
 *  • Animation Studio — premium micro-animations applied to preview
 */

type TabId = "roi" | "pricing" | "brand" | "export" | "studio";

interface LaunchSuiteProps {
  directive: string;
  activeWebsiteCode: string;
  /** Apply a CSS animation pack into the live preview HTML. */
  onApplyAnimationPack?: (cssBlock: string, label: string) => void;
}

// ─── ANIMATION PACKS (injected as CSS into the iframe HTML) ───────────────────
const ANIMATION_PACKS: { id: string; label: string; description: string; icon: string; css: string }[] = [
  {
    id: "growth",
    label: "Interactive Growth Visualizer",
    description: "Counters tick up. Sections reveal as the user scrolls.",
    icon: "📈",
    css: `
@keyframes nazai-grow{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:none}}
section{animation:nazai-grow .9s cubic-bezier(.2,.8,.2,1) both}
section:nth-of-type(2){animation-delay:.12s}section:nth-of-type(3){animation-delay:.22s}section:nth-of-type(4){animation-delay:.32s}
strong{background:linear-gradient(90deg,#22d3ee,#a855f7);-webkit-background-clip:text;background-clip:text;color:transparent;animation:nazai-pulse 2.4s ease-in-out infinite}
@keyframes nazai-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.35)}}`,
  },
  {
    id: "onboarding",
    label: "Smooth Onboarding Flow",
    description: "Soft fade-cascade across hero + features.",
    icon: "🚀",
    css: `
@keyframes nazai-onboard{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
h1,h2,h3,p,.card,.tier{animation:nazai-onboard .8s cubic-bezier(.2,.8,.2,1) both}
h1{animation-delay:.05s}p{animation-delay:.18s}.card,.tier{animation-delay:.32s}`,
  },
  {
    id: "celebrate",
    label: "Success Celebration",
    description: "CTA buttons sparkle on hover; confetti on click.",
    icon: "🎉",
    css: `
.cta{position:relative;transition:transform .25s ease,box-shadow .25s ease}
.cta:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 0 36px rgba(34,211,238,.55),0 0 80px rgba(168,85,247,.4)}
.cta::after{content:"";position:absolute;inset:-2px;border-radius:inherit;background:conic-gradient(from 0deg,transparent,rgba(34,211,238,.55),transparent 40%);opacity:0;transition:opacity .3s}
.cta:hover::after{opacity:.8;animation:nazai-spin 2s linear infinite}
@keyframes nazai-spin{to{transform:rotate(360deg)}}`,
  },
  {
    id: "scroll",
    label: "Scroll Animations",
    description: "Parallax + smooth reveal as user scrolls.",
    icon: "🌀",
    css: `
html{scroll-behavior:smooth}
section{opacity:0;transform:translateY(40px);transition:opacity .9s ease,transform .9s ease}
section.in{opacity:1;transform:none}`,
  },
  {
    id: "hover",
    label: "Premium Hover Effects",
    description: "Cards lift, glow, and tilt subtly under the cursor.",
    icon: "✨",
    css: `
.card,.tier,.glass{transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s ease,border-color .35s ease}
.card:hover,.tier:hover{transform:translateY(-6px) rotateX(2deg);box-shadow:0 24px 60px rgba(34,211,238,.25),0 0 0 1px rgba(34,211,238,.4)}`,
  },
  {
    id: "loading",
    label: "Cinematic Loading States",
    description: "Skeleton shimmer for any [data-loading] block.",
    icon: "⏳",
    css: `
@keyframes nazai-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
[data-loading]{background:linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.12),rgba(255,255,255,.04));background-size:200% 100%;animation:nazai-shimmer 1.4s linear infinite;border-radius:12px;color:transparent!important}`,
  },
];

// ─── BRAND COLOR PALETTE (deterministic from prompt) ──────────────────────────
const hashStr = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
};

const buildPalette = (prompt: string) => {
  const h = hashStr(prompt || "nazai");
  const baseHue = h % 360;
  return {
    primary: `hsl(${baseHue}, 85%, 55%)`,
    secondary: `hsl(${(baseHue + 200) % 360}, 75%, 60%)`,
    accent: `hsl(${(baseHue + 60) % 360}, 90%, 65%)`,
    bg: `hsl(${baseHue}, 25%, 8%)`,
    surface: `hsl(${baseHue}, 18%, 12%)`,
  };
};

const LaunchSuite: React.FC<LaunchSuiteProps> = ({
  directive,
  activeWebsiteCode,
  onApplyAnimationPack,
}) => {
  const [tab, setTab] = useState<TabId>("roi");

  // ROI inputs
  const [users, setUsers] = useState(500);
  const [arpu, setArpu] = useState(49);
  const [growth, setGrowth] = useState(8);
  const [churn, setChurn] = useState(4);

  const projection = useMemo(() => {
    const months: { m: number; rev: number; cum: number; users: number }[] = [];
    let u = users;
    let cum = 0;
    for (let m = 1; m <= 12; m++) {
      const rev = u * arpu;
      cum += rev;
      months.push({ m, rev, cum, users: Math.round(u) });
      u = u * (1 + growth / 100) * (1 - churn / 100);
    }
    return months;
  }, [users, arpu, growth, churn]);

  const palette = useMemo(() => buildPalette(directive), [directive]);
  const [copied, setCopied] = useState(false);

  const tiers = [
    { name: "Starter", price: Math.round(arpu * 0.4), tag: "For solo founders", features: ["Core access", "Email support", "Community"] },
    { name: "Pro", price: arpu, tag: "Most popular", features: ["Everything in Starter", "Priority support", "Advanced analytics", "Team seats"], featured: true },
    { name: "Scale", price: arpu * 3, tag: "For high-growth teams", features: ["Everything in Pro", "Dedicated CSM", "SSO + SAML", "Custom integrations"] },
  ];

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeWebsiteCode || "");
      setCopied(true);
      toast.success("Code copied to clipboard");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleDownloadCode = () => {
    if (!activeWebsiteCode) return;
    const blob = new Blob([activeWebsiteCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${directive.slice(0, 32).replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "nazai-site"}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("HTML downloaded");
  };

  const TABS: { id: TabId; label: string; icon: React.ComponentType<any> }[] = [
    { id: "roi", label: "ROI Simulator", icon: TrendingUp },
    { id: "pricing", label: "Pricing Tiers", icon: DollarSign },
    { id: "brand", label: "Brand", icon: Palette },
    { id: "studio", label: "Animation Studio", icon: Sparkles },
    { id: "export", label: "Export Code", icon: Code2 },
  ];

  return (
    <div
      className="w-full rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(180deg, rgba(9,9,11,0.92), rgba(9,9,11,0.78))",
        border: "1px solid rgba(6,182,212,0.25)",
        boxShadow: "0 30px 80px -30px rgba(6,182,212,0.35)",
      }}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider transition-all"
              style={{
                background: active ? "rgba(6,182,212,0.15)" : "transparent",
                color: active ? "#06b6d4" : "#a1a1aa",
                border: active ? "1px solid rgba(6,182,212,0.45)" : "1px solid transparent",
              }}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="p-5">
        <AnimatePresence mode="wait">
          {tab === "roi" && (
            <motion.div key="roi" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <NumField label="Starting users" value={users} onChange={setUsers} suffix="" />
                <NumField label="ARPU ($/mo)" value={arpu} onChange={setArpu} suffix="$" />
                <NumField label="Growth %/mo" value={growth} onChange={setGrowth} suffix="%" />
                <NumField label="Churn %/mo" value={churn} onChange={setChurn} suffix="%" />
              </div>
              <div className="rounded-xl p-4" style={{ background: "rgba(6,182,212,0.05)", border: "1px solid rgba(6,182,212,0.2)" }}>
                <div className="flex items-end justify-between gap-1 h-32 mb-3">
                  {projection.map((p) => {
                    const maxRev = Math.max(...projection.map((x) => x.rev));
                    const h = Math.max(6, (p.rev / maxRev) * 100);
                    return (
                      <div key={p.m} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t"
                          style={{
                            height: `${h}%`,
                            background: "linear-gradient(180deg, #22d3ee, #a855f7)",
                            boxShadow: "0 0 12px rgba(34,211,238,0.4)",
                          }}
                          title={`Mo ${p.m}: $${Math.round(p.rev).toLocaleString()}`}
                        />
                        <span className="text-[8px] font-mono text-zinc-500">M{p.m}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-3 gap-3 pt-3 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  <Stat label="Mo. 12 MRR" value={`$${Math.round(projection[11].rev).toLocaleString()}`} />
                  <Stat label="12-mo Revenue" value={`$${Math.round(projection[11].cum).toLocaleString()}`} />
                  <Stat label="Mo. 12 Users" value={projection[11].users.toLocaleString()} />
                </div>
              </div>
            </motion.div>
          )}

          {tab === "pricing" && (
            <motion.div key="pricing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {tiers.map((t) => (
                <div
                  key={t.name}
                  className="rounded-xl p-4"
                  style={{
                    background: t.featured ? "linear-gradient(180deg, rgba(6,182,212,0.12), rgba(168,85,247,0.08))" : "rgba(255,255,255,0.03)",
                    border: t.featured ? "1px solid rgba(6,182,212,0.55)" : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: t.featured ? "0 0 30px rgba(6,182,212,0.25)" : "none",
                  }}
                >
                  <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: t.featured ? "#06b6d4" : "#a1a1aa" }}>{t.tag}</div>
                  <div className="text-base font-bold text-white mt-1">{t.name}</div>
                  <div className="text-3xl font-black text-white mt-2">${t.price}<span className="text-xs text-zinc-400 font-normal">/mo</span></div>
                  <ul className="mt-3 space-y-1.5">
                    {t.features.map((f) => (
                      <li key={f} className="text-[11px] text-zinc-300 flex items-center gap-1.5"><Check size={11} className="text-cyan-400" />{f}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </motion.div>
          )}

          {tab === "brand" && (
            <motion.div key="brand" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                {Object.entries(palette).map(([name, color]) => (
                  <div key={name} className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div className="h-16" style={{ background: color }} />
                    <div className="px-2 py-1.5 bg-black/40">
                      <div className="text-[9px] font-mono uppercase text-zinc-500">{name}</div>
                      <div className="text-[10px] font-mono text-zinc-200 truncate">{color}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl p-5" style={{ background: palette.bg, border: `1px solid ${palette.primary}55` }}>
                  <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: palette.accent }}>Logo concept</div>
                  <div className="flex items-center gap-3 mt-3">
                    <div className="w-12 h-12 rounded-xl" style={{ background: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`, boxShadow: `0 0 24px ${palette.primary}66` }} />
                    <div className="text-2xl font-black text-white tracking-tight">{(directive || "Brand").split(/\s+/)[0].slice(0, 12)}</div>
                  </div>
                </div>
                <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Typography</div>
                  <div className="text-2xl font-black text-white mt-2" style={{ fontFamily: "Inter, system-ui" }}>Heading · Inter Black</div>
                  <div className="text-sm text-zinc-300 mt-1">Body · Inter Regular — clean, modern, optimized for legibility on dark surfaces.</div>
                </div>
              </div>
            </motion.div>
          )}

          {tab === "studio" && (
            <motion.div key="studio" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="flex items-center gap-2 mb-3">
                <Wand2 size={13} className="text-cyan-400" />
                <p className="text-[11px] font-mono text-zinc-300">Apply premium micro-animations to the live preview. Stack multiple packs.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {ANIMATION_PACKS.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => {
                      onApplyAnimationPack?.(pack.css, pack.label);
                      toast.success(`${pack.label} applied`, { description: "Live preview updated.", duration: 1600 });
                    }}
                    className="text-left rounded-xl p-3 transition-all hover:scale-[1.01]"
                    style={{
                      background: "rgba(255,255,255,0.025)",
                      border: "1px solid rgba(6,182,212,0.2)",
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <div className="text-xl leading-none">{pack.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-bold text-white">{pack.label}</div>
                        <div className="text-[10px] text-zinc-400 mt-0.5">{pack.description}</div>
                      </div>
                      <div className="text-[9px] font-mono text-cyan-400 uppercase tracking-widest">Apply</div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {tab === "export" && (
            <motion.div key="export" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={handleCopyCode}
                  disabled={!activeWebsiteCode}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold disabled:opacity-30"
                  style={{ background: "#06b6d4", color: "#020617" }}
                >
                  {copied ? <Check size={12} /> : <CopyIcon size={12} />}
                  {copied ? "Copied" : "Copy HTML"}
                </button>
                <button
                  onClick={handleDownloadCode}
                  disabled={!activeWebsiteCode}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold disabled:opacity-30"
                  style={{ background: "transparent", border: "1px solid #06b6d4", color: "#06b6d4" }}
                >
                  <Download size={12} />
                  Download .html
                </button>
                <span className="ml-auto text-[10px] font-mono text-zinc-500">
                  {activeWebsiteCode ? `${(activeWebsiteCode.length / 1024).toFixed(1)} KB` : "No code yet"}
                </span>
              </div>
              <pre
                className="rounded-xl p-3 overflow-auto text-[10px] font-mono text-zinc-300"
                style={{
                  background: "#0b0b0f",
                  border: "1px solid rgba(255,255,255,0.08)",
                  maxHeight: 220,
                }}
              >
                {activeWebsiteCode ? activeWebsiteCode.slice(0, 4000) + (activeWebsiteCode.length > 4000 ? "\n... (truncated, full file in download)" : "") : "// generate a website to see exportable code"}
              </pre>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const NumField: React.FC<{ label: string; value: number; onChange: (n: number) => void; suffix?: string }> = ({ label, value, onChange, suffix }) => (
  <label className="flex flex-col gap-1">
    <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">{label}</span>
    <div className="flex items-center gap-1 rounded-lg px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      {suffix === "$" && <span className="text-zinc-500 text-xs">$</span>}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="flex-1 bg-transparent outline-none text-sm font-mono text-white w-full"
      />
      {suffix && suffix !== "$" && <span className="text-zinc-500 text-xs">{suffix}</span>}
    </div>
  </label>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">{label}</div>
    <div className="text-base font-bold text-white mt-0.5">{value}</div>
  </div>
);

export default LaunchSuite;

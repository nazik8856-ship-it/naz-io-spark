import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, LogOut, type MessageSquare, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isFirstVisit } from "@/lib/welcome";

/**
 * NAZAI DASHBOARD — MINIMAL V1
 * Two-window Command Center. All legacy Titan V27 logic archived at
 * src/pages/Dashboard.legacy.tsx.archive.
 */

type Card = {
  id: "generator" | "control-system";
  label: string;
  title: string;
  description: string;
  tags: string[];
  /** First-time only: a short badge on the card and one line saying when to choose it. */
  badge: string;
  when: string;
  icon: typeof MessageSquare;
  glow: string; // hex
  route: string;
};

const CARDS: Card[] = [
  {
    id: "generator",
    label: "COMMAND CENTER",
    title: "Generator",
    description:
      "Describe an agent or a website in plain language. NazAI plans it, builds it and connects your tools.",
    tags: ["Agents", "Websites"],
    badge: "Start here",
    when: "Choose this when you want to create something new.",
    icon: Sparkles,
    glow: "#00f2ff",
    route: "/generator-home",
  },
  {
    id: "control-system",
    label: "CONTROL",
    title: "AI Control System",
    description:
      "See why each AI decision was made, set the rules, and require approval before risky actions run.",
    tags: ["Rules", "Approvals", "Decision history"],
    badge: "Next step",
    when: "Choose this when AI already runs for you and you want to check or limit what it does.",
    icon: ShieldCheck,
    glow: "#a855f7",
    route: "/control-system",
  },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstVisit = isFirstVisit(user);

  // Choosing an interface ends the first visit; the marker lives on the account so it holds on every device.
  const choose = (route: string) => {
    if (firstVisit) void supabase.auth.updateUser({ data: { welcome_seen: true } }).catch(() => undefined);
    navigate(route);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{ backgroundColor: "#020617" }}
    >
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/5">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          aria-label="Back to landing"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-mono uppercase tracking-wider">Back</span>
        </button>

        <div className="text-xs font-mono text-zinc-500 hidden sm:block">
          {user?.email}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/account")}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-white/30 transition-colors text-sm"
            aria-label="Account settings"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-white/30 transition-colors text-sm"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="relative px-4 sm:px-6 py-10 md:py-16 max-w-7xl mx-auto">
        {/* soft colour behind the cards, so the screen does not feel empty */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute left-[12%] top-24 h-72 w-72 rounded-full bg-cyan-500/10 blur-[110px]" />
          <div className="absolute right-[12%] top-40 h-72 w-72 rounded-full bg-purple-600/10 blur-[110px]" />
        </div>

        <div className="relative mb-10 md:mb-14 text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
            Welcome to <span className="text-[#00f2ff]">NazAI</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-zinc-300 text-sm sm:text-base leading-relaxed" data-testid="welcome-subtitle">
            Build AI agents with the Generator, and review or restrict what they do with the AI Control System.
          </p>
          <p className="mt-2 text-zinc-500 text-xs font-mono uppercase tracking-[0.2em]">Choose your interface</p>
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 max-w-4xl mx-auto">
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onClick={() => choose(c.route)}
                data-testid={`card-${c.id}`}
                className="group relative text-left rounded-2xl p-6 md:p-8 border transition-all duration-300 flex flex-col h-full min-h-[240px] md:min-h-[300px] hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2"
                style={{
                  background: `linear-gradient(160deg, ${c.glow}14 0%, #020617 55%)`,
                  borderColor: `${c.glow}55`,
                  boxShadow: `0 0 18px ${c.glow}22, inset 0 0 0 1px ${c.glow}22`,
                  ["--tw-ring-color" as string]: c.glow,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 40px ${c.glow}66, inset 0 0 0 1px ${c.glow}88`;
                  e.currentTarget.style.borderColor = c.glow;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 18px ${c.glow}22, inset 0 0 0 1px ${c.glow}22`;
                  e.currentTarget.style.borderColor = `${c.glow}55`;
                }}
              >
                <div className="flex min-h-[24px] items-center justify-between gap-3 mb-5">
                  <div
                    className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em]"
                    style={{ color: c.glow }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: c.glow, boxShadow: `0 0 10px ${c.glow}` }}
                    />
                    {c.label}
                  </div>
                  {firstVisit && (
                    <span
                      className="rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider"
                      style={{ borderColor: `${c.glow}88`, color: c.glow, backgroundColor: `${c.glow}14` }}
                      data-testid="first-time-badge"
                    >
                      {c.badge}
                    </span>
                  )}
                </div>

                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center border mb-5 transition-transform duration-300 group-hover:scale-105"
                  style={{ borderColor: `${c.glow}66`, backgroundColor: `${c.glow}14`, boxShadow: `0 0 20px ${c.glow}30` }}
                >
                  <Icon className="h-6 w-6" style={{ color: c.glow }} />
                </div>

                <h2 className="text-2xl md:text-3xl font-bold mb-2">{c.title}</h2>
                <p className="text-zinc-300 text-sm md:text-[15px] leading-relaxed">
                  {c.description}
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {c.tags.map((t) => (
                    <span key={t} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-400">{t}</span>
                  ))}
                </div>

                <div className="mt-auto pt-5">
                  {firstVisit && (
                    <p className="mb-3 border-t border-white/10 pt-3 text-xs leading-snug text-zinc-400" data-testid="first-time-when">
                      {c.when}
                    </p>
                  )}
                  <span className="flex items-center gap-1.5 text-sm font-medium transition-all duration-300 group-hover:gap-2.5" style={{ color: c.glow }}>
                    Open <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

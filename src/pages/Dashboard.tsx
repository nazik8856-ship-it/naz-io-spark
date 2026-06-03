import { useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, MessageSquare, Zap, Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * NAZAI DASHBOARD — MINIMAL V1
 * Three-window Command Center. All legacy Titan V27 logic archived at
 * src/pages/Dashboard.legacy.tsx.archive (Generator chat/missions, Automator
 * workflows, Others research, Credit system, Live preview, Settings, Pricing).
 */

type Card = {
  id: "generator" | "automator" | "others";
  label: string;
  title: string;
  description: string;
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
      "Your command center. Chat with NazAI and build your AI Agent — instantly.",
    icon: MessageSquare,
    glow: "#00f2ff",
    route: "/workspace",
  },
  {
    id: "automator",
    label: "AUTOPILOT",
    title: "Automator",
    description:
      "Automate anything. Emails, ads, follow-ups, campaigns — NazAI executes on autopilot.",
    icon: Zap,
    glow: "#a855f7",
    route: "/dashboard/automator",
  },
  {
    id: "others",
    label: "STRATEGY",
    title: "Others",
    description:
      "Strategic planning made simple. Deep research, competitor analysis, and winning AI agent strategies — on demand.",
    icon: Compass,
    glow: "#22c55e",
    route: "/dashboard/others",
  },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

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

        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-white/30 transition-colors text-sm"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </header>

      {/* Main */}
      <main className="px-6 py-12 md:py-20 max-w-6xl mx-auto">
        <div className="mb-10 md:mb-14 text-center">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            Welcome to <span className="text-[#00f2ff]">NazAI</span>
          </h1>
          <p className="mt-3 text-zinc-400 text-sm md:text-base">
            Choose your interface
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {CARDS.map((c, idx) => {
            const Icon = c.icon;
            const isLast = idx === CARDS.length - 1;
            return (
              <button
                key={c.id}
                onClick={() => navigate(c.route)}
                className={`group relative text-left rounded-2xl p-6 md:p-8 border transition-all duration-300 ${
                  isLast ? "lg:col-span-2" : ""
                }`}
                style={
                  {
                    backgroundColor: "#020617",
                    borderColor: `${c.glow}55`,
                    boxShadow: `0 0 18px ${c.glow}22, inset 0 0 0 1px ${c.glow}22`,
                    ["--glow" as never]: c.glow,
                  } as React.CSSProperties
                }
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 40px ${c.glow}66, inset 0 0 0 1px ${c.glow}88`;
                  e.currentTarget.style.borderColor = c.glow;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 18px ${c.glow}22, inset 0 0 0 1px ${c.glow}22`;
                  e.currentTarget.style.borderColor = `${c.glow}55`;
                }}
              >
                <div
                  className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.2em] mb-5"
                  style={{ color: c.glow }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: c.glow,
                      boxShadow: `0 0 10px ${c.glow}`,
                    }}
                  />
                  {c.label}
                </div>

                <div className="flex items-start gap-4">
                  <div
                    className="shrink-0 h-12 w-12 rounded-xl flex items-center justify-center border"
                    style={{
                      borderColor: `${c.glow}66`,
                      backgroundColor: `${c.glow}10`,
                    }}
                  >
                    <Icon className="h-6 w-6" style={{ color: c.glow }} />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-2xl md:text-3xl font-bold mb-2">
                      {c.title}
                    </h2>
                    <p className="text-zinc-400 text-sm md:text-base leading-relaxed">
                      {c.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

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
      <main className="px-4 sm:px-6 py-8 md:py-12 max-w-7xl mx-auto">
        <div className="mb-8 md:mb-10 text-center">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">
            Welcome to <span className="text-[#00f2ff]">NazAI</span>
          </h1>
          <p className="mt-2 text-zinc-400 text-sm">
            Choose your interface
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onClick={() => navigate(c.route)}
                className="group relative text-left rounded-2xl p-5 md:p-6 border transition-all duration-300 flex flex-col h-full min-h-[200px] md:min-h-[260px]"
                style={{
                  backgroundColor: "#020617",
                  borderColor: `${c.glow}55`,
                  boxShadow: `0 0 18px ${c.glow}22, inset 0 0 0 1px ${c.glow}22`,
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
                <div
                  className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] mb-4"
                  style={{ color: c.glow }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: c.glow, boxShadow: `0 0 10px ${c.glow}` }}
                  />
                  {c.label}
                </div>

                <div
                  className="h-11 w-11 rounded-xl flex items-center justify-center border mb-4"
                  style={{ borderColor: `${c.glow}66`, backgroundColor: `${c.glow}10` }}
                >
                  <Icon className="h-5 w-5" style={{ color: c.glow }} />
                </div>

                <h2 className="text-xl md:text-2xl font-bold mb-2">{c.title}</h2>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  {c.description}
                </p>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

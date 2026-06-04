import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Globe, Building2, ShoppingBag, Palette, Code2, FileText, Zap, Clock, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { formatDistanceToNow } from "date-fns";

const TYPES = [
  { id: "website", label: "Website", icon: Globe },
  { id: "business", label: "AI Agent", icon: Building2 },
  { id: "store", label: "Store", icon: ShoppingBag },
  { id: "landing", label: "Landing", icon: Palette },
  { id: "app", label: "App", icon: Code2 },
  { id: "document", label: "Document", icon: FileText },
];

export default function GeneratorHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { recentProjects, loading } = useProjects(user?.id);
  const [prompt, setPrompt] = useState("");
  const [activeType, setActiveType] = useState("website");

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    sessionStorage.setItem("nazai_pending_prompt", prompt.trim());
    sessionStorage.setItem("nazai_pending_type", activeType);
    navigate("/generation-workspace");
  };

  return (
    <div className="min-h-screen w-full text-white relative overflow-x-hidden" style={{ backgroundColor: "#000" }}>
      {/* Purple gradient transition at top */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(139,92,246,0.35) 0%, rgba(88,28,135,0.18) 35%, rgba(0,0,0,0) 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[400px] z-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(168,85,247,0.18) 0%, rgba(88,28,135,0.08) 40%, rgba(0,0,0,0) 100%)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-zinc-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-mono uppercase tracking-wider">Back</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-xs font-bold">
            {user?.email?.[0]?.toUpperCase() || "N"}
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-12 md:pt-20 pb-20">
        <div className="text-[11px] font-mono tracking-[0.3em] text-zinc-400 mb-6">
          PROMPT <span className="text-purple-400">→</span> GENERATE
        </div>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold leading-[1.05] tracking-tight">
          Make your{" "}
          <span className="bg-gradient-to-r from-cyan-300 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent">
            ideas real.
          </span>
        </h1>

        {/* Type chips */}
        <div className="mt-10 flex flex-wrap gap-3">
          {TYPES.map((t) => {
            const Icon = t.icon;
            const active = activeType === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveType(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm transition-all ${
                  active
                    ? "bg-purple-500/20 border-purple-400/60 text-white shadow-[0_0_20px_rgba(168,85,247,0.35)]"
                    : "bg-white/[0.03] border-white/10 text-zinc-300 hover:border-white/30"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Prompt box */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-5">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
              }
            }}
            placeholder="A luxury watchmaker's site with cinematic scroll and age verification"
            rows={3}
            className="w-full bg-transparent resize-none outline-none text-base text-zinc-100 placeholder:text-zinc-600"
          />
          <div className="flex items-center justify-between pt-3 mt-2 border-t border-white/5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-purple-400/40 text-purple-300 text-xs">
              {(() => {
                const t = TYPES.find((x) => x.id === activeType)!;
                const Icon = t.icon;
                return (
                  <>
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </>
                );
              })()}
            </div>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-purple-400/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap className="h-4 w-4 text-purple-300" />
              <span className="text-sm">Generate</span>
              <span className="text-purple-300">↗</span>
            </button>
          </div>
        </div>

        {/* Recent */}
        <div className="mt-16">
          <div className="flex items-center justify-between mb-5">
            <div className="text-[11px] font-mono tracking-[0.3em] text-zinc-500">RECENT</div>
            {recentProjects.length > 0 && (
              <button
                onClick={() => navigate("/dashboard/all-projects")}
                className="flex items-center gap-1 text-sm text-purple-300 hover:text-purple-200"
              >
                All projects <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-sm text-zinc-600">Loading…</div>
          ) : recentProjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
              <p className="text-zinc-500 text-sm">
                Your recent projects will appear here once you start creating.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {recentProjects.slice(0, 6).map((p) => {
                const initial = (p.directive || "?").trim()[0]?.toUpperCase() || "N";
                const ago = formatDistanceToNow(new Date(p.updated_at || p.created_at), { addSuffix: true });
                return (
                  <button
                    key={p.id}
                    onClick={() => navigate("/workspace")}
                    className="text-left rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-purple-400/40 transition-all p-5"
                  >
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center font-bold text-black mb-4">
                      {initial}
                    </div>
                    <div className="font-semibold truncate">
                      {(p.directive || "Untitled").slice(0, 40)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
                      <Clock className="h-3 w-3" />
                      {ago}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

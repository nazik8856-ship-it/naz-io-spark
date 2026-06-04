import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  History,
  Lightbulb,
  Mic,
  MessageSquare,
  Plus,
  Sliders,
  Maximize2,
  Monitor,
  RefreshCw,
  ChevronDown,
  Sparkles,
  LayoutGrid,
  Palette,
  Pencil,
  Hammer,
  HelpCircle,
  Check,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type ChatMessage = {
  id: string;
  role: "user" | "nazai";
  content: string;
  time: string;
};

const SUGGESTIONS = [
  "Create new database",
  "Build simple dashboard",
  "Define data categories",
];

type ChatMode = "plan" | "build" | "ask";

const CHAT_MODES: { id: ChatMode; label: string; description: string; icon: typeof Pencil }[] = [
  { id: "plan", label: "Plan", description: "Outline architecture & strategy", icon: Pencil },
  { id: "build", label: "Build", description: "Generate & implement code", icon: Hammer },
  { id: "ask", label: "Ask", description: "Chat & explore ideas", icon: HelpCircle },
];

export default function GenerationWorkspace() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState<"preview" | "dashboard">("preview");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>("build");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Pull pending prompt from /generator-home
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const pending = sessionStorage.getItem("nazai_pending_prompt");
    if (pending) {
      sessionStorage.removeItem("nazai_pending_prompt");
      setMessages([
        {
          id: crypto.randomUUID(),
          role: "user",
          content: pending,
          time: "just now",
        },
        {
          id: crypto.randomUUID(),
          role: "nazai",
          content:
            "Locked in. NazAI is preparing your generation environment. Continue refining your directive in the chat — the live preview will update on the right.",
          time: "just now",
        },
      ]);
    } else {
      setMessages([
        {
          id: crypto.randomUUID(),
          role: "nazai",
          content:
            "It looks like your message might have been accidental or incomplete. What would you like to build? Let me know and I'll get started!",
          time: "just now",
        },
      ]);
    }
  }, []);

  const sendPrompt = () => {
    const text = prompt.trim();
    if (!text) return;
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: text, time: "just now" },
    ]);
    setPrompt("");
    // Echo response — real generation hook lives in legacy pipeline.
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "nazai",
          content: "Received. Routing through NazAI orchestrator…",
          time: "just now",
        },
      ]);
    }, 400);
  };

  return (
    <div
      className="min-h-screen w-full text-white flex flex-col"
      style={{ backgroundColor: "#020617" }}
    >
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate("/generator-home")}
            className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4 text-black" />
          </button>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] min-w-0">
            <div className="h-6 w-6 rounded-md bg-white/10 flex items-center justify-center text-[10px] font-mono">
              N
            </div>
            <div className="flex flex-col min-w-0">
              <div className="text-sm font-semibold truncate leading-tight">untitled</div>
              <div className="text-[10px] font-mono text-zinc-500 leading-tight truncate">
                NazAI Workspace
              </div>
            </div>
          </div>
          <button
            className="h-8 w-8 rounded-lg border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:border-white/30"
            aria-label="History"
          >
            <History className="h-4 w-4" />
          </button>
        </div>

        {/* Center tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-white/[0.03]">
          {(["preview", "dashboard"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                activeTab === t
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-xs font-bold text-black">
            {user?.email?.[0]?.toUpperCase() || "N"}
          </div>
          <button className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-cyan-400 text-black text-sm font-semibold">
            <Sparkles className="h-3.5 w-3.5" />
            Publish
          </button>
        </div>
      </header>

      {/* Main split */}
      <div className="flex-1 flex min-h-0">
        {/* Chat sidebar */}
        <aside className="w-full max-w-[380px] border-r border-white/5 flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {messages.map((m) =>
              m.role === "nazai" ? (
                <div key={m.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-[10px] font-bold text-black">
                      N
                    </div>
                    <div className="text-sm font-semibold">NazAI</div>
                  </div>
                  <p className="text-sm text-zinc-200 leading-relaxed pl-9">
                    {m.content}
                  </p>
                  <div className="text-[10px] font-mono text-zinc-600 pl-9">
                    {m.time}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-purple-500/15 border border-purple-400/30 text-sm">
                    {m.content}
                  </div>
                </div>
              ),
            )}
          </div>

          {/* Suggestions */}
          <div className="px-5 pb-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 mb-2.5">
              <Lightbulb className="h-3.5 w-3.5 text-yellow-300/80" />
              <span>Suggestions</span>
              <ChevronDown className="h-3 w-3" />
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setPrompt(s)}
                  className="px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-xs text-zinc-300 hover:border-purple-400/50 hover:text-white"
                >
                  {s}
                </button>
              ))}
              <button className="h-7 w-7 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-zinc-400 hover:text-white">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Composer */}
          <div className="p-4 border-t border-white/5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendPrompt();
                  }
                }}
                rows={2}
                placeholder="What would you like to build?"
                className="w-full bg-transparent outline-none resize-none text-sm text-zinc-100 placeholder:text-zinc-600"
              />
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1">
                  <button className="h-7 w-7 rounded-md hover:bg-white/5 flex items-center justify-center text-zinc-400">
                    <Sliders className="h-3.5 w-3.5" />
                  </button>
                  <button className="h-7 w-7 rounded-md hover:bg-white/5 flex items-center justify-center text-zinc-400">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <div className="relative" ref={modeMenuRef}>
                    {modeMenuOpen && (
                      <div className="absolute bottom-full right-0 mb-2 w-60 rounded-xl border border-white/10 bg-[#0b1020]/95 backdrop-blur-xl shadow-2xl shadow-purple-500/10 p-1.5 z-50">
                        <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
                          Chat Mode
                        </div>
                        {CHAT_MODES.map((m) => {
                          const Icon = m.icon;
                          const active = chatMode === m.id;
                          return (
                            <button
                              key={m.id}
                              onClick={() => {
                                setChatMode(m.id);
                                setModeMenuOpen(false);
                              }}
                              className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                                active
                                  ? "bg-gradient-to-r from-purple-500/15 to-cyan-400/10 border border-purple-400/30"
                                  : "hover:bg-white/5 border border-transparent"
                              }`}
                            >
                              <div
                                className={`h-7 w-7 shrink-0 rounded-md flex items-center justify-center ${
                                  active
                                    ? "bg-gradient-to-br from-purple-500 to-cyan-400 text-black"
                                    : "bg-white/5 text-zinc-300"
                                }`}
                              >
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium text-white">{m.label}</span>
                                  {active && <Check className="h-3.5 w-3.5 text-cyan-300" />}
                                </div>
                                <div className="text-[11px] text-zinc-500 leading-snug">
                                  {m.description}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      onClick={() => setModeMenuOpen((o) => !o)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                        modeMenuOpen ? "bg-white/10 text-white" : "hover:bg-white/5 text-zinc-300"
                      }`}
                    >
                      {(() => {
                        const current = CHAT_MODES.find((m) => m.id === chatMode)!;
                        const Icon = current.icon;
                        return (
                          <>
                            <Icon className="h-3.5 w-3.5 text-purple-300" />
                            {current.label}
                            <ChevronDown
                              className={`h-3 w-3 transition-transform ${
                                modeMenuOpen ? "rotate-180" : ""
                              }`}
                            />
                          </>
                        );
                      })()}
                    </button>
                  </div>
                  <button className="h-7 w-7 rounded-md hover:bg-white/5 flex items-center justify-center text-zinc-400">
                    <Mic className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={sendPrompt}
                    disabled={!prompt.trim()}
                    className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-black disabled:opacity-40"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Preview pane */}
        <section className="flex-1 flex flex-col bg-[#0a0f1e] min-w-0">
          {/* Preview toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
            <div className="flex items-center gap-1">
              <button className="h-8 w-8 rounded-md hover:bg-white/5 flex items-center justify-center text-zinc-400">
                <Monitor className="h-4 w-4" />
              </button>
              <button className="h-8 w-8 rounded-md hover:bg-white/5 flex items-center justify-center text-zinc-400">
                <LayoutGrid className="h-4 w-4" />
              </button>
              <div className="w-px h-5 bg-white/10 mx-1" />
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-white/5 text-zinc-300 text-xs">
                <Sparkles className="h-3.5 w-3.5 text-purple-300" />
                Edit
              </button>
              <button className="h-8 w-8 rounded-md hover:bg-white/5 flex items-center justify-center text-zinc-400">
                <Palette className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 max-w-md mx-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03]">
                <button className="text-zinc-400 hover:text-white">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <input
                  className="flex-1 bg-transparent outline-none text-xs text-zinc-300 text-center"
                  defaultValue="/"
                />
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button className="h-8 px-2 rounded-md hover:bg-white/5 flex items-center gap-1 text-zinc-400 text-xs">
                <Monitor className="h-4 w-4" />
                <ChevronDown className="h-3 w-3" />
              </button>
              <button className="h-8 w-8 rounded-md hover:bg-white/5 flex items-center justify-center text-zinc-400">
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Preview canvas */}
          <div className="flex-1 relative overflow-hidden">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 70% 55% at 50% 60%, rgba(139,92,246,0.18) 0%, rgba(34,211,238,0.10) 35%, rgba(2,6,23,0) 70%)",
              }}
            />
            <div className="relative h-full flex flex-col items-center justify-center text-center px-6">
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
                Waiting for your next step…
              </h2>
              <p className="text-zinc-500 text-sm mt-2">
                Continue in the chat when you're ready
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

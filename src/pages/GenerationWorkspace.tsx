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
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

type ChatMessage = {
  id: string;
  role: "user" | "nazai";
  content: string;
  time: string;
  streaming?: boolean;
  isAgent?: boolean;
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
  // Selected generation type from /generator-home ("business" === AI Agent)
  const forcedAgentRef = useRef<boolean>(false);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Pull pending prompt from /generator-home and immediately generate
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const pending = sessionStorage.getItem("nazai_pending_prompt");
    const pendingType = sessionStorage.getItem("nazai_pending_type");
    if (pendingType === "business") forcedAgentRef.current = true;
    if (pending) {
      sessionStorage.removeItem("nazai_pending_prompt");
      sessionStorage.removeItem("nazai_pending_type");
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: pending,
        time: "just now",
      };
      setMessages([userMsg]);
      void streamFromNazAI([{ role: "user", content: pending }]);
    } else {
      setMessages([
        {
          id: crypto.randomUUID(),
          role: "nazai",
          content: forcedAgentRef.current
            ? "Describe the AI agent you want and I'll generate it right away. Short or long prompts both work — I'll expand short ones intelligently."
            : "Tell me what you want to build and I'll start generating right away. The more specific, the better.",
          time: "just now",
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isStreaming, setIsStreaming] = useState(false);

  // Detect if user prompt is asking for an AI agent
  const isAgentIntent = (text: string): boolean => {
    const t = text.toLowerCase();
    const patterns = [
      /\bai[\s-]?agent\b/,
      /\bai assistant\b/,
      /\bautonomous agent\b/,
      /\bchat ?bot\b/,
      /\bchatbot\b/,
      /\bllm agent\b/,
      /\bgpt agent\b/,
      /\bvirtual assistant\b/,
      /\bagent that\b/,
      /\bbuild .* agent\b/,
      /\bcreate .* agent\b/,
      /\bmake .* agent\b/,
      /\bdesign .* agent\b/,
      /\bcopilot\b/,
    ];
    return patterns.some((re) => re.test(t));
  };

  const createAgentFallback = (request: string): string => {
    const cleanRequest = request.trim() || "an AI agent for improving business resilience";
    const hasSales = /sales|lead|crm|pipeline|revenue/i.test(cleanRequest);
    const hasSupport = /support|customer|ticket|service|helpdesk/i.test(cleanRequest);
    const focus = hasSales ? "Revenue Resilience" : hasSupport ? "Customer Continuity" : "Business Resilience";

    return `1. Agent Name: ${focus} Agent

2. Description: This autonomous agent is designed around the request: ${cleanRequest}. It helps the business protect revenue, reduce operational drag, and make faster decisions during uncertain market conditions.

3. Primary Goal: Improve business resilience by turning the user's stated need into monitored actions, prioritized decisions, and measurable outcomes.

4. Autonomous Capabilities:
- Interprets incoming business signals and classifies urgency, risk, and opportunity.
- Monitors relevant workflows, customer inputs, operational data, and task queues.
- Recommends or triggers next-best actions based on business value and downside risk.
- Drafts messages, reports, plans, and follow-up actions for human review when needed.
- Escalates high-risk decisions, unusual patterns, or financial-impact actions to a human owner.
- Learns from approved outcomes to improve prioritization and response quality over time.

5. Step-by-Step Workflow:
1. Receives the user's request, business context, or connected workflow event.
2. Extracts the goal, stakeholders, constraints, risks, and success metrics.
3. Checks available data sources for relevant context and recent changes.
4. Produces a prioritized action plan with confidence levels and expected impact.
5. Executes low-risk automations such as drafts, summaries, routing, reminders, and updates.
6. Requests human approval for sensitive, costly, customer-facing, or irreversible actions.
7. Tracks results and updates future recommendations based on measurable outcomes.

6. Guardrails & Safety: The agent must not make financial commitments, legal claims, hiring decisions, customer refunds, or destructive system changes without human approval. It should protect private data, cite uncertainty clearly, log every action, and escalate when confidence is low or business risk is high.

7. Deployment Options: Deploy it as a dashboard assistant, embedded chat agent, scheduled background worker, CRM/helpdesk automation, internal API endpoint, or operations copilot connected to business tools.

8. Expected Impact: The business gets faster response cycles, clearer prioritization, lower manual workload, and better protection against revenue leakage. Over time, the agent should improve resilience by helping teams act earlier on risks and capture opportunities with less operational friction.`;
  };

  const streamFromNazAI = async (history: { role: "user" | "assistant"; content: string }[]) => {
    setIsStreaming(true);
    const assistantId = crypto.randomUUID();
    const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    const agentMode = isAgentIntent(lastUser);

    setMessages((m) => [
      ...m,
      {
        id: assistantId,
        role: "nazai",
        content: "",
        time: "just now",
        streaming: true,
        isAgent: agentMode,
      },
    ]);

    try {
      const endpoint = agentMode ? "generate-ai-agent" : "nazai-chat";
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`;
      const body = agentMode
        ? { prompt: lastUser, messages: history }
        : { messages: history, mode: chatMode };

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (resp.status === 429) {
        toast.error("Rate limit hit. Try again in a moment.");
        throw new Error("rate limit");
      }
      if (resp.status === 402) {
        toast.error("AI credits exhausted.");
        throw new Error("credits");
      }
      if (!resp.ok || !resp.body) throw new Error("Stream failed");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let done = false;

      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              setMessages((m) =>
                m.map((x) => (x.id === assistantId ? { ...x, content: acc } : x)),
              );
            }
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }

      if (buf.trim()) {
        for (let rawLine of buf.split("\n")) {
          if (rawLine.endsWith("\r")) rawLine = rawLine.slice(0, -1);
          if (!rawLine.startsWith("data: ")) continue;
          const json = rawLine.slice(6).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              setMessages((m) =>
                m.map((x) => (x.id === assistantId ? { ...x, content: acc } : x)),
              );
            }
          } catch {
            // Ignore incomplete trailing SSE fragments.
          }
        }
      }

      if (!acc.trim()) {
        throw new Error("No agent output received");
      }
    } catch (e) {
      console.error(e);
      setMessages((m) =>
        m.map((x) =>
          x.id === assistantId
            ? {
                ...x,
                content: x.content || (agentMode ? createAgentFallback(lastUser) : "Something went wrong reaching NazAI. Try again."),
              }
            : x,
        ),
      );
    } finally {
      setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, streaming: false } : x)));
      setIsStreaming(false);
    }
  };

  const sendPrompt = () => {
    const text = prompt.trim();
    if (!text || isStreaming) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      time: "just now",
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setPrompt("");
    const history = next
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));
    void streamFromNazAI(history);
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
                  <div className="text-sm text-zinc-200 leading-relaxed pl-9 prose prose-invert prose-sm max-w-none prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/10 prose-code:text-cyan-300 prose-headings:text-white">
                    {m.content ? (
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    ) : (
                      <span className="inline-flex gap-1 items-center text-zinc-500 text-xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                        NazAI is thinking…
                      </span>
                    )}
                  </div>
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
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse 70% 55% at 50% 60%, rgba(139,92,246,0.18) 0%, rgba(34,211,238,0.10) 35%, rgba(2,6,23,0) 70%)",
              }}
            />
            {(() => {
              const lastNaz = [...messages].reverse().find((m) => m.role === "nazai" && m.content);
              const lastUser = [...messages].reverse().find((m) => m.role === "user");
              if (!lastNaz) {
                return (
                  <div className="relative h-full flex flex-col items-center justify-center text-center px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
                      Waiting for your next step…
                    </h2>
                    <p className="text-zinc-500 text-sm mt-2">
                      Tell NazAI what to build and it will generate it here.
                    </p>
                  </div>
                );
              }
              return (
                <div className="relative h-full overflow-y-auto px-6 md:px-10 py-8">
                  <div className="max-w-3xl mx-auto">
                    {lastUser && !lastNaz.isAgent && (
                      <div className="mb-6">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-purple-300 mb-1">
                          Generating for
                        </div>
                        <div className="text-lg md:text-xl font-semibold text-white leading-snug">
                          {lastUser.content}
                        </div>
                      </div>
                    )}
                    <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm p-6 md:p-8 shadow-2xl">
                      {!lastNaz.isAgent && (
                        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
                          <div className="h-6 w-6 rounded-md bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-[10px] font-bold text-black">
                            N
                          </div>
                          <div className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-400">
                            NazAI · {chatMode}
                          </div>
                          {isStreaming && (
                            <span className="ml-auto text-[10px] font-mono text-purple-300 animate-pulse">
                              generating…
                            </span>
                          )}
                        </div>
                      )}
                      <div className="prose prose-invert prose-sm md:prose-base max-w-none prose-headings:text-white prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/10 prose-code:text-cyan-300">
                        <ReactMarkdown>{lastNaz.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </section>
      </div>
    </div>
  );
}

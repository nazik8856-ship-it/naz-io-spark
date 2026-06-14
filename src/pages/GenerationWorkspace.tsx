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
  Copy,
  Rocket,
  Save,
  Trash2,
  Play,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import LiveAgentChat from "@/components/agents/LiveAgentChat";

type AgentStatus = "pending" | "building" | "approved" | "removed";

type AgentTurn = { role: "user" | "assistant"; content: string };

type ChatMessage = {
  id: string;
  role: "user" | "nazai";
  content: string;
  time: string;
  streaming?: boolean;
  isAgent?: boolean;
  isPlan?: boolean;
  kind?: "agent-spec";
  agentStatus?: AgentStatus;
  editing?: boolean;
  agentName?: string;
  agentGreeting?: string;
  agentSuggestions?: string[];
  agentSystemPrompt?: string;
  agentFinalSpec?: string;
  agentChat?: AgentTurn[];
  agentStreaming?: boolean;
  agentError?: string;
  agentDebug?: {
    endpoint?: string;
    status?: number;
    firstChunk?: string;
    rawChars?: number;
    cleanedChars?: number;
    sectionsFound?: number;
    error?: string;
  };
};

function cleanAgentSpecOutput(text: string, opts: { final?: boolean } = {}): string {
  if (!text) return "";
  let cleaned = text
    .replace(/```(?:markdown|md|text)?/gi, "")
    .replace(/```/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\bbrand[-\s]?new\b/gi, "complete")
    .replace(/\bforging\b/gi, "building")
    .replace(/\bdetected\b/gi, "identified");

  // Only hard-slice on the final pass — slicing mid-stream blanks the UI
  // until the model finally emits the "1. Agent Name" header.
  if (opts.final) {
    const start = cleaned.search(/\b1\.\s*(?:\*\*)?\s*Agent Name/i);
    if (start > 0) cleaned = cleaned.slice(start);
  }

  if (opts.final) {
    cleaned = cleaned
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (/^>/.test(trimmed)) return false;
        if (/^(sure|here(?:'s| is)|nazai|output|final output|draft agent|offline fallback)\b/i.test(trimmed)) return false;
        if (/^(generating|building|identified)\b.*(?:agent|request|intent|plan)/i.test(trimmed)) return false;
        return true;
      })
      .join("\n");
  }
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
}

function parseAgentSpec(text: string) {
  const clean = cleanAgentSpecOutput(text);
  const get = (re: RegExp) => {
    const m = clean.match(re);
    return m ? m[1].trim().replace(/\*\*/g, "") : "";
  };
  const name = get(/1\.\s*(?:\*\*)?Agent Name(?:\*\*)?\s*:\s*([^\n]+)/i);
  const description = get(/2\.\s*(?:\*\*)?Description(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*3\.|$)/i);
  const goal = get(/3\.\s*(?:\*\*)?Primary Goal(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*4\.|$)/i);
  const capabilities = get(/4\.\s*(?:\*\*)?Autonomous Capabilities(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*5\.|$)/i);
  const workflow = get(/5\.\s*(?:\*\*)?Step-by-Step Workflow(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*6\.|$)/i);
  const guardrails = get(/6\.\s*(?:\*\*)?Guardrails(?:\s*&\s*Safety)?(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*7\.|$)/i);
  const deployment = get(/7\.\s*(?:\*\*)?Deployment Options(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*8\.|$)/i);
  const impact = get(/8\.\s*(?:\*\*)?Expected Impact(?:\*\*)?\s*:\s*([\s\S]*?)$/i);
  const capCount = capabilities
    ? capabilities.split("\n").filter((l) => /^\s*(?:[•\-*]|\d+\.)\s+\S/.test(l)).length
    : 0;
  return { name, description, goal, capabilities, workflow, guardrails, deployment, impact, capCount };
}

function toBullets(block: string): string[] {
  if (!block) return [];
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines
    .map((l) => l.replace(/^(?:[•\-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  return bullets.length ? bullets : [block.trim()];
}


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
  const forcedAgentRef = useRef<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  type SavedAgent = { id: string; name: string; spec: string; systemPrompt?: string; savedAt: string };
  const [savedAgents, setSavedAgents] = useState<SavedAgent[]>(() => {
    try {
      // One-time migration: drop stale agents written by the old createAgentFallback build.
      if (typeof window !== "undefined") localStorage.removeItem("nazai_saved_agents");
      return JSON.parse(localStorage.getItem("nazai_saved_agents_v2") || "[]") as SavedAgent[];
    } catch { return []; }
  });
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);

  const persistSaved = (next: SavedAgent[]) => {
    setSavedAgents(next);
    localStorage.setItem("nazai_saved_agents_v2", JSON.stringify(next));
  };

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

  // Fake fallback removed — real errors must surface so we never ship a fabricated agent.


  const streamFromNazAI = async (history: { role: "user" | "assistant"; content: string }[]) => {
    setIsStreaming(true);
    const assistantId = crypto.randomUUID();
    const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    // This workspace IS the Agent Generator — every prompt produces an agent spec.
    // Scoped to GenerationWorkspace only; does not affect /dashboard, /workflower, etc.
    const agentMode = true;
    forcedAgentRef.current = true;
    const planMode = false;

    setMessages((m) => [
      ...m,
      {
        id: assistantId,
        role: "nazai",
        content: "",
        time: "just now",
        streaming: true,
        isAgent: agentMode,
        isPlan: planMode,
        kind: agentMode ? "agent-spec" : undefined,
        agentStatus: agentMode ? "pending" : undefined,
      },
    ]);


    // Cancel any in-flight generation so a new prompt doesn't race the previous one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

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
        signal: controller.signal,
      });

      console.info("[NazAI Agent Gen] response", { endpoint, status: resp.status, ok: resp.ok });
      setMessages((m) =>
        m.map((x) =>
          x.id === assistantId
            ? { ...x, agentDebug: { ...(x.agentDebug ?? {}), endpoint, status: resp.status } }
            : x,
        ),
      );


      if (resp.status === 429) {
        toast.error("Rate limited — try again in a moment.");
        throw new Error("Rate limited. Please retry shortly.");
      }
      if (resp.status === 402) {
        toast.error("Out of AI credits.");
        throw new Error("AI credits exhausted.");
      }
      if (resp.status === 401 || resp.status === 403) {
        toast.error("Session expired — please sign in again.");
        throw new Error("Not authorized. Please sign in again.");
      }
      if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`Generation failed (${resp.status}). ${detail.slice(0, 200)}`);
      }

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
              const nextContent = agentMode ? cleanAgentSpecOutput(acc) : acc;
              setMessages((m) =>
                m.map((x) => (x.id === assistantId ? { ...x, content: nextContent } : x)),
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
              const nextContent = agentMode ? cleanAgentSpecOutput(acc) : acc;
              setMessages((m) =>
                m.map((x) => (x.id === assistantId ? { ...x, content: nextContent } : x)),
              );
            }
          } catch {
            // Ignore incomplete trailing SSE fragments.
          }
        }
      }

      if (!acc.trim()) {
        throw new Error("No agent output received — try again.");
      }
      if (agentMode) {
        // Keep the model's full spec — never replace with the generic short summary.
        const finalClean = cleanAgentSpecOutput(acc, { final: true }) || cleanAgentSpecOutput(acc) || acc;
        setMessages((m) =>
          m.map((x) =>
            x.id === assistantId ? { ...x, content: finalClean } : x,
          ),
        );

        // Auto-chain: plan stream finished → immediately compile + activate the agent.
        // No "Approve & Build" click required. buildAgent handles save + init.
        if (!controller.signal.aborted) {
          void buildAgent(assistantId, finalClean);
        }
      }
    } catch (e) {
      if (controller.signal.aborted) {
        // Superseded by a newer prompt — silent.
        return;
      }
      console.error(e);
      const errMsg = e instanceof Error ? e.message : "Generation failed. Please try again.";
      toast.error(errMsg);
      setMessages((m) =>
        m.map((x) =>
          x.id === assistantId
            ? {
                ...x,
                content: x.content,
                agentStatus: agentMode ? "removed" : x.agentStatus,
                agentError: errMsg,
              }
            : x,
        ),
      );
    } finally {
      setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, streaming: false } : x)));
      setIsStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
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

  const buildAgentFromPlan = () => {
    if (isStreaming) return;
    const lastPlan = [...messages].reverse().find((m) => m.role === "nazai" && m.isPlan && m.content);
    if (!lastPlan) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "an autonomous AI agent";

    const trigger = "Build the AI agent from the plan above.";
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trigger,
      time: "just now",
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setChatMode("build");
    forcedAgentRef.current = true;

    const history = next
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.role === "user" && m.id === userMsg.id
          ? `${trigger}\n\nOriginal request: ${lastUser}\n\nPlan to implement:\n${lastPlan.content}`
          : m.content,
      }));
    void streamFromNazAI(history);
  };

  // --- Agent spec card handlers (Build / Edit / Remove) ---
  const updateMsg = (id: string, patch: Partial<ChatMessage>) =>
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const buildingRef = useRef<Set<string>>(new Set());

  const buildAgent = async (id: string, specOverride?: string) => {
    if (buildingRef.current.has(id)) return;
    // Read latest state via functional setter to avoid stale-closure bugs after streaming.
    let latestMsg: ChatMessage | undefined;
    setMessages((all) => {
      latestMsg = all.find((x) => x.id === id);
      return all;
    });
    const sourceSpec = cleanAgentSpecOutput(specOverride || latestMsg?.content || "");
    if (!sourceSpec) return;
    if (
      latestMsg &&
      (latestMsg.agentStatus === "building" ||
        (latestMsg.agentStatus === "approved" && !specOverride))
    ) {
      return;
    }
    buildingRef.current.add(id);
    // Keep source spec visible while building so nothing flashes/closes.
    updateMsg(id, {
      content: sourceSpec,
      agentStatus: "building",
      editing: false,
      agentError: undefined,
    });

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-ai-agent`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ spec: sourceSpec, mode: "build" }),
      });
      if (resp.status === 429) throw new Error("Rate limit hit. Try again in a moment.");
      if (resp.status === 402) throw new Error("AI credits exhausted.");
      if (!resp.ok || !resp.body) throw new Error("Could not build agent.");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let finalPayload: { name?: string; finalSpec?: string; systemPrompt?: string } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const evt = JSON.parse(json);
            if (evt.type === "delta" && typeof evt.content === "string") {
              acc += evt.content;
              const partial = cleanAgentSpecOutput(acc) || sourceSpec;
              updateMsg(id, { content: partial, agentStatus: "building" });
            } else if (evt.type === "final") {
              finalPayload = evt;
            } else if (evt.type === "error") {
              throw new Error(evt.message || "Stream interrupted");
            }
          } catch (err) {
            if (err instanceof Error && err.message === "Stream interrupted") throw err;
            // partial JSON — re-buffer
            buf = line + "\n" + buf;
            break;
          }
        }
      }

      const finalSpec =
        cleanAgentSpecOutput(finalPayload?.finalSpec || acc, { final: true }) || sourceSpec;
      const name = finalPayload?.name || parseAgentSpec(finalSpec).name || "AI Agent";
      updateMsg(id, {
        content: finalSpec,
        agentStatus: "approved",
        agentName: name,
        agentFinalSpec: finalSpec,
        agentSystemPrompt: finalPayload?.systemPrompt,
        agentError: undefined,
      });
      // Auto-save to Dashboard
      const entry: SavedAgent = {
        id,
        name,
        spec: finalSpec,
        systemPrompt: finalPayload?.systemPrompt,
        savedAt: new Date().toISOString(),
      };
      const current = JSON.parse(localStorage.getItem("nazai_saved_agents_v2") || "[]") as SavedAgent[];
      const next = [entry, ...current.filter((a) => a.id !== id)];
      persistSaved(next);
      toast.success("Agent built — bringing it to life…");

      // BRING THE AGENT TO LIFE: bootstrap greeting + suggested prompts via INIT mode
      try {
        const initUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-ai-agent`;
        const initResp = await fetch(initUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ spec: finalSpec, messages: [] }),
        });
        if (initResp.ok) {
          const initData = await initResp.json();
          const greeting: string = initData.greeting || `Hi, I'm ${name}. How can I help?`;
          const suggestions: string[] = Array.isArray(initData.suggestedPrompts) ? initData.suggestedPrompts : [];
          updateMsg(id, {
            agentGreeting: greeting,
            agentSuggestions: suggestions,
            agentChat: [{ role: "assistant", content: greeting }],
          });
          setSelectedSavedId(id);
          // Keep Preview active so the complete 8-section card stays visible.
          // User can click "Live" to switch to Chat.
          toast.success("Agent is live — open Chat to talk to it.");
        }
      } catch (initErr) {
        console.warn("agent init failed", initErr);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Could not build agent.";
      toast.error(errMsg);
      // Preserve generated spec visibly but DO NOT fake approval — show real error and allow retry.
      const salvaged = cleanAgentSpecOutput(sourceSpec, { final: true }) || sourceSpec;
      updateMsg(id, {
        content: salvaged,
        agentStatus: "pending",
        agentError: errMsg,
      });
      // Do not auto-save failed builds; user can retry via "Approve & Build".
    } finally {
      buildingRef.current.delete(id);
    }
  };

  const removeSavedAgent = (id: string) => {
    persistSaved(savedAgents.filter((a) => a.id !== id));
    if (selectedSavedId === id) setSelectedSavedId(null);
    toast.success("Agent removed.");
  };

  const removeAgent = (id: string) => updateMsg(id, { agentStatus: "removed", editing: false });
  const startEditAgent = (id: string) => updateMsg(id, { editing: true });
  const saveEditAgent = (id: string, content: string) => {
    const cleaned = cleanAgentSpecOutput(content);
    updateMsg(id, { content: cleaned, editing: false, agentStatus: "pending" });
    void buildAgent(id, cleaned);
  };

  const copyAgentSpec = async (spec: string) => {
    await navigator.clipboard.writeText(cleanAgentSpecOutput(spec));
    toast.success("Spec copied.");
  };

  const deployAgentPreview = () => {
    setActiveTab("preview");
    toast.success("Deploy preview ready on this page.");
  };

  const saveAgent = (msg: ChatMessage) => {
    const saved = JSON.parse(localStorage.getItem("nazai_saved_agents_v2") || "[]") as unknown[];
    const finalSpec = cleanAgentSpecOutput(msg.agentFinalSpec || msg.content);
    localStorage.setItem(
      "nazai_saved_agents_v2",
      JSON.stringify([
        { id: msg.id, name: msg.agentName || parseAgentSpec(finalSpec).name || "AI Agent", spec: finalSpec, savedAt: new Date().toISOString() },
        ...saved.filter((item: any) => item?.id !== msg.id),
      ]),
    );
    toast.success("Agent saved.");
  };

  const sendAgentTurn = async (id: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const msg = messages.find((x) => x.id === id);
    if (!msg || msg.agentStreaming) return;

    const baseChat = msg.agentChat ?? [];
    const nextChat: AgentTurn[] = [
      ...baseChat,
      { role: "user", content: trimmed },
      { role: "assistant", content: "" },
    ];
    updateMsg(id, { agentChat: nextChat, agentStreaming: true });

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-ai-agent`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          spec: msg.content,
          messages: nextChat
            .slice(0, -1) // drop the empty assistant placeholder
            .map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      if (resp.status === 429) throw new Error("Rate limit hit. Try again in a moment.");
      if (resp.status === 402) throw new Error("AI credits exhausted.");
      if (!resp.ok || !resp.body) throw new Error("Agent failed to respond.");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let done = false;

      const flushAssistant = () =>
        setMessages((all) =>
          all.map((x) => {
            if (x.id !== id || !x.agentChat) return x;
            const copy = [...x.agentChat];
            copy[copy.length - 1] = { role: "assistant", content: acc };
            return { ...x, agentChat: copy };
          }),
        );

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
              flushAssistant();
            }
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }

      if (!acc.trim()) {
        acc = "(no response — try again)";
        flushAssistant();
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Agent error.";
      toast.error(errMsg);
      setMessages((all) =>
        all.map((x) => {
          if (x.id !== id || !x.agentChat) return x;
          const copy = [...x.agentChat];
          copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${errMsg}` };
          return { ...x, agentChat: copy };
        }),
      );
    } finally {
      updateMsg(id, { agentStreaming: false });
    }
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
          {([
            { id: "preview" as const, label: "Preview" },
            { id: "dashboard" as const, label: "Chat" },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
                activeTab === t.id
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {t.label}
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
                    {m.kind === "agent-spec" && m.content ? (
                      (() => {
                        const spec = parseAgentSpec(m.content);
                        const dismissed = m.agentStatus === "removed";
                        if (m.editing) {
                          return (
                            <div className="not-prose rounded-xl border border-purple-400/30 bg-black/40 p-3 space-y-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-purple-300">Editing agent spec</div>
                              <textarea
                                defaultValue={m.content}
                                rows={10}
                                id={`edit-${m.id}`}
                                className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs font-mono text-zinc-100 outline-none focus:border-purple-400/60"
                              />
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => updateMsg(m.id, { editing: false })}
                                  className="px-3 py-1.5 rounded-md text-xs text-zinc-300 hover:bg-white/5"
                                >Cancel</button>
                                <button
                                  onClick={() => {
                                    const el = document.getElementById(`edit-${m.id}`) as HTMLTextAreaElement | null;
                                    if (el) saveEditAgent(m.id, el.value);
                                  }}
                                  className="px-3 py-1.5 rounded-md text-xs font-semibold text-black bg-gradient-to-r from-purple-500 to-cyan-400"
                                >Save &amp; Build</button>
                              </div>
                            </div>
                          );
                        }
                        const expanded = !dismissed && (m.agentStatus === "approved" || !!m.agentFinalSpec);
                        return (
                          <div className={`not-prose rounded-xl border bg-black/40 p-4 space-y-3 ${dismissed ? "border-white/5 opacity-60" : "border-purple-400/30"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className={`text-base font-bold ${dismissed ? "line-through text-zinc-500" : "text-white"}`}>
                                {spec.name || "AI Agent"}
                              </div>
                              {m.agentStatus === "approved" && (
                                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-300 border border-emerald-400/30">Live</span>
                              )}
                              {m.agentStatus === "building" && (
                                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-400/15 text-cyan-300 border border-cyan-400/30 animate-pulse">Booting</span>
                              )}
                              {m.agentStatus === "pending" && !m.streaming && (
                                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-400/15 text-purple-300 border border-purple-400/30">Pending</span>
                              )}
                            </div>

                            {expanded ? (
                              <div className="space-y-3">
                                {spec.description && (
                                  <section>
                                    <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 mb-1 font-mono">Description</div>
                                    <p className="text-[12px] text-zinc-200 leading-relaxed">{spec.description}</p>
                                  </section>
                                )}
                                {spec.goal && (
                                  <section className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2">
                                    <div className="text-[9px] uppercase tracking-[0.2em] text-cyan-300 mb-0.5 font-mono">🎯 Primary Goal</div>
                                    <p className="text-[12px] text-white">{spec.goal}</p>
                                  </section>
                                )}
                                {spec.capabilities && (
                                  <section>
                                    <div className="text-[9px] uppercase tracking-[0.2em] text-purple-300 mb-1.5 font-mono">⚡ Autonomous Capabilities</div>
                                    <ul className="space-y-1">
                                      {toBullets(spec.capabilities).map((b, i) => (
                                        <li key={i} className="text-[12px] text-zinc-200 flex gap-2"><span className="text-purple-400">▸</span><span className="flex-1">{b}</span></li>
                                      ))}
                                    </ul>
                                  </section>
                                )}
                                {spec.workflow && (
                                  <section>
                                    <div className="text-[9px] uppercase tracking-[0.2em] text-emerald-300 mb-1.5 font-mono">🔄 Step-by-Step Workflow</div>
                                    <ol className="space-y-1 list-none">
                                      {toBullets(spec.workflow).map((b, i) => (
                                        <li key={i} className="text-[12px] text-zinc-200 flex gap-2"><span className="shrink-0 h-4 w-4 rounded bg-emerald-400/15 text-emerald-300 text-[9px] font-bold flex items-center justify-center font-mono">{i + 1}</span><span className="flex-1">{b}</span></li>
                                      ))}
                                    </ol>
                                  </section>
                                )}
                                {spec.guardrails && (
                                  <section className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2">
                                    <div className="text-[9px] uppercase tracking-[0.2em] text-amber-300 mb-1 font-mono">🛡 Guardrails & Safety</div>
                                    <ul className="space-y-0.5">{toBullets(spec.guardrails).map((b, i) => (<li key={i} className="text-[11px] text-zinc-200">• {b}</li>))}</ul>
                                  </section>
                                )}
                                {spec.deployment && (
                                  <section className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                                    <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-400 mb-1 font-mono">🚀 Deployment Options</div>
                                    <ul className="space-y-0.5">{toBullets(spec.deployment).map((b, i) => (<li key={i} className="text-[11px] text-zinc-200">• {b}</li>))}</ul>
                                  </section>
                                )}
                                {spec.impact && (
                                  <section className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2">
                                    <div className="text-[9px] uppercase tracking-[0.2em] text-emerald-300 mb-0.5 font-mono">📈 Expected Impact</div>
                                    <p className="text-[12px] text-white">{spec.impact}</p>
                                  </section>
                                )}
                              </div>
                            ) : (
                              <>
                                {spec.description && (
                                  <div className="text-[12px] text-zinc-300 leading-relaxed line-clamp-2">{spec.description}</div>
                                )}
                                {spec.goal && (
                                  <div className="text-[11px] text-cyan-300/90 line-clamp-1">🎯 {spec.goal}</div>
                                )}
                                <div className="text-[10px] font-mono text-zinc-500">
                                  {spec.capCount || 6} capabilities · workflow ready
                                </div>
                              </>
                            )}

                            {!m.streaming && (
                              <div className="flex gap-1.5 pt-1">
                                {dismissed ? (
                                  <button
                                    onClick={() => updateMsg(m.id, { agentStatus: "pending" })}
                                    className="px-2.5 py-1 rounded-md text-[11px] text-zinc-300 border border-white/10 hover:bg-white/5"
                                  >Restore</button>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => void buildAgent(m.id)}
                                      disabled={m.agentStatus === "approved" || m.agentStatus === "building"}
                                      className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-black bg-gradient-to-r from-purple-500 to-cyan-400 disabled:opacity-50"
                                    >{m.agentStatus === "approved" ? "Live" : m.agentStatus === "building" ? "Booting…" : "Approve & Build"}</button>
                                    <button
                                      onClick={() => startEditAgent(m.id)}
                                      className="px-2.5 py-1 rounded-md text-[11px] text-zinc-200 border border-white/10 hover:bg-white/5"
                                    >Edit</button>
                                    <button
                                      onClick={() => removeAgent(m.id)}
                                      className="px-2.5 py-1 rounded-md text-[11px] text-zinc-400 hover:text-red-300 hover:bg-red-500/10"
                                    >Remove</button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : m.content ? (
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    ) : (
                      <span className="inline-flex gap-1 items-center text-zinc-500 text-xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                        NazAI is thinking…
                      </span>
                    )}
                  </div>
                  {m.isPlan && !m.streaming && m.content && (
                    <div className="pl-9">
                      <button
                        onClick={buildAgentFromPlan}
                        disabled={isStreaming}
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-cyan-400 text-black text-xs font-semibold hover:opacity-90 disabled:opacity-40"
                      >
                        <Hammer className="h-3.5 w-3.5" />
                        Build Agent from this plan
                      </button>
                    </div>
                  )}
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
              // CHAT TAB → live chat with the selected (or latest) built agent
              if (activeTab === "dashboard") {
                const approvedMsgs = messages.filter(
                  (m) => m.role === "nazai" && m.kind === "agent-spec" && m.agentStatus === "approved",
                );
                const lastApproved = approvedMsgs[approvedMsgs.length - 1];
                const selected = selectedSavedId
                  ? savedAgents.find((a) => a.id === selectedSavedId)
                  : null;

                // Prefer in-session approved (has live agentChat); else hydrate from saved
                let chatMsg = lastApproved;
                if (selected && (!chatMsg || chatMsg.id !== selected.id)) {
                  chatMsg = messages.find((m) => m.id === selected.id) || {
                    id: selected.id,
                    role: "nazai",
                    content: selected.spec,
                    time: "saved",
                    kind: "agent-spec",
                    agentStatus: "approved",
                    agentName: selected.name,
                    agentFinalSpec: selected.spec,
                    agentSystemPrompt: selected.systemPrompt,
                    agentChat: [],
                  };
                }

                if (!chatMsg && savedAgents.length === 0) {
                  return (
                    <div className="relative h-full flex flex-col items-center justify-center text-center px-6">
                      <h2 className="text-xl font-bold">No agent yet</h2>
                      <p className="text-zinc-500 text-sm mt-2">Build an agent in the Preview tab to start chatting.</p>
                    </div>
                  );
                }

                if (!chatMsg) {
                  // Pick first saved if nothing in-session
                  const fallback = savedAgents[0];
                  chatMsg = {
                    id: fallback.id,
                    role: "nazai",
                    content: fallback.spec,
                    time: "saved",
                    kind: "agent-spec",
                    agentStatus: "approved",
                    agentName: fallback.name,
                    agentFinalSpec: fallback.spec,
                    agentSystemPrompt: fallback.systemPrompt,
                    agentChat: [],
                  };
                }

                const parsed = parseAgentSpec(chatMsg.agentFinalSpec || chatMsg.content);
                const name = chatMsg.agentName || parsed.name || "AI Agent";

                // Ensure live message exists in messages array so sendAgentTurn works
                const liveMsg = messages.find((m) => m.id === chatMsg!.id);
                if (!liveMsg) {
                  // Inject into messages on first chat-open so streaming works
                  setTimeout(() => {
                    setMessages((m) => (m.find((x) => x.id === chatMsg!.id) ? m : [...m, chatMsg!]));
                  }, 0);
                }
                const turns = liveMsg?.agentChat ?? chatMsg.agentChat ?? [];
                const streaming = !!liveMsg?.agentStreaming;

                return (
                  <div className="relative h-full flex">
                    {savedAgents.length > 0 && (
                      <div className="w-56 border-r border-white/10 overflow-y-auto p-3 space-y-1.5 hidden md:block">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 px-2 mb-1">Agents</div>
                        {savedAgents.map((a) => {
                          const active = (selectedSavedId ?? lastApproved?.id) === a.id;
                          return (
                            <div
                              key={a.id}
                              className={`group flex items-center gap-1 rounded-lg ${active ? "bg-white/10" : "hover:bg-white/5"}`}
                            >
                              <button
                                onClick={() => setSelectedSavedId(a.id)}
                                className="flex-1 text-left px-2.5 py-2 text-xs text-white truncate"
                              >
                                {a.name}
                              </button>
                              <button
                                onClick={() => removeSavedAgent(a.id)}
                                className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-500 hover:text-red-300"
                                title="Remove"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <LiveAgentChat
                        agentId={chatMsg.id}
                        name={name}
                        goal={parsed.goal}
                        turns={turns}
                        suggestions={chatMsg.agentSuggestions ?? []}
                        streaming={streaming}
                        fullSpec={chatMsg.agentFinalSpec || chatMsg.content}
                        onSend={(text) => void sendAgentTurn(chatMsg!.id, text)}
                      />
                    </div>
                  </div>
                );
              }

              // PREVIEW TAB: always prefer the latest agent-spec message (pending, building, approved)
              const lastAgent = [...messages].reverse().find(
                (m) => m.role === "nazai" && m.kind === "agent-spec",
              );
              const lastNaz = lastAgent ?? [...messages].reverse().find((m) => m.role === "nazai" && !!m.content);
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

              // UNIFIED AGENT CARD — pending / building / approved all share one rich layout
              if (lastNaz.kind === "agent-spec") {
                const status = lastNaz.agentStatus || "pending";
                const dismissed = status === "removed";
                const sourceSpec = lastNaz.agentFinalSpec || lastNaz.content || "";
                const cleaned = cleanAgentSpecOutput(sourceSpec, { final: status === "approved" }) || sourceSpec;
                const spec = parseAgentSpec(cleaned);
                const agentName = lastNaz.agentName || spec.name || "AI Agent";
                const isStreamingNow = !!lastNaz.streaming || status === "building";
                const showBody = cleaned.trim().length > 0;

                const accent =
                  status === "approved"
                    ? { ring: "border-emerald-400/30", glow: "shadow-emerald-500/10", chipBg: "bg-emerald-400/15", chipText: "text-emerald-300", chipBorder: "border-emerald-400/30", dot: "bg-emerald-400", banner: "bg-emerald-400/5", label: "Agent successfully built!", chipLabel: "Built" }
                    : status === "building"
                    ? { ring: "border-cyan-400/40", glow: "shadow-cyan-500/10", chipBg: "bg-cyan-400/15", chipText: "text-cyan-300", chipBorder: "border-cyan-400/30", dot: "bg-cyan-400 animate-pulse", banner: "bg-cyan-400/5", label: "Building agent live…", chipLabel: "Booting" }
                    : { ring: "border-purple-400/30", glow: "shadow-purple-500/10", chipBg: "bg-purple-400/15", chipText: "text-purple-300", chipBorder: "border-purple-400/30", dot: "bg-purple-400 animate-pulse", banner: "bg-purple-400/5", label: isStreamingNow ? "Generating agent…" : "Agent plan ready", chipLabel: isStreamingNow ? "Drafting" : "Pending" };

                return (
                  <div className="relative h-full overflow-y-auto px-6 md:px-10 py-8">
                    <div className={`max-w-4xl mx-auto rounded-xl border bg-black/55 backdrop-blur-sm overflow-hidden shadow-2xl ${accent.ring} ${accent.glow} ${dismissed ? "opacity-50" : ""}`}>
                      <div className={`flex items-start justify-between gap-4 p-5 border-b border-white/10 ${accent.banner}`}>
                        <div className="min-w-0">
                          <div className={`text-[10px] uppercase tracking-[0.22em] font-mono mb-2 ${accent.chipText} ${isStreamingNow ? "animate-pulse" : ""}`}>
                            {isStreamingNow ? "▮ " : ""}{accent.label}
                          </div>
                          <h1 className="text-2xl md:text-3xl font-bold text-white truncate">{agentName}</h1>
                          {spec.goal && <p className="text-sm text-cyan-200/90 mt-2 line-clamp-2">🎯 {spec.goal}</p>}
                        </div>
                        <span className={`shrink-0 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded inline-flex items-center gap-1 ${accent.chipBg} ${accent.chipText} border ${accent.chipBorder}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
                          {accent.chipLabel}
                        </span>
                      </div>

                      <div className="p-5 md:p-7">
                        {lastNaz.editing ? (
                          <div className="rounded-xl border border-purple-400/30 bg-black/40 p-3 space-y-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-purple-300">Editing agent spec</div>
                            <textarea
                              defaultValue={cleaned}
                              rows={18}
                              id={`edit-preview-${lastNaz.id}`}
                              className="w-full bg-black/60 border border-white/10 rounded-lg p-3 text-xs font-mono text-zinc-100 outline-none focus:border-purple-400/60"
                            />
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => updateMsg(lastNaz.id, { editing: false })}
                                className="px-3 py-1.5 rounded-md text-xs text-zinc-300 hover:bg-white/5"
                              >Cancel</button>
                              <button
                                onClick={() => {
                                  const el = document.getElementById(`edit-preview-${lastNaz.id}`) as HTMLTextAreaElement | null;
                                  if (el) saveEditAgent(lastNaz.id, el.value);
                                }}
                                className="px-3 py-1.5 rounded-md text-xs font-semibold text-black bg-gradient-to-r from-purple-500 to-cyan-400"
                              >Save &amp; Build</button>
                            </div>
                          </div>
                        ) : showBody ? (
                          <div className="space-y-5">
                            {spec.description && (
                              <section>
                                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5 font-mono">Description</div>
                                <p className="text-sm md:text-base text-zinc-100 leading-relaxed">{spec.description}</p>
                              </section>
                            )}
                            {spec.goal && (
                              <section className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-4 py-3">
                                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300 mb-1 font-mono">🎯 Primary Goal</div>
                                <p className="text-sm md:text-base text-white">{spec.goal}</p>
                              </section>
                            )}
                            {spec.capabilities && (
                              <section>
                                <div className="text-[10px] uppercase tracking-[0.2em] text-purple-300 mb-2 font-mono">⚡ Autonomous Capabilities</div>
                                <ul className="space-y-1.5">
                                  {toBullets(spec.capabilities).map((b, i) => (
                                    <li key={i} className="text-sm text-zinc-200 flex gap-2">
                                      <span className="text-purple-400 mt-0.5">▸</span>
                                      <span className="flex-1">{b}</span>
                                    </li>
                                  ))}
                                </ul>
                              </section>
                            )}
                            {spec.workflow && (
                              <section>
                                <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300 mb-2 font-mono">🔄 Step-by-Step Workflow</div>
                                <ol className="space-y-1.5 list-none">
                                  {toBullets(spec.workflow).map((b, i) => (
                                    <li key={i} className="text-sm text-zinc-200 flex gap-3">
                                      <span className="shrink-0 h-5 w-5 rounded-md bg-emerald-400/15 text-emerald-300 text-[10px] font-bold flex items-center justify-center font-mono">{i + 1}</span>
                                      <span className="flex-1 pt-0.5">{b}</span>
                                    </li>
                                  ))}
                                </ol>
                              </section>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {spec.guardrails && (
                                <section className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3">
                                  <div className="text-[10px] uppercase tracking-[0.2em] text-amber-300 mb-1.5 font-mono">🛡 Guardrails & Safety</div>
                                  <ul className="space-y-1">
                                    {toBullets(spec.guardrails).map((b, i) => (
                                      <li key={i} className="text-xs text-zinc-200">• {b}</li>
                                    ))}
                                  </ul>
                                </section>
                              )}
                              {spec.deployment && (
                                <section className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 mb-1.5 font-mono">🚀 Deployment Options</div>
                                  <ul className="space-y-1">
                                    {toBullets(spec.deployment).map((b, i) => (
                                      <li key={i} className="text-xs text-zinc-200">• {b}</li>
                                    ))}
                                  </ul>
                                </section>
                              )}
                            </div>
                            {spec.impact && (
                              <section className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-4 py-3">
                                <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300 mb-1 font-mono">📈 Expected Impact</div>
                                <p className="text-sm text-white">{spec.impact}</p>
                              </section>
                            )}
                            {!spec.description && !spec.goal && !spec.capabilities && (
                              <div className="prose prose-invert prose-sm md:prose-base max-w-none prose-headings:text-white prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/10 prose-code:text-cyan-300">
                                <ReactMarkdown>{cleaned}</ReactMarkdown>
                              </div>
                            )}
                            {isStreamingNow && (
                              <div className="flex items-center gap-2 text-xs text-zinc-500 pt-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                {status === "building" ? "Compiling final agent…" : "Streaming agent spec…"}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-zinc-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                            Generating your agent…
                          </div>
                        )}

                        {lastNaz.agentError && (
                          <div className="mt-4 text-[11px] text-amber-300/90 bg-amber-400/5 border border-amber-400/20 rounded-md px-3 py-2">
                            {lastNaz.agentError}
                          </div>
                        )}

                        {!lastNaz.editing && (
                          <div className="mt-6 pt-5 border-t border-white/10 flex flex-wrap gap-2">
                            <button
                              onClick={() => void buildAgent(lastNaz.id)}
                              disabled={isStreamingNow || status === "approved" || !showBody}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-cyan-400 text-black text-sm font-semibold hover:opacity-90 disabled:opacity-40"
                            >
                              <Hammer className="h-4 w-4" />
                              {status === "approved" ? "Built" : status === "building" ? "Booting…" : "Approve & Build"}
                            </button>
                            <button
                              onClick={() => setActiveTab("dashboard")}
                              disabled={status !== "approved"}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 text-black text-sm font-semibold hover:opacity-90 disabled:opacity-40"
                            >
                              <Play className="h-4 w-4" />
                              Live
                            </button>
                            <button
                              onClick={() => startEditAgent(lastNaz.id)}
                              disabled={isStreamingNow || !showBody}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 border border-white/10 disabled:opacity-40"
                            >
                              <Pencil className="h-4 w-4 text-purple-300" />
                              Edit
                            </button>
                            <button
                              onClick={() => { removeAgent(lastNaz.id); removeSavedAgent(lastNaz.id); }}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-red-300 text-sm font-semibold hover:bg-red-500/10 border border-white/10"
                            >
                              <Trash2 className="h-4 w-4" />
                              Remove
                            </button>
                            {status === "approved" && (
                              <>
                                <button
                                  onClick={deployAgentPreview}
                                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-cyan-400 text-black text-sm font-semibold hover:opacity-90"
                                >
                                  <Rocket className="h-4 w-4" />
                                  Deploy
                                </button>
                                <button
                                  onClick={() => void copyAgentSpec(cleaned)}
                                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 border border-white/10"
                                >
                                  <Copy className="h-4 w-4 text-cyan-300" />
                                  Copy
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {savedAgents.length > 1 && (
                      <div className="max-w-4xl mx-auto mt-8">
                        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-3">Your Agents</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {savedAgents.map((a) => (
                            <button
                              key={a.id}
                              onClick={() => { setSelectedSavedId(a.id); setActiveTab("dashboard"); }}
                              className="text-left rounded-xl border border-white/10 bg-black/40 p-4 hover:border-purple-400/50 transition"
                            >
                              <div className="text-sm font-bold text-white truncate">{a.name}</div>
                              <div className="text-[10px] font-mono text-zinc-500 mt-1">{new Date(a.savedAt).toLocaleString()}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              // Non-agent NazAI reply fallback
              return (
                <div className="relative h-full overflow-y-auto px-6 md:px-10 py-8">
                  <div className="max-w-3xl mx-auto">
                    {lastUser && (
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

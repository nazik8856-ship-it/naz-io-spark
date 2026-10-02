import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, ChevronDown, ChevronUp, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

type AgentTurn = { role: "user" | "assistant"; content: string; node?: ReactNode };

type Props = {
  agentId: string;
  name: string;
  goal?: string;
  turns: AgentTurn[];
  suggestions: string[];
  streaming: boolean;
  fullSpec: string;
  onSend: (text: string) => void;
  composerExtras?: ReactNode;
  /** Live multi-step progress rendered instead of a generic "thinking…" dot. */
  executionLog?: ReactNode;
  /**
   * Tighter spacing/sizing for a status-log-style sidebar (e.g. the Control
   * System's Agent Status panel) instead of the default spacious
   * messaging-app look used by the website/agent builder chats.
   */
  compact?: boolean;
};

export default function LiveAgentChat({
  agentId,
  name,
  goal,
  turns,
  suggestions,
  streaming,
  fullSpec,
  onSend,
  composerExtras,
  executionLog,
  compact = false,
}: Props) {
  const [input, setInput] = useState("");
  const [showSpec, setShowSpec] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, streaming]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [agentId]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    onSend(text);
  };

  return (
    <div className={cn("relative h-full flex flex-col", compact ? "px-3 py-3" : "px-4 md:px-8 py-5")}>
      <div className={cn("w-full mx-auto flex-1 flex flex-col min-h-0", !compact && "max-w-3xl")}>
        {/* Header */}
        <div className={cn("flex items-center border-b border-white/10", compact ? "gap-2 pb-2" : "gap-3 pb-3")}>
          <div
            className={cn(
              "rounded-xl bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-black shrink-0",
              compact ? "h-7 w-7" : "h-10 w-10",
            )}
          >
            <Bot className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} />
          </div>
          <div className="flex-1 min-w-0">
            <div className={cn("font-bold text-white truncate", compact ? "text-sm" : "text-base")}>{name}</div>
            {goal && (
              <div className="text-[11px] text-cyan-300/90 truncate">🎯 {goal}</div>
            )}
          </div>
          <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-400/15 text-emerald-300 border border-emerald-400/30 inline-flex items-center gap-1 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className={cn("flex-1 overflow-y-auto", compact ? "py-2 space-y-1.5" : "py-4 space-y-3")}>
          {turns.length === 0 && (
            <div className="text-sm text-zinc-500 italic">Agent is ready.</div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
              {t.role === "user" ? (
                <div
                  className={cn(
                    "max-w-[80%] bg-purple-500/15 border border-purple-400/30 text-white",
                    compact ? "rounded-lg px-2.5 py-1.5 text-[13px]" : "rounded-2xl px-3.5 py-2 text-sm",
                  )}
                >
                  {t.content}
                </div>
              ) : (
                <div
                  className={cn(
                    "max-w-[85%] bg-white/[0.04] border border-white/10 text-zinc-100 prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:text-white prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/10 prose-code:text-cyan-300",
                    compact ? "rounded-lg px-2.5 py-1.5 text-[13px]" : "rounded-2xl px-4 py-2.5 text-sm",
                  )}
                >
                  {t.node ? (
                    <div className="not-prose w-full">{t.node}</div>
                  ) : t.content ? (
                    <ReactMarkdown>{t.content}</ReactMarkdown>
                  ) : executionLog ? (
                    <div className="not-prose w-full">{executionLog}</div>
                  ) : (
                    <span className="inline-flex gap-1 items-center text-zinc-500 text-xs not-prose">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      thinking…
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
          {/* Streaming with no assistant placeholder yet — still show live steps. */}
          {streaming && executionLog && turns[turns.length - 1]?.role !== "assistant" && (
            <div className="flex justify-start">
              <div
                className={cn(
                  "w-full bg-white/[0.04] border border-white/10",
                  compact ? "max-w-[85%] rounded-lg px-2.5 py-1.5" : "max-w-[85%] rounded-2xl px-3 py-2.5",
                )}
              >
                {executionLog}
              </div>
            </div>
          )}
        </div>

        {/* Suggestions -- horizontally scrollable so they stay one line on
            narrow screens instead of each taking its own full-width row. */}
        {suggestions.length > 0 && turns.length <= 1 && (
          <div className={cn("flex gap-2 overflow-x-auto", compact ? "pb-2" : "pb-3")}>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSend(s)}
                disabled={streaming}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border border-cyan-400/30 bg-cyan-400/5 text-cyan-200 hover:bg-cyan-400/15 disabled:opacity-40",
                  compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <div className={cn("rounded-2xl border border-white/10 bg-white/[0.03]", compact ? "p-2" : "p-3")}>
          {composerExtras && <div className="mb-2">{composerExtras}</div>}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={compact ? 1 : 2}
            placeholder={`Talk to ${name}…`}
            className="w-full bg-transparent outline-none resize-none text-sm text-zinc-100 placeholder:text-zinc-600"
          />
          <div className="flex items-center justify-between mt-2">
            <button
              onClick={() => setShowSpec((s) => !s)}
              className="text-[11px] font-mono text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1"
            >
              {showSpec ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showSpec ? "Hide spec" : "View full spec"}
            </button>
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              className={cn(
                "rounded-lg bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-black disabled:opacity-40",
                compact ? "h-7 w-7" : "h-8 w-8",
              )}
            >
              <ArrowUp className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            </button>
          </div>
        </div>

        {showSpec && (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/50 p-4 max-h-64 overflow-y-auto text-xs text-zinc-300 prose prose-invert prose-sm max-w-none prose-headings:text-white">
            <ReactMarkdown>{fullSpec}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal as TerminalIcon, Cpu, Shield } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface TerminalEntry {
  id: string;
  type: "user" | "system" | "command";
  text: string;
  delay?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const GOLDEN_PROMPTS: TerminalEntry[] = [
  {
    id: "help-1",
    type: "command",
    text: "▸  /launch     → Simulate a full AI business launch sequence",
  },
  {
    id: "help-2",
    type: "command",
    text: "▸  /decrypt    → Run mock decryption on your business model",
  },
  {
    id: "help-3",
    type: "command",
    text: "▸  /market     → Generate a cyberpunk market analysis report",
  },
  {
    id: "help-4",
    type: "command",
    text: "▸  /stack      → Recommend a tech stack for your concept",
  },
  {
    id: "help-5",
    type: "command",
    text: "▸  /monetize   → Surface 3 revenue streams for your idea",
  },
];

const DECRYPTION_FRAMES = [
  "█ Initializing secure channel...",
  "██ Bypassing corporate firewall...",
  "███ Injecting neural payload...",
  "████ Compiling market matrix...",
  "█████ Decrypting business core...",
  "██████ ACCESS GRANTED. NazAI online.",
];

const CHIP_COMMANDS = ["/help", "/decrypt", "/launch"];

const BOOT_SEQUENCE: TerminalEntry[] = [
  {
    id: "boot-1",
    type: "system",
    text: "NazAI v2.0.77 — CYBERPUNK BUSINESS TERMINAL",
    delay: 0,
  },
  {
    id: "boot-2",
    type: "system",
    text: "System integrity: ██████████ 100%",
    delay: 200,
  },
  {
    id: "boot-3",
    type: "system",
    text: "Type /help to see available commands. Stay dangerous.",
    delay: 400,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);

// ─── Component ───────────────────────────────────────────────────────────────
export default function Terminal() {
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptFrame, setDecryptFrame] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Boot sequence on mount
  useEffect(() => {
    BOOT_SEQUENCE.forEach((entry) => {
      setTimeout(() => {
        setEntries((prev) => [...prev, entry]);
      }, entry.delay ?? 0);
    });
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, isDecrypting]);

  // ─── Mock Decryption Logic ──────────────────────────────────────────────
  const runDecryption = () => {
    if (isDecrypting) return;
    setIsDecrypting(true);
    setDecryptFrame(0);

    const frameInterval = setInterval(() => {
      setDecryptFrame((prev) => {
        const next = prev + 1;
        if (next >= DECRYPTION_FRAMES.length) {
          clearInterval(frameInterval);
        }
        return next;
      });
    }, 500); // 500ms × 6 frames = 3 seconds total

    setTimeout(() => {
      setIsDecrypting(false);
      setDecryptFrame(0);
      setEntries((prev) => [
        ...prev,
        {
          id: uid(),
          type: "system",
          text: "► Decryption complete. Business matrix loaded into memory.",
        },
        {
          id: uid(),
          type: "system",
          text: "► Run /launch or /market to proceed.",
        },
      ]);
    }, 3000);
  };

  // ─── Command Router ─────────────────────────────────────────────────────
  const handleCommand = (raw: string) => {
    const input = raw.trim().toLowerCase();

    // Echo user input
    const userEntry: TerminalEntry = {
      id: uid(),
      type: "user",
      text: `> ${raw.trim()}`,
    };
    setEntries((prev) => [...prev, userEntry]);

    switch (input) {
      case "/help":
        setEntries((prev) => [
          ...prev,
          {
            id: uid(),
            type: "system",
            text: "━━━ GOLDEN PROMPTS — CHOOSE YOUR WEAPON ━━━",
          },
          ...GOLDEN_PROMPTS,
        ]);
        break;

      case "/decrypt":
        setEntries((prev) => [...prev, { id: uid(), type: "system", text: "► Initiating decryption sequence..." }]);
        runDecryption();
        break;

      case "/launch":
        setEntries((prev) => [
          ...prev,
          { id: uid(), type: "system", text: "► [MOCK MODE] Launch sequence armed." },
          { id: uid(), type: "system", text: "► All API calls disabled — Budget Protection active." },
          { id: uid(), type: "system", text: "► To go live: connect your AI provider and remove mock flags." },
        ]);
        break;

      case "/market":
        setEntries((prev) => [
          ...prev,
          {
            id: uid(),
            type: "system",
            text: "► [MOCK] Market Analysis: High-signal disruption detected in sectors 3, 7, 12.",
          },
          { id: uid(), type: "system", text: "► Competitor matrix: 4 weak nodes identified. Attack vectors ready." },
        ]);
        break;

      case "/stack":
        setEntries((prev) => [
          ...prev,
          {
            id: uid(),
            type: "system",
            text: "► [MOCK] Recommended stack: Next.js · Supabase · Tailwind · OpenAI · Vercel.",
          },
          { id: uid(), type: "system", text: "► Confidence score: 94.2% — optimal for rapid iteration." },
        ]);
        break;

      case "/monetize":
        setEntries((prev) => [
          ...prev,
          {
            id: uid(),
            type: "system",
            text: "► [MOCK] Revenue streams: 1) SaaS subscription  2) Usage-based API credits  3) White-label licensing.",
          },
          { id: uid(), type: "system", text: "► Projected breakeven: 3.2 months at target acquisition rate." },
        ]);
        break;

      case "/clear":
        setEntries([]);
        break;

      default:
        setEntries((prev) => [
          ...prev,
          {
            id: uid(),
            type: "system",
            text: `✖ Unknown command: "${raw.trim()}". Type /help for available commands.`,
          },
        ]);
    }
  };

  // ─── Form Submit ────────────────────────────────────────────────────────
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isDecrypting) return;
    handleCommand(inputValue);
    setInputValue("");
    inputRef.current?.focus();
  };

  // ─── Chip Click ─────────────────────────────────────────────────────────
  const handleChipClick = (cmd: string) => {
    if (isDecrypting) return;
    setInputValue(cmd);
    inputRef.current?.focus();
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen bg-black flex items-center justify-center p-4 font-mono"
      style={{ background: "radial-gradient(ellipse at center, #0a0a0a 0%, #000000 100%)" }}
    >
      {/* Scanlines overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-10 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.15) 2px, rgba(0,255,65,0.15) 4px)",
        }}
      />

      <div className="w-full max-w-3xl">
        {/* ── Header Bar ── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center justify-between px-4 py-2 rounded-t-lg border border-[#00FF41]/30 bg-black"
          style={{ boxShadow: "0 0 20px rgba(0,255,65,0.15)" }}
        >
          <div className="flex items-center gap-3">
            <TerminalIcon size={16} className="text-[#00FF41]" />
            <span className="text-[#00FF41] text-sm tracking-widest font-bold">
              NAZ<span className="text-white">AI</span>.TERMINAL
            </span>
          </div>
          <div className="flex items-center gap-3 text-[#00FF41]/60 text-xs">
            <Cpu size={12} className="text-[#00FF41]/60" />
            <span>MOCK MODE</span>
            <Shield size={12} className="text-[#00FF41]/60" />
            <span className="text-[#00FF41]">●</span>
          </div>
        </motion.div>

        {/* ── Terminal Body ── */}
        <div
          className="border-x border-[#00FF41]/30 bg-black px-4 py-4 h-[480px] overflow-y-auto scrollbar-thin"
          style={{
            scrollbarColor: "#00FF41 transparent",
            boxShadow: "inset 0 0 40px rgba(0,255,65,0.03)",
          }}
        >
          <AnimatePresence initial={false}>
            {entries.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: entry.type === "user" ? 10 : -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className={`mb-1 text-sm leading-relaxed whitespace-pre-wrap ${
                  entry.type === "user"
                    ? "text-white/90"
                    : entry.type === "command"
                      ? "text-[#00FF41] pl-2"
                      : "text-[#00FF41]/80"
                }`}
                style={
                  entry.type === "system"
                    ? { textShadow: "0 0 8px rgba(0,255,65,0.5)" }
                    : entry.type === "command"
                      ? { textShadow: "0 0 12px rgba(0,255,65,0.8)" }
                      : {}
                }
              >
                {entry.text}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* ── Decryption Animation ── */}
          {isDecrypting && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2">
              {DECRYPTION_FRAMES.slice(0, decryptFrame + 1).map((frame, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-sm mb-0.5"
                  style={{
                    color: i === decryptFrame ? "#00FF41" : "rgba(0,255,65,0.4)",
                    textShadow: i === decryptFrame ? "0 0 12px rgba(0,255,65,0.9)" : "none",
                  }}
                >
                  {frame}
                </motion.div>
              ))}
              {/* Blinking cursor during decryption */}
              <motion.span
                animate={{ opacity: [1, 0, 1] }}
                transition={{ repeat: Infinity, duration: 0.8 }}
                className="inline-block w-2 h-4 bg-[#00FF41] ml-1 align-middle"
                style={{ boxShadow: "0 0 8px rgba(0,255,65,0.9)" }}
              />
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Command Chips ── */}
        <div className="flex gap-2 px-4 py-2 border-x border-[#00FF41]/20 bg-black">
          {CHIP_COMMANDS.map((cmd) => (
            <motion.button
              key={cmd}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleChipClick(cmd)}
              disabled={isDecrypting}
              className="text-xs px-3 py-1 rounded border border-[#00FF41]/40 text-[#00FF41] bg-black hover:bg-[#00FF41]/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed tracking-wider"
              style={{
                boxShadow: "0 0 8px rgba(0,255,65,0.25)",
                textShadow: "0 0 8px rgba(0,255,65,0.6)",
              }}
            >
              {cmd}
            </motion.button>
          ))}
          <span className="ml-auto text-[10px] text-[#00FF41]/25 self-center tracking-widest">
            MOCK MODE — NO API CALLS
          </span>
        </div>

        {/* ── Input Bar ── */}
        <motion.form
          onSubmit={onSubmit}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex items-center gap-2 px-4 py-3 rounded-b-lg border border-[#00FF41]/30 bg-black"
          style={{ boxShadow: "0 0 20px rgba(0,255,65,0.1)" }}
        >
          <span className="text-[#00FF41] text-sm select-none" style={{ textShadow: "0 0 8px rgba(0,255,65,0.8)" }}>
            ›
          </span>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isDecrypting}
            placeholder={isDecrypting ? "decrypting..." : "enter command..."}
            autoFocus
            className="flex-1 bg-transparent text-[#00FF41] text-sm outline-none placeholder:text-[#00FF41]/25 caret-[#00FF41] tracking-wide disabled:opacity-40"
            style={{ textShadow: "0 0 6px rgba(0,255,65,0.4)" }}
          />
          {/* Blinking cursor when idle */}
          {!isDecrypting && (
            <motion.span
              animate={{ opacity: [1, 0, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
              className="w-1.5 h-4 bg-[#00FF41] inline-block"
              style={{ boxShadow: "0 0 6px rgba(0,255,65,0.9)" }}
            />
          )}
          <button
            type="submit"
            disabled={isDecrypting || !inputValue.trim()}
            className="text-xs text-[#00FF41]/50 hover:text-[#00FF41] transition-colors disabled:opacity-20 tracking-widest ml-1"
          >
            [EXEC]
          </button>
        </motion.form>
      </div>
    </div>
  );
}

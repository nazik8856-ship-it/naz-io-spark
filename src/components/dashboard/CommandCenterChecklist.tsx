import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  UserPlus,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Circle,
  Lock,
  Sparkles,
  BarChart3,
  ArrowRight,
  KeyRound,
  Compass,
  Search,
  Plus,
  DollarSign,
  Palette,
  Type,
  Share2,
  Loader2,
  X,
  UploadCloud,
  Eye,
  EyeOff,
  Trash2,
  Pencil,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

/**
 * CommandCenterChecklist
 * Onboarding checklist with in-app flows for Domain, CRM, Invoice, and Brand Assets,
 * plus an inline API Key save form.
 *
 * State is persisted to localStorage so progress + saved values survive reloads.
 * Pure presentation — no Supabase logic touched.
 */

const STORAGE_KEY = "nazai.commandCenter.checklist.v1";
const MEMORY_KEY = "nazai.commandCenter.memory.v1";

type StepId = "domain" | "customer" | "invoice" | "brand" | "apis" | "setup";

type StepAction =
  | { kind: "modal"; modal: "domain" | "crm" | "invoice" | "brand" }
  | { kind: "inline" } // handled by the card itself (API key)
  | { kind: "directive"; directive: string };

type Step = {
  id: StepId;
  title: string;
  desc: string;
  icon: React.ElementType;
  cta: string;
  action: StepAction;
};

const STEPS: Step[] = [
  {
    id: "domain",
    title: "Get a custom domain",
    desc: "Claim a branded domain so customers find you instantly.",
    icon: Globe,
    cta: "Browse domains",
    action: { kind: "modal", modal: "domain" },
  },
  {
    id: "customer",
    title: "Add your first customer",
    desc: "Drop a contact into the CRM to activate revenue tracking.",
    icon: UserPlus,
    cta: "Open CRM",
    action: { kind: "modal", modal: "crm" },
  },
  {
    id: "invoice",
    title: "Create an invoice",
    desc: "Send your first invoice and turn on payment receiving.",
    icon: FileText,
    cta: "New invoice",
    action: { kind: "modal", modal: "invoice" },
  },
  {
    id: "brand",
    title: "Generate brand assets",
    desc: "Logo, palette, and social kit — produced in one pass.",
    icon: ImageIcon,
    cta: "Generate Brand Assets",
    action: { kind: "modal", modal: "brand" },
  },
  {
    id: "apis",
    title: "API Key Search",
    desc: "Find and integrate external APIs instantly.",
    icon: KeyRound,
    cta: "Search APIs",
    action: { kind: "inline" },
  },
  {
    id: "setup",
    title: "Guide & Setup",
    desc: "Step-by-step onboarding and configuration wizard.",
    icon: Compass,
    cta: "Start Setup",
    action: {
      kind: "directive",
      directive:
        "Start the guided setup wizard and walk me through configuring my project end-to-end with best-practice defaults.",
    },
  },
];

const GUARDRAILS = [
  {
    icon: BarChart3,
    label: "92% confidence",
    desc: "Score calibrated from prompt specificity and available assumptions.",
    accent: "#06b6d4",
  },
  {
    icon: CheckCircle2,
    label: "Verified assumptions",
    desc: "Flags uncertain market, finance, and compliance claims before use.",
    accent: "#8b5cf6",
  },
  {
    icon: FileText,
    label: "Fact-check ready",
    desc: "Send any section through a source-backed verification pass.",
    accent: "#06b6d4",
  },
  {
    icon: Lock,
    label: "Approved memory",
    desc: "Mark final decisions as approved for future iterations.",
    accent: "#22c55e",
  },
];

type ProgressMap = Record<StepId, boolean>;
const DEFAULT_PROGRESS: ProgressMap = {
  domain: false,
  customer: false,
  invoice: false,
  brand: false,
  apis: false,
  setup: false,
};

type SavedApiKey = {
  id: string;
  name: string;
  value: string;
  createdAt: number;
};

type Memory = {
  /** @deprecated kept for backwards-compat; migrated into apiKeys on load */
  apiKey?: string;
  domain?: string;
  apiKeys?: SavedApiKey[];
};

const loadProgress = (): ProgressMap => {
  if (typeof window === "undefined") return DEFAULT_PROGRESS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PROGRESS, ...parsed };
  } catch {
    return DEFAULT_PROGRESS;
  }
};

const loadMemory = (): Memory => {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    const parsed: Memory = raw ? JSON.parse(raw) : {};
    // Migrate legacy single-key shape into the new apiKeys list
    if (parsed.apiKey && (!parsed.apiKeys || parsed.apiKeys.length === 0)) {
      parsed.apiKeys = [
        {
          id: `legacy-${Date.now()}`,
          name: "Default API",
          value: parsed.apiKey,
          createdAt: Date.now(),
        },
      ];
      delete parsed.apiKey;
    }
    if (!parsed.apiKeys) parsed.apiKeys = [];
    return parsed;
  } catch {
    return { apiKeys: [] };
  }
};

const CommandCenterChecklist: React.FC = () => {
  const [progress, setProgress] = useState<ProgressMap>(DEFAULT_PROGRESS);
  const [memory, setMemory] = useState<Memory>({});
  const [openModal, setOpenModal] = useState<null | "domain" | "crm" | "invoice" | "brand">(null);

  useEffect(() => {
    setProgress(loadProgress());
    setMemory(loadMemory());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // ignore
    }
  }, [progress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    } catch {
      // ignore
    }
  }, [memory]);

  const completedCount = useMemo(
    () => Object.values(progress).filter(Boolean).length,
    [progress]
  );
  const total = STEPS.length;
  const percent = Math.round((completedCount / total) * 100);

  const toggle = (id: StepId) =>
    setProgress((p) => ({ ...p, [id]: !p[id] }));

  const markDone = (id: StepId) =>
    setProgress((p) => ({ ...p, [id]: true }));

  const runAction = (step: Step) => {
    const action = step.action;
    if (action.kind === "modal") {
      setOpenModal(action.modal);
      // do not auto-mark; mark on save inside modal
    } else if (action.kind === "directive") {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("nazai:run-directive", {
            detail: { directive: action.directive, source: `checklist:${step.id}` },
          }),
        );
      }
      markDone(step.id);
    }
    // inline cards handle themselves
  };

  // Activity unlocks: 2 steps unlocks invoices, 3 steps unlocks customers
  const invoicesUnlocked = completedCount >= 2;
  const customersUnlocked = completedCount >= 3;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[10px] font-mono tracking-[0.2em] uppercase mb-3"
            style={{
              background: "rgba(6,182,212,0.08)",
              border: "1px solid rgba(6,182,212,0.25)",
              color: "#06b6d4",
            }}
          >
            <Sparkles size={10} />
            Command Center
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
            Get your business operating
          </h2>
          <p className="text-sm text-white/50 mt-1">
            Six moves to a fully live operation. NazAI handles the heavy lifting.
          </p>
        </div>

        {/* Progress badge */}
        <div
          className="rounded-xl px-4 py-3 min-w-[200px]"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="flex items-center justify-between text-[10px] font-mono tracking-[0.2em] uppercase text-white/50 mb-2">
            <span>Onboarding</span>
            <span style={{ color: "#06b6d4" }}>
              {completedCount}/{total}
            </span>
          </div>
          <div
            className="relative h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            <motion.div
              animate={{ width: `${percent}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22 }}
              className="absolute left-0 top-0 h-full rounded-full"
              style={{
                background: "linear-gradient(90deg, #06b6d4, #8b5cf6)",
                boxShadow: "0 0 12px rgba(6,182,212,0.5)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Checklist grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {STEPS.map((step, i) => {
          const done = progress[step.id];
          const Icon = step.icon;
          const isInline = step.action.kind === "inline";
          const isApiCard = step.id === "apis";

          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="group relative rounded-xl p-4 transition-all"
              style={{
                background: done
                  ? "linear-gradient(135deg, rgba(6,182,212,0.08), rgba(139,92,246,0.04))"
                  : "rgba(255,255,255,0.02)",
                border: done
                  ? "1px solid rgba(6,182,212,0.35)"
                  : "1px solid rgba(255,255,255,0.06)",
                boxShadow: done
                  ? "0 0 24px rgba(6,182,212,0.12)"
                  : "none",
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: done ? "rgba(6,182,212,0.14)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${done ? "rgba(6,182,212,0.35)" : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <Icon size={16} style={{ color: done ? "#06b6d4" : "rgba(255,255,255,0.6)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-semibold"
                      style={{
                        color: done ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.85)",
                      }}
                    >
                      {step.title}
                    </span>
                    {isApiCard && memory.apiKey && (
                      <span
                        className="text-[9px] font-mono tracking-[0.18em] uppercase px-1.5 py-0.5 rounded"
                        style={{
                          background: "rgba(34,197,94,0.12)",
                          border: "1px solid rgba(34,197,94,0.35)",
                          color: "#22c55e",
                        }}
                      >
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">{step.desc}</p>

                  {isApiCard ? (
                    <ApiKeyInline
                      currentKey={memory.apiKey}
                      onSave={(key) => {
                        setMemory((m) => ({ ...m, apiKey: key }));
                        markDone("apis");
                      }}
                      onClear={() => {
                        setMemory((m) => ({ ...m, apiKey: undefined }));
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => runAction(step)}
                      className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono tracking-[0.18em] uppercase opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                      style={{ color: done ? "#06b6d4" : "rgba(255,255,255,0.6)" }}
                    >
                      {step.cta}
                      <ArrowRight size={10} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(step.id);
                  }}
                  className="shrink-0 cursor-pointer hover:opacity-100 opacity-80 transition-opacity"
                  aria-label={done ? "Mark as incomplete" : "Mark as complete"}
                >
                  {done ? (
                    <CheckCircle2 size={18} style={{ color: "#06b6d4" }} />
                  ) : (
                    <Circle size={18} className="text-white/25" />
                  )}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Reliability Guardrails */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-mono tracking-[0.22em] uppercase text-white/40">
            Reliability Guardrails
          </span>
          <div className="flex-1 h-px bg-white/5" />
          <span
            className="text-[9px] font-mono tracking-[0.2em] uppercase flex items-center gap-1.5"
            style={{ color: "#06b6d4" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "#06b6d4", boxShadow: "0 0 8px #06b6d4" }}
            />
            LIVE
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {GUARDRAILS.map((guardrail, i) => {
            const Icon = guardrail.icon;
            return (
              <motion.div
                key={guardrail.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
                className="rounded-xl p-4"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center"
                    style={{
                      background: `${guardrail.accent}14`,
                      border: `1px solid ${guardrail.accent}33`,
                    }}
                  >
                    <Icon size={13} style={{ color: guardrail.accent }} />
                  </div>
                  <span className="text-xs font-semibold text-white/90">{guardrail.label}</span>
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">{guardrail.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Activity Stream — blurred skeletons that unlock with progress */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ActivityCard
          title="Latest Invoices"
          unlocked={invoicesUnlocked}
          requirement="Complete 2 onboarding steps to unlock"
          rows={[
            { left: "INV-0042 · Acme Co.", right: "$1,240" },
            { left: "INV-0041 · Lumen LLC", right: "$680" },
            { left: "INV-0040 · Northwind", right: "$2,100" },
          ]}
        />
        <ActivityCard
          title="Latest Customers"
          unlocked={customersUnlocked}
          requirement="Complete 3 onboarding steps to unlock"
          rows={[
            { left: "Sarah Chen · Acme Co.", right: "Today" },
            { left: "James Patel · Lumen LLC", right: "Yesterday" },
            { left: "Mira Okafor · Northwind", right: "2d ago" },
          ]}
        />
      </div>

      {/* Modals */}
      <DomainModal
        open={openModal === "domain"}
        onOpenChange={(o) => setOpenModal(o ? "domain" : null)}
        savedDomain={memory.domain}
        onSave={(d) => {
          setMemory((m) => ({ ...m, domain: d }));
          markDone("domain");
        }}
      />
      <CrmModal
        open={openModal === "crm"}
        onOpenChange={(o) => setOpenModal(o ? "crm" : null)}
        onSave={() => markDone("customer")}
      />
      <InvoiceModal
        open={openModal === "invoice"}
        onOpenChange={(o) => setOpenModal(o ? "invoice" : null)}
        onSave={() => markDone("invoice")}
      />
      <BrandAssetsModal
        open={openModal === "brand"}
        onOpenChange={(o) => setOpenModal(o ? "brand" : null)}
        onSave={() => markDone("brand")}
        onDispatch={(directive, attachment) => {
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("nazai:run-directive", {
                detail: { directive, source: "checklist:brand", attachment },
              }),
            );
          }
        }}
      />
    </div>
  );
};

/* ----------------------------- Inline API Key ---------------------------- */

const ApiKeyInline: React.FC<{
  currentKey?: string;
  onSave: (key: string) => void;
  onClear: () => void;
}> = ({ currentKey, onSave, onClear }) => {
  const [val, setVal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const { toast } = useToast();

  const handleSave = () => {
    const trimmed = val.trim();
    if (!trimmed) {
      setError("Please enter an API key.");
      return;
    }
    if (trimmed.length < 8) {
      setError("Key looks too short — please check and try again.");
      return;
    }
    setError(null);
    onSave(trimmed);
    setVal("");
    setSavedFlash(true);
    toast({ title: "API Key saved successfully", description: "Stored in project memory." });
    setTimeout(() => setSavedFlash(false), 2000);
  };

  if (currentKey) {
    const masked = `${currentKey.slice(0, 4)}••••${currentKey.slice(-4)}`;
    return (
      <div className="mt-3 space-y-2">
        <div
          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md font-mono text-[11px]"
          style={{
            background: "rgba(34,197,94,0.06)",
            border: "1px solid rgba(34,197,94,0.25)",
            color: "rgba(255,255,255,0.85)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 size={12} style={{ color: "#22c55e" }} />
            <span className="truncate">{masked}</span>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="text-white/40 hover:text-white/80 transition-colors shrink-0"
            aria-label="Remove saved API key"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          type="password"
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder="Enter your API key here..."
          className="h-8 text-[11px] font-mono bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
        />
        <button
          type="button"
          onClick={handleSave}
          className="shrink-0 h-8 px-3 rounded-md text-[10px] font-mono tracking-[0.18em] uppercase transition-all"
          style={{
            background: savedFlash
              ? "rgba(34,197,94,0.18)"
              : "linear-gradient(135deg, rgba(6,182,212,0.18), rgba(139,92,246,0.14))",
            border: `1px solid ${savedFlash ? "rgba(34,197,94,0.5)" : "rgba(6,182,212,0.4)"}`,
            color: savedFlash ? "#22c55e" : "#06b6d4",
          }}
        >
          {savedFlash ? "Saved ✓" : "Save Key"}
        </button>
      </div>
      {error && (
        <p className="text-[10px] font-mono text-red-400/90">{error}</p>
      )}
    </div>
  );
};

/* -------------------------------- Modals -------------------------------- */

const ModalShell: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ open, onOpenChange, title, description, children }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      className="max-w-lg border-0 p-0 overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #0b1220 0%, #060a14 100%)",
        border: "1px solid rgba(6,182,212,0.18)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03) inset",
      }}
    >
      <div
        className="px-6 pt-6 pb-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold tracking-tight">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-white/50 text-xs mt-1">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
      </div>
      <div className="p-6">{children}</div>
    </DialogContent>
  </Dialog>
);

const DomainModal: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  savedDomain?: string;
  onSave: (domain: string) => void;
}> = ({ open, onOpenChange, savedDomain, onSave }) => {
  const [val, setVal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<null | { domain: string; available: boolean; price: string }>(null);
  const [saved, setSaved] = useState<string | null>(savedDomain ?? null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setSaved(savedDomain ?? null);
      setVal("");
      setResult(null);
      setError(null);
    }
  }, [open, savedDomain]);

  const handleCheck = () => {
    const trimmed = val.trim().toLowerCase();
    if (!trimmed) {
      setError("Please enter a domain (e.g. gamma.ai).");
      return;
    }
    if (!/^[a-z0-9-]+\.[a-z]{2,}$/i.test(trimmed)) {
      setError("Enter a valid domain like example.com or gamma.ai.");
      return;
    }
    setError(null);
    setChecking(true);
    setResult(null);
    setTimeout(() => {
      // Simulated check — deterministic by length parity
      const available = trimmed.length % 2 === 0;
      setResult({
        domain: trimmed,
        available,
        price: available ? "$14.99/yr" : "—",
      });
      setChecking(false);
    }, 900);
  };

  const handleClaim = () => {
    if (!result || !result.available) return;
    onSave(result.domain);
    setSaved(result.domain);
    toast({
      title: "Domain saved",
      description: `${result.domain} is now in your Project Memory.`,
    });
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Custom Domain"
      description="Search and claim a branded domain for your business."
    >
      {saved && (
        <div
          className="mb-4 flex items-center gap-2 px-3 py-2 rounded-md text-xs"
          style={{
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.3)",
            color: "rgba(255,255,255,0.9)",
          }}
        >
          <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
          <span>
            Domain saved: <span className="font-mono">{saved}</span> ✓
          </span>
        </div>
      )}

      <label className="block text-[10px] font-mono tracking-[0.2em] uppercase text-white/50 mb-2">
        Enter desired domain
      </label>
      <div className="flex items-center gap-2">
        <Input
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCheck();
          }}
          placeholder="e.g. gamma.ai"
          className="h-10 text-sm bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
        />
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking}
          className="shrink-0 h-10 px-4 rounded-md text-[11px] font-mono tracking-[0.18em] uppercase transition-all disabled:opacity-60"
          style={{
            background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.16))",
            border: "1px solid rgba(6,182,212,0.4)",
            color: "#06b6d4",
          }}
        >
          {checking ? <Loader2 size={12} className="animate-spin" /> : <><Search size={11} className="inline mr-1.5" />Check</>}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] font-mono text-red-400/90">{error}</p>}

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 rounded-lg p-3"
            style={{
              background: result.available ? "rgba(6,182,212,0.06)" : "rgba(239,68,68,0.06)",
              border: `1px solid ${result.available ? "rgba(6,182,212,0.3)" : "rgba(239,68,68,0.3)"}`,
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white font-semibold font-mono">{result.domain}</div>
                <div
                  className="text-[10px] font-mono tracking-[0.18em] uppercase mt-0.5"
                  style={{ color: result.available ? "#06b6d4" : "#ef4444" }}
                >
                  {result.available ? `Available · ${result.price}` : "Unavailable"}
                </div>
              </div>
              {result.available && (
                <button
                  type="button"
                  onClick={handleClaim}
                  className="h-9 px-4 rounded-md text-[11px] font-mono tracking-[0.18em] uppercase"
                  style={{
                    background: "rgba(34,197,94,0.16)",
                    border: "1px solid rgba(34,197,94,0.45)",
                    color: "#22c55e",
                  }}
                >
                  Claim Domain
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalShell>
  );
};

const CrmModal: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: () => void;
}> = ({ open, onOpenChange, onSave }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [revenue, setRevenue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setName(""); setEmail(""); setRevenue(""); setError(null);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email.");
      return;
    }
    onSave();
    toast({ title: "Customer added", description: `${name.trim()} is now in your CRM.` });
    onOpenChange(false);
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="CRM"
      description="Add your first customer and activate revenue tracking."
    >
      <div className="space-y-3">
        <Field label="Customer name" icon={UserPlus}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sarah Chen"
            className="h-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
          />
        </Field>
        <Field label="Email" icon={Plus}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="sarah@acme.co"
            className="h-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
          />
        </Field>
        <Field label="Initial revenue (optional)" icon={DollarSign}>
          <Input
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
            placeholder="$1,200"
            className="h-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
          />
        </Field>
        {error && <p className="text-[11px] font-mono text-red-400/90">{error}</p>}
        <button
          type="button"
          onClick={handleSubmit}
          className="w-full h-10 rounded-md text-[11px] font-mono tracking-[0.2em] uppercase mt-2"
          style={{
            background: "linear-gradient(135deg, rgba(6,182,212,0.22), rgba(139,92,246,0.18))",
            border: "1px solid rgba(6,182,212,0.45)",
            color: "#06b6d4",
          }}
        >
          Add Customer
        </button>
      </div>
    </ModalShell>
  );
};

const InvoiceModal: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: () => void;
}> = ({ open, onOpenChange, onSave }) => {
  const [client, setClient] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setClient(""); setAmount(""); setDesc(""); setError(null);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!client.trim() || !amount.trim()) {
      setError("Client and amount are required.");
      return;
    }
    onSave();
    toast({ title: "Invoice created", description: `Invoice for ${client.trim()} ready to send.` });
    onOpenChange(false);
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Create Invoice"
      description="Send your first invoice and turn on payment receiving."
    >
      <div className="space-y-3">
        <Field label="Client" icon={UserPlus}>
          <Input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Acme Co."
            className="h-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
          />
        </Field>
        <Field label="Amount (USD)" icon={DollarSign}>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1240"
            className="h-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
          />
        </Field>
        <Field label="Description (optional)" icon={FileText}>
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Strategy retainer — May"
            className="h-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
          />
        </Field>
        {error && <p className="text-[11px] font-mono text-red-400/90">{error}</p>}
        <button
          type="button"
          onClick={handleSubmit}
          className="w-full h-10 rounded-md text-[11px] font-mono tracking-[0.2em] uppercase mt-2"
          style={{
            background: "linear-gradient(135deg, rgba(6,182,212,0.22), rgba(139,92,246,0.18))",
            border: "1px solid rgba(6,182,212,0.45)",
            color: "#06b6d4",
          }}
        >
          Create Invoice
        </button>
      </div>
    </ModalShell>
  );
};

type BrandAttachment = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

// Simple k-cluster-ish dominant color extraction from a data URL.
// Quantizes pixels into 4-bit buckets, returns the top N hexes.
async function extractPaletteFromDataUrl(dataUrl: string, count = 5): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 200) continue;
          const r = data[i] & 0xf0;
          const g = data[i + 1] & 0xf0;
          const b = data[i + 2] & 0xf0;
          const key = `${r},${g},${b}`;
          const cur = buckets.get(key);
          if (cur) {
            cur.r += data[i]; cur.g += data[i + 1]; cur.b += data[i + 2]; cur.n += 1;
          } else {
            buckets.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], n: 1 });
          }
        }
        const top = Array.from(buckets.values())
          .sort((a, b) => b.n - a.n)
          .slice(0, count * 3); // grab extra so we can dedupe by perceived similarity
        const toHex = (v: number) =>
          Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
        const hexes: string[] = [];
        for (const c of top) {
          const hex = `#${toHex(c.r / c.n)}${toHex(c.g / c.n)}${toHex(c.b / c.n)}`;
          // dedupe near-duplicates
          const dup = hexes.some((h) => {
            const dr = parseInt(h.slice(1, 3), 16) - parseInt(hex.slice(1, 3), 16);
            const dg = parseInt(h.slice(3, 5), 16) - parseInt(hex.slice(3, 5), 16);
            const db = parseInt(h.slice(5, 7), 16) - parseInt(hex.slice(5, 7), 16);
            return Math.sqrt(dr * dr + dg * dg + db * db) < 28;
          });
          if (!dup) hexes.push(hex);
          if (hexes.length >= count) break;
        }
        resolve(hexes);
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  });
}

const BrandAssetsModal: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: () => void;
  onDispatch?: (directive: string, attachment?: BrandAttachment) => void;
}> = ({ open, onOpenChange, onSave, onDispatch }) => {
  const [brandName, setBrandName] = useState("");
  const [vibe, setVibe] = useState("");
  const [attachment, setAttachment] = useState<BrandAttachment | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setBrandName(""); setVibe(""); setAttachment(null); setPalette([]); setExtracting(false);
      setGenerating(false); setDone(false); setError(null); setDragActive(false);
    }
  }, [open]);

  const ACCEPTED = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
  const MAX_BYTES = 8 * 1024 * 1024; // 8MB

  const ingestFile = (file: File) => {
    if (!ACCEPTED.includes(file.type) && !/\.(png|jpe?g|svg|webp)$/i.test(file.name)) {
      setError("Unsupported file. Use PNG, JPG, SVG, or WEBP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File too large. Max 8MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setError(null);
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      setAttachment({
        name: file.name,
        type: file.type || "image/*",
        size: file.size,
        dataUrl,
      });
      if (dataUrl && file.type !== "image/svg+xml") {
        setExtracting(true);
        setPalette([]);
        const hexes = await extractPaletteFromDataUrl(dataUrl, 5);
        setPalette(hexes);
        setExtracting(false);
      } else {
        setPalette([]);
      }
    };
    reader.onerror = () => setError("Could not read that file. Try another.");
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) ingestFile(file);
    // reset so re-selecting the same file still triggers change
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) ingestFile(file);
  };

  const handleGenerate = () => {
    if (!brandName.trim()) {
      setError("Please enter a brand name.");
      return;
    }
    setError(null);
    setGenerating(true);

    // Forward to NazAI with the uploaded reference (if any) so it can be used during generation
    const directive = [
      `Generate a complete brand kit for "${brandName.trim()}".`,
      vibe.trim() ? `Vibe: ${vibe.trim()}.` : "",
      attachment
        ? `Use the uploaded reference image "${attachment.name}" as the primary visual reference for the logo direction, palette extraction, and overall aesthetic.`
        : "",
      palette.length
        ? `Auto-extracted palette from reference (use as authoritative brand colors and adapt the website to match): ${palette.join(", ")}.`
        : "",
      "Produce: logo concept, color palette (with hex codes), typography pairing, and a social kit. Suggest matching website accent colors derived from the reference.",
    ]
      .filter(Boolean)
      .join(" ");

    onDispatch?.(directive, attachment ?? undefined);

    setTimeout(() => {
      setGenerating(false);
      setDone(true);
      onSave();
      toast({
        title: "Brand assets generated",
        description: `${brandName.trim()} kit ready: logo, palette, typography, social.`,
      });
    }, 1400);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Generate Brand Assets"
      description="Upload reference image (optional)"
    >
      {!done ? (
        <div className="space-y-3">
          <Field label="Brand name" icon={Sparkles}>
            <Input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Gamma Analytics"
              className="h-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
            />
          </Field>
          <Field label="Vibe (optional)" icon={Palette}>
            <Input
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              placeholder="cyber-futuristic, minimal, premium"
              className="h-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-cyan-400/40"
            />
          </Field>

          {/* Reference image upload */}
          <Field label="Reference image (optional)" icon={UploadCloud}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
            {!attachment ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className="group relative cursor-pointer rounded-lg px-4 py-5 flex flex-col items-center justify-center text-center transition-all"
                style={{
                  background: dragActive
                    ? "linear-gradient(135deg, rgba(6,182,212,0.10), rgba(139,92,246,0.08))"
                    : "rgba(255,255,255,0.02)",
                  border: `1.5px dashed ${dragActive ? "rgba(6,182,212,0.6)" : "rgba(255,255,255,0.14)"}`,
                  boxShadow: dragActive ? "0 0 24px rgba(6,182,212,0.18)" : "none",
                  backdropFilter: "blur(6px)",
                }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center mb-2 transition-colors"
                  style={{
                    background: "rgba(6,182,212,0.10)",
                    border: "1px solid rgba(6,182,212,0.28)",
                  }}
                >
                  <UploadCloud size={16} style={{ color: "#06b6d4" }} />
                </div>
                <span className="text-xs text-white/80 font-medium">
                  Drag &amp; drop reference image or click to upload
                </span>
                <span className="mt-0.5 text-[10px] font-mono tracking-[0.18em] uppercase text-white/40">
                  PNG · JPG · SVG · WEBP — up to 8MB
                </span>
              </div>
            ) : (
              <div
                className="rounded-lg p-2.5 flex items-center gap-3"
                style={{
                  background: "rgba(6,182,212,0.06)",
                  border: "1px solid rgba(6,182,212,0.28)",
                }}
              >
                <div
                  className="w-12 h-12 rounded-md overflow-hidden shrink-0 flex items-center justify-center"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {attachment.type.startsWith("image/") && attachment.dataUrl ? (
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon size={16} className="text-white/50" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white truncate font-medium">{attachment.name}</div>
                  <div className="text-[10px] font-mono text-white/40 mt-0.5">
                    {formatSize(attachment.size)} · ready as reference
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setAttachment(null); setPalette([]); }}
                  className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Remove file"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {/* Auto-extracted palette suggestion */}
            {(extracting || palette.length > 0) && (
              <div
                className="mt-2 rounded-lg p-2.5"
                style={{
                  background: "rgba(139,92,246,0.05)",
                  border: "1px solid rgba(139,92,246,0.25)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-violet-300/80">
                    {extracting ? "Extracting palette…" : "Suggested palette · auto-extracted"}
                  </span>
                  {!extracting && palette.length > 0 && (
                    <span className="text-[9px] font-mono text-white/40">
                      Will guide brand + website colors
                    </span>
                  )}
                </div>
                {extracting ? (
                  <div className="flex gap-1.5">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="h-6 flex-1 rounded animate-pulse"
                        style={{ background: "rgba(255,255,255,0.06)" }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    {palette.map((hex) => (
                      <div key={hex} className="flex-1 group relative" title={hex}>
                        <div
                          className="h-6 rounded transition-transform group-hover:scale-105"
                          style={{
                            background: hex,
                            boxShadow: `0 0 0 1px rgba(255,255,255,0.06)`,
                          }}
                        />
                        <div className="text-[8px] font-mono text-white/40 text-center mt-0.5 truncate">
                          {hex.toUpperCase()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>

          {error && <p className="text-[11px] font-mono text-red-400/90">{error}</p>}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="w-full h-10 rounded-md text-[11px] font-mono tracking-[0.2em] uppercase mt-2 flex items-center justify-center gap-2 disabled:opacity-70"
            style={{
              background: "linear-gradient(135deg, rgba(6,182,212,0.22), rgba(139,92,246,0.18))",
              border: "1px solid rgba(6,182,212,0.45)",
              color: "#06b6d4",
            }}
          >
            {generating ? (
              <><Loader2 size={12} className="animate-spin" /> Generating…</>
            ) : (
              <>Generate Brand Kit</>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <BrandTile icon={Sparkles} label="Logo" />
            <BrandTile icon={Palette} label="Palette" />
            <BrandTile icon={Type} label="Type" />
            <BrandTile icon={Share2} label="Social" />
            <BrandTile icon={ImageIcon} label="Mockups" />
            <BrandTile icon={FileText} label="Guidelines" />
          </div>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-md text-xs"
            style={{
              background: "rgba(34,197,94,0.08)",
              border: "1px solid rgba(34,197,94,0.3)",
              color: "rgba(255,255,255,0.9)",
            }}
          >
            <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
            <span>Brand kit saved to Project Memory ✓</span>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

const Field: React.FC<{
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
}> = ({ label, icon: Icon, children }) => (
  <div>
    <label className="flex items-center gap-1.5 text-[10px] font-mono tracking-[0.2em] uppercase text-white/50 mb-1.5">
      <Icon size={10} />
      {label}
    </label>
    {children}
  </div>
);

const BrandTile: React.FC<{ icon: React.ElementType; label: string }> = ({ icon: Icon, label }) => (
  <div
    className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-md"
    style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(6,182,212,0.18)",
    }}
  >
    <Icon size={14} style={{ color: "#06b6d4" }} />
    <span className="text-[10px] font-mono tracking-[0.18em] uppercase text-white/70">
      {label}
    </span>
  </div>
);

const ActivityCard: React.FC<{
  title: string;
  unlocked: boolean;
  requirement: string;
  rows: { left: string; right: string }[];
}> = ({ title, unlocked, requirement, rows }) => {
  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        className="px-4 py-2.5 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        <span className="text-[10px] font-mono tracking-[0.22em] uppercase text-white/50">
          {title}
        </span>
        {unlocked ? (
          <span
            className="text-[9px] font-mono tracking-[0.2em] uppercase flex items-center gap-1"
            style={{ color: "#06b6d4" }}
          >
            <CheckCircle2 size={10} />
            Unlocked
          </span>
        ) : (
          <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-white/30 flex items-center gap-1">
            <Lock size={10} />
            Locked
          </span>
        )}
      </div>

      <div className="relative">
        <div
          className="p-4 space-y-2.5"
          style={{
            filter: unlocked ? "none" : "blur(6px)",
            transition: "filter 0.5s ease",
          }}
        >
          {rows.map((row, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 px-3 rounded-md"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-6 h-6 rounded-full shrink-0"
                  style={{
                    background: "linear-gradient(135deg, rgba(6,182,212,0.3), rgba(139,92,246,0.3))",
                  }}
                />
                <span className="text-xs text-white/70 truncate">{row.left}</span>
              </div>
              <span className="text-xs font-mono text-white/60 shrink-0 ml-2">{row.right}</span>
            </div>
          ))}
        </div>

        <AnimatePresence>
          {!unlocked && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
              style={{
                background:
                  "linear-gradient(180deg, rgba(2,6,23,0.4) 0%, rgba(2,6,23,0.85) 100%)",
              }}
            >
              <Lock size={18} className="text-white/40 mb-2" />
              <p className="text-xs text-white/60 max-w-[220px] leading-relaxed">
                {requirement}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default CommandCenterChecklist;

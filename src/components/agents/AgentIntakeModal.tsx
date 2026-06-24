import { useEffect, useState } from "react";
import { X, Sparkles, ArrowRight, Loader2 } from "lucide-react";

export type IntakeQuestion = {
  id: string;
  question: string;
  options?: string[];
  placeholder?: string;
};

interface Props {
  open: boolean;
  questions: IntakeQuestion[];
  agentName?: string;
  submitting?: boolean;
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
}

const AgentIntakeModal = ({ open, questions, agentName, submitting, onSubmit, onSkip }: Props) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setAnswers({});
      setOtherOpen({});
    }
  }, [open, questions]);

  if (!open) return null;

  const ready = questions.every((q) => (answers[q.id] || "").trim().length > 0);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl rounded-2xl border border-cyan-400/30 bg-[#0a0f1a] shadow-[0_0_60px_-15px_rgba(34,211,238,0.45)] overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-white/5 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent">
          <div className="flex items-center gap-3">
            <div className="relative p-2 rounded-lg bg-cyan-500/15 text-cyan-300">
              <Sparkles className="h-4 w-4" />
              <span className="absolute inset-0 rounded-lg ring-1 ring-cyan-400/40 animate-pulse" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/80 font-mono">
                Agent Intake
              </p>
              <h2 className="text-base font-semibold text-white">
                {agentName ? `${agentName} needs a few details` : "Quick clarifications"}
              </h2>
              <p className="text-xs text-white/50 mt-0.5">
                Answer to unlock peak autonomy. Skip and the agent will use safe defaults.
              </p>
            </div>
          </div>
          <button
            onClick={onSkip}
            className="text-white/40 hover:text-white/80 transition-colors"
            aria-label="Skip intake"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Questions */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-5 space-y-5">
          {questions.map((q, idx) => {
            const value = answers[q.id] || "";
            const showOther = otherOpen[q.id];
            return (
              <div key={q.id} className="space-y-2.5">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-mono text-cyan-400/70 mt-1">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <p className="text-sm text-white/90 font-medium leading-snug">{q.question}</p>
                </div>

                {q.options && q.options.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pl-6">
                    {q.options.map((opt) => {
                      const selected = value === opt;
                      return (
                        <button
                          key={opt}
                          onClick={() => {
                            setAnswers((a) => ({ ...a, [q.id]: opt }));
                            setOtherOpen((o) => ({ ...o, [q.id]: false }));
                          }}
                          className={[
                            "text-xs px-3 py-1.5 rounded-full border transition-all",
                            selected
                              ? "border-cyan-400 bg-cyan-400/15 text-cyan-200 shadow-[0_0_15px_-3px_rgba(34,211,238,0.6)]"
                              : "border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:text-white",
                          ].join(" ")}
                        >
                          {opt}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setOtherOpen((o) => ({ ...o, [q.id]: !o[q.id] }))}
                      className={[
                        "text-xs px-3 py-1.5 rounded-full border transition-all",
                        showOther
                          ? "border-cyan-400/60 text-cyan-200"
                          : "border-dashed border-white/20 text-white/50 hover:text-white/80",
                      ].join(" ")}
                    >
                      Other…
                    </button>
                    {showOther && (
                      <input
                        autoFocus
                        type="text"
                        placeholder={q.placeholder || "Type your answer"}
                        value={q.options.includes(value) ? "" : value}
                        onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                        className="w-full mt-1 bg-black/40 border border-white/10 focus:border-cyan-400/60 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors"
                      />
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder={q.placeholder || "Type your answer"}
                    value={value}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    className="ml-6 w-[calc(100%-1.5rem)] bg-black/40 border border-white/10 focus:border-cyan-400/60 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors"
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/5 bg-black/30">
          <button
            onClick={onSkip}
            disabled={submitting}
            className="text-xs text-white/50 hover:text-white/90 transition-colors disabled:opacity-40"
          >
            Skip — use defaults
          </button>
          <button
            onClick={() => onSubmit(answers)}
            disabled={!ready || submitting}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-emerald-400 text-black hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_20px_-5px_rgba(34,211,238,0.7)]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Deploying
              </>
            ) : (
              <>
                Deploy with answers
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentIntakeModal;

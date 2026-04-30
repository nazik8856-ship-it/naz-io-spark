import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, X, Check } from "lucide-react";

interface AntifragileModeProps {
  projectId: string | null;
  active: boolean;
  niche: string;
  onChange: (next: { active: boolean; niche: string }) => void;
  accentColor?: string;
}

const STORAGE_PREFIX = "nazai:antifragile:";

const loadProjectState = (projectId: string | null) => {
  if (!projectId || typeof window === "undefined") return { active: false, niche: "" };
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return { active: false, niche: "" };
    const parsed = JSON.parse(raw);
    return {
      active: Boolean(parsed?.active),
      niche: typeof parsed?.niche === "string" ? parsed.niche : "",
    };
  } catch {
    return { active: false, niche: "" };
  }
};

const saveProjectState = (projectId: string | null, state: { active: boolean; niche: string }) => {
  if (!projectId || typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(state));
  } catch {
    /* quota or privacy mode — silent */
  }
};

export const useAntifragileState = (projectId: string | null) => {
  const [state, setState] = useState<{ active: boolean; niche: string }>({ active: false, niche: "" });

  useEffect(() => {
    setState(loadProjectState(projectId));
  }, [projectId]);

  const update = (next: { active: boolean; niche: string }) => {
    setState(next);
    saveProjectState(projectId, next);
  };

  return { state, update };
};

const AntifragileMode = ({ projectId, active, niche, onChange, accentColor = "#f97316" }: AntifragileModeProps) => {
  const [showModal, setShowModal] = useState(false);
  const [draftNiche, setDraftNiche] = useState(niche);

  useEffect(() => {
    setDraftNiche(niche);
  }, [niche]);

  const handleToggle = () => {
    if (!active) {
      // Activating — require niche
      if (niche.trim().length === 0) {
        setShowModal(true);
        return;
      }
      onChange({ active: true, niche });
    } else {
      onChange({ active: false, niche });
    }
  };

  const handleSaveNiche = () => {
    const cleaned = draftNiche.trim();
    if (cleaned.length === 0) return;
    onChange({ active: true, niche: cleaned });
    setShowModal(false);
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={handleToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowModal(true);
        }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-[0.14em] transition-all"
        style={{
          background: active ? `${accentColor}26` : "rgba(255,255,255,0.04)",
          border: `1px solid ${active ? accentColor : "rgba(255,255,255,0.12)"}`,
          color: active ? accentColor : "rgba(255,255,255,0.65)",
          boxShadow: active ? `0 0 18px ${accentColor}55` : "none",
        }}
        title={
          active
            ? `Antifragile Mode: ON · Niche: ${niche || "—"} · Right-click to edit niche`
            : "Activate Antifragile Resilience Orchestrator"
        }
      >
        <ShieldAlert className="w-3 h-3" />
        Antifragile
        {active && niche && (
          <span className="opacity-70 normal-case tracking-normal">· {niche.slice(0, 18)}</span>
        )}
      </motion.button>

      <AnimatePresence>
        {showModal && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }}
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 20, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 400 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl p-6"
              style={{
                background: "#0a0a0a",
                border: `1px solid ${accentColor}55`,
                boxShadow: `0 0 60px ${accentColor}33, 0 20px 40px rgba(0,0,0,0.6)`,
              }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: `${accentColor}22`, border: `1px solid ${accentColor}66` }}
                  >
                    <ShieldAlert className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white tracking-tight">
                      Antifragile Orchestrator
                    </h3>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-mono mt-0.5">
                      Define operating niche
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-white/40 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[12px] text-white/65 leading-relaxed mb-4">
                Every Antifragile output is engineered around your sector. Specify the niche this
                project operates in — industry, market, or domain. Saved to this project only.
              </p>

              <label className="block text-[10px] uppercase tracking-[0.16em] text-white/50 font-mono mb-1.5">
                Project niche / sector
              </label>
              <input
                type="text"
                value={draftNiche}
                onChange={(e) => setDraftNiche(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveNiche();
                }}
                autoFocus
                placeholder="e.g. Premium auto-detailing in volatile EU markets"
                className="w-full bg-black/60 border border-white/15 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 transition-colors"
                style={{ borderColor: draftNiche ? `${accentColor}66` : undefined }}
              />

              <div className="flex items-center gap-2 mt-5">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-3 py-2 text-xs text-white/60 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNiche}
                  disabled={draftNiche.trim().length === 0}
                  className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-[0.12em] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: accentColor,
                    color: "#0a0a0a",
                    boxShadow: `0 0 24px ${accentColor}66`,
                  }}
                >
                  <Check className="w-3.5 h-3.5" />
                  Engage
                </button>
              </div>

              <p className="text-[10px] text-white/35 font-mono mt-4 leading-relaxed">
                ⚠ Outputs will be stress-tested against volatility, supplier shocks, and regulatory
                whiplash. No fluff. Neo-brutalist structure.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AntifragileMode;

export const ANTIFRAGILE_SYSTEM_PROMPT = (niche: string) => `[MODE: ANTIFRAGILE_RESILIENCE_ORCHESTRATOR]
Role: NazAI — Antifragile Resilience Orchestrator (Epistemic Architect).
Objective: Engineer volatility-resistant, gain-from-disorder business systems and operations for the user's niche: "${niche}". Operate as if the environment is uncertain, disrupted, or high-threat.

CORE OPERATING PROTOCOL (mandatory, in order):
1. Divergent Generation — internally propose three distinct strategic directions for the request.
2. The Forge Phase (Stress-Test) — act as the uncompromising "No-Man." For each direction, ruthlessly identify the Single Point of Failure (SPF). Reject any strategy that depends on stable market conditions, single suppliers, generic USPs, untested assumptions, or that only performs in low-volatility scenarios. Stress-test against patterns from sustained infrastructure stress, resource shocks, regulatory whiplash, hybrid disruptions, and reconstruction constraints.
3. Resilient Synthesis — output ONLY the strategy that survives the Forge. It must demonstrate clear antifragile properties (optionality, redundancy that creates upside, rapid adaptation loops) and include a dynamic orchestration map.

CONSTRAINTS:
- Zero Hallucination: if a data point is unknown, flag it explicitly as a "Strategic Blindspot." Never invent facts.
- Logical Anchoring: every major recommendation must include a "Propositional Proof" tied to a real constraint or observed pattern (e.g., "We recommend X because of Y market constraint observed in disrupted environments").
- Adultish Neo-Brutalist Aesthetic: clean, raw, high-contrast Markdown. Bold headers, heavy tables for trade-offs, unpolished structural clarity. No fluff, no corporate softening. No emojis except where structurally necessary.

OUTPUT STRUCTURE (use exactly these sections, in this order, as Markdown H2 headings):

# [MISSION_NAME] — Antifragile Operation

## Strategic Blueprint (Surviving Direction)
Concise core plan with built-in antifragile mechanisms.

## The Epistemic Forge (Logic Log)
For each major decision, list:
- **Constraint Identified:**
- **Potential Failure Point (SPF):**
- **Resilient Pivot + Antifragile Mechanism:**
- **Propositional Proof:**

## Orchestration Map
Phased sequence of agents/tools/human steps + contingency branches + monitoring triggers. Use a Markdown table or a \`\`\`mermaid flowchart when it adds clarity.

## Resilience Scorecard
Markdown table with rows:
- Estimated recovery time under stress
- Upside potential from disorder
- Overall antifragility rating (1–10)

## Strategic Blindspots & Crucial Experiments
List key unknowns + low-cost real-world tests to validate assumptions.

## Execution Orchestration Specs
Concrete rollout steps, required integrations, measurable triggers, and adaptation loops.

Hard rules:
- Never output the three divergent directions or the rejected ones — only the surviving synthesis.
- Never soften language. Be precise, structural, and operator-grade.
- Tables and mermaid diagrams are encouraged where they add density.

`;

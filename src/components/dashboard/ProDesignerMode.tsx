import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface ProDesignerModeProps {
  projectId: string | null;
  active: boolean;
  onChange: (next: { active: boolean }) => void;
  accentColor?: string;
}

const STORAGE_PREFIX = "nazai:pro-designer:";

const loadProjectState = (projectId: string | null) => {
  if (!projectId || typeof window === "undefined") return { active: false };
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return { active: false };
    const parsed = JSON.parse(raw);
    return { active: Boolean(parsed?.active) };
  } catch {
    return { active: false };
  }
};

const saveProjectState = (projectId: string | null, state: { active: boolean }) => {
  if (!projectId || typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(state));
  } catch {
    /* silent */
  }
};

export const useProDesignerState = (projectId: string | null) => {
  const [state, setState] = useState<{ active: boolean }>({ active: false });

  useEffect(() => {
    setState(loadProjectState(projectId));
  }, [projectId]);

  const update = (next: { active: boolean }) => {
    setState(next);
    saveProjectState(projectId, next);
  };

  return { state, update };
};

const ProDesignerMode = ({ active, onChange, accentColor = "#a78bfa" }: ProDesignerModeProps) => {
  return (
    <motion.button
      type="button"
      onClick={() => onChange({ active: !active })}
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
          ? "Pro Designer Mode: ON · Senior B2B web designer system prompt is active"
          : "Activate Pro Designer Mode (15+ yrs senior web designer protocol)"
      }
    >
      <Sparkles className="w-3 h-3" />
      Pro Designer
    </motion.button>
  );
};

export default ProDesignerMode;

export const PRO_DESIGNER_SYSTEM_PROMPT = `[MODE: PRO_WEB_DESIGNER]
Role: World-class senior web designer & front-end developer with 15+ years of experience building high-converting, enterprise-grade corporate websites for B2B, professional services, SaaS, and premium brands. Designs are clean, minimalist, authoritative, sophisticated, and highly professional — never generic, never "AI-looking", never overly decorative or playful.

CORE DESIGN & QUALITY PRINCIPLES (never compromise):
- Modern minimalist corporate aesthetic. Excellent white space, refined typography hierarchy, perfect visual balance.
- Use professional fonts (Inter, Satoshi, or system UI). High readability, WCAG AA compliant.
- Subtle, purposeful micro-animations and hover states only — no excessive flair.
- Strong focus on trust, credibility, clarity, and conversion. Confident, benefit-driven copy. No hype, clichés, or generic marketing speak.
- Mobile-first, fully responsive. Excellent on all devices.
- Clear navigation, logical information hierarchy, strong strategic CTAs.

TECHNICAL REQUIREMENTS:
- Clean, semantic, accessible HTML5 + modern Tailwind CSS (preferred). 
- Proper heading structure (H1–H6), alt texts, meta tags, SEO-friendly markup.
- Lightweight, performant, production-ready.

BEHAVIOR:
1. If the user provides a business and key info is missing (audience, primary goal, USP, tone, color preferences, key pages), ask focused clarifying questions FIRST — but never block delivery if details are sufficient.
2. Deliver a complete, polished first version structured as: Sticky Navbar (logo + nav + prominent CTA) → Hero → Trust bar / logos → Value Proposition → Services / Offerings → Social Proof (testimonials/stats/case studies) → About → Strong final CTA section → Footer.
3. EDITING & ITERATION: Become extremely precise at implementing user feedback. Implement every requested change exactly (design, layout, copy, colors, sections, tone, spacing, CTAs, functionality). Maintain overall consistency and professional quality. Always deliver the COMPLETE updated website code with changes applied — never partial snippets.
4. Be proactive: if a requested change harms professionalism or conversion, politely suggest a better alternative while still respecting the user's core request.
5. Maintain memory of the entire project across the conversation.

OUTPUT FORMAT:
- First: a short summary of your understanding of the business and the design direction.
- Then: the full website code, well-organized and commented.
- For follow-ups: always deliver the complete updated website with all requested improvements applied.

ADDITIONAL TOUCHES:
- Suggest authentic, high-quality imagery style (no cheap stock photos).
- CTAs must be benefit-oriented and action-driven.
- Optimize the conversion flow toward the main business goal.
`;

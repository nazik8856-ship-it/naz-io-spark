import { useState } from "react";
import { Lightbulb, Sparkles, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface IdeaHelperProps {
  onSelectIdea: (idea: string) => void;
}

const STARTER_PROMPTS: Record<string, string[]> = {
  restaurant: [
    "A modern sushi restaurant with online reservations and a tasting menu gallery",
    "A cozy Italian trattoria with daily specials, chef's story, and Instagram feed",
    "A fast-casual poke bowl spot with online ordering and loyalty rewards",
  ],
  portfolio: [
    "A minimalist photographer portfolio with full-screen image grids and client testimonials",
    "A freelance developer portfolio with project case studies and a contact form",
    "An artist portfolio with immersive gallery, exhibition timeline, and press section",
  ],
  store: [
    "A handmade jewelry store with product zoom, size guide, and wishlist",
    "A sustainable clothing brand with lookbook, size finder, and impact tracker",
    "A specialty coffee roaster with subscription plans and brew guides",
  ],
  startup: [
    "A SaaS landing page with feature comparison, pricing tiers, and demo booking",
    "A fintech startup with trust indicators, ROI calculator, and investor section",
    "An AI tool landing page with live demo, use cases, and integration logos",
  ],
  default: [
    "A personal blog with dark mode, reading time estimates, and newsletter signup",
    "A fitness coach site with class schedule, transformation gallery, and booking",
    "A nonprofit landing page with impact stats, donation tiers, and volunteer signup",
    "A wedding invitation site with RSVP form, photo gallery, and countdown timer",
  ],
};

function getIdeas(keyword: string): string[] {
  const lower = keyword.toLowerCase();
  for (const [key, ideas] of Object.entries(STARTER_PROMPTS)) {
    if (key !== "default" && lower.includes(key)) return ideas;
  }
  // Check partial matches
  if (lower.includes("food") || lower.includes("cafe") || lower.includes("bakery")) return STARTER_PROMPTS.restaurant;
  if (lower.includes("shop") || lower.includes("ecommerce") || lower.includes("product")) return STARTER_PROMPTS.store;
  if (lower.includes("agency") || lower.includes("freelance") || lower.includes("design")) return STARTER_PROMPTS.portfolio;
  if (lower.includes("app") || lower.includes("saas") || lower.includes("tech")) return STARTER_PROMPTS.startup;
  return STARTER_PROMPTS.default;
}

const IdeaHelper = ({ onSelectIdea }: IdeaHelperProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);

  const handleGenerate = () => {
    if (!keyword.trim()) return;
    setIsThinking(true);
    // Simulate brief thinking delay
    setTimeout(() => {
      setIdeas(getIdeas(keyword.trim()));
      setIsThinking(false);
    }, 600);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-primary transition-colors mt-2"
      >
        <Lightbulb className="w-3.5 h-3.5 group-hover:text-primary transition-colors" />
        <span className="underline underline-offset-2 decoration-muted-foreground/30 group-hover:decoration-primary/50">
          Don't know what to start with?
        </span>
      </button>
    );
  }

  return (
    <div className="mt-3 p-4 rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Lightbulb className="w-4 h-4 text-primary" />
          What's your idea about?
        </div>
        <button
          onClick={() => { setIsOpen(false); setIdeas([]); setKeyword(""); }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="e.g. restaurant, portfolio, online store..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
          className="text-sm bg-secondary/50 border-border/50 h-9"
        />
        <Button
          size="sm"
          variant="default"
          onClick={handleGenerate}
          disabled={!keyword.trim() || isThinking}
          className="shrink-0 h-9"
        >
          {isThinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {ideas.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Pick one to get started:</p>
          {ideas.map((idea, i) => (
            <button
              key={i}
              onClick={() => onSelectIdea(idea)}
              className="w-full text-left p-3 rounded-lg border border-border/30 bg-secondary/30 hover:bg-primary/10 hover:border-primary/30 transition-all group flex items-start gap-2"
            >
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-muted-foreground/50 group-hover:text-primary shrink-0 transition-colors" />
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{idea}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default IdeaHelper;

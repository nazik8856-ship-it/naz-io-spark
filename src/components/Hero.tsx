import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

const Hero = ({ onStart }: { onStart?: () => void }) => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div
            className="animate-section-enter inline-flex items-center gap-2 px-4 py-2 rounded-full glass border-glow mb-8"
            style={{ animationDelay: "0.2s" }}
          >
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-muted-foreground">AI-Powered Business Launcher</span>
          </div>

          {/* Headline */}
          <h1
            className="animate-section-enter text-5xl md:text-7xl font-bold tracking-tight mb-6"
            style={{ animationDelay: "0.35s" }}
          >
            Launch a Real Online Business using <span className="text-gradient">AI in Minutes</span>
          </h1>

          {/* Subheadline */}
          <p
            className="animate-section-enter text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
            style={{ animationDelay: "0.5s" }}
          >
            Describe your idea. NazAI validates it, writes the plan, and deploys it live — in minutes.
          </p>

          {/* CTA Buttons */}
          <div
            className="animate-section-enter flex flex-col sm:flex-row items-center justify-center gap-4"
            style={{ animationDelay: "0.65s" }}
          >
            <Button variant="hero" size="xl" onClick={onStart}>
              Start for Free
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Button variant="heroOutline" size="xl">
              Watch Demo
            </Button>
          </div>

          {/* Trust Indicators */}
          <div
            className="animate-section-enter mt-16 pt-8 border-t border-border/50"
            style={{ animationDelay: "0.8s" }}
          >
            <p className="text-sm text-muted-foreground mb-6">Built for</p>
            <div className="flex flex-wrap items-center justify-center gap-8 opacity-50">
              {["Founders", "Solo Builders", "Startups", "Dev Teams", "Entrepreneurs"].map((company) => (
                <span key={company} className="text-lg font-semibold text-muted-foreground">
                  {company}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;

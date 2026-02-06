import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, TrendingUp, Users, DollarSign, Zap } from "lucide-react";
import type { GeneratedBusiness } from "@/pages/Dashboard";

interface GeneratedResultsProps {
  results: GeneratedBusiness[];
  onGenerateMore: () => void;
}

const GeneratedResults = ({ results, onGenerateMore }: GeneratedResultsProps) => {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">
            Your <span className="text-gradient">Generated Ideas</span>
          </h2>
          <p className="text-muted-foreground">
            {results.length} business opportunities discovered
          </p>
        </div>
        <Button variant="heroOutline" onClick={onGenerateMore}>
          <Sparkles className="w-4 h-4" />
          Generate More
        </Button>
      </div>

      {/* Results Grid */}
      <div className="grid gap-6">
        {results.map((business, index) => (
          <div
            key={index}
            className="p-6 rounded-2xl glass border-glow hover:glow-soft transition-all duration-300"
          >
            <div className="flex flex-col lg:flex-row lg:items-start gap-6">
              {/* Main Info */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                    <span className="text-xl font-bold text-primary">#{index + 1}</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-foreground">{business.name}</h3>
                    <p className="text-sm text-primary">{business.industry}</p>
                  </div>
                </div>

                <p className="text-muted-foreground mb-4">{business.description}</p>

                {/* Tags */}
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm">
                    {business.revenueModel.split(" ")[0]}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-secondary text-muted-foreground text-sm">
                    {business.targetAudience}
                  </span>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-4 lg:w-64">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
                  <DollarSign className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">Est. Revenue</p>
                    <p className="text-sm font-semibold text-foreground">{business.estimatedRevenue}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">Growth Potential</p>
                    <p className="text-sm font-semibold text-foreground">{business.growthPotential}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 col-span-2 lg:col-span-1">
                  <Zap className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">Advantage</p>
                    <p className="text-sm font-semibold text-foreground line-clamp-1">{business.competitiveAdvantage}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Action */}
            <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Ready to explore this opportunity?
              </p>
              <Button variant="hero" size="sm">
                Explore Details
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GeneratedResults;

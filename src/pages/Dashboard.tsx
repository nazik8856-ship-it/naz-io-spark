import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, Sparkles, ArrowRight, ArrowLeft, Building2, Target, Users, TrendingUp, CheckCircle2 } from "lucide-react";
import BusinessWizard from "@/components/BusinessWizard";
import GeneratedResults from "@/components/GeneratedResults";

export interface GeneratedBusiness {
  name: string;
  industry: string;
  description: string;
  targetAudience: string;
  revenueModel: string;
  competitiveAdvantage: string;
  estimatedRevenue: string;
  growthPotential: string;
}

const Dashboard = () => {
  const [showWizard, setShowWizard] = useState(false);
  const [generatedResults, setGeneratedResults] = useState<GeneratedBusiness[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateBusiness = () => {
    setShowWizard(true);
  };

  const handleWizardComplete = (data: Record<string, string>) => {
    setIsGenerating(true);
    setShowWizard(false);

    // Simulate AI generation
    setTimeout(() => {
      const mockResults: GeneratedBusiness[] = [
        {
          name: `${data.industry || "Tech"} Solutions Pro`,
          industry: data.industry || "Technology",
          description: `An innovative ${data.businessType || "B2B"} platform leveraging AI to solve ${data.painPoint || "efficiency"} challenges.`,
          targetAudience: data.targetAudience || "Small to medium businesses",
          revenueModel: "SaaS subscription with tiered pricing",
          competitiveAdvantage: "AI-powered automation with 10x faster processing",
          estimatedRevenue: "$500K - $2M first year",
          growthPotential: "High",
        },
        {
          name: `${data.industry || "Digital"} AI Hub`,
          industry: data.industry || "Technology",
          description: `A cutting-edge marketplace connecting ${data.targetAudience || "businesses"} with AI-driven solutions.`,
          targetAudience: data.targetAudience || "Enterprise clients",
          revenueModel: "Commission-based with premium features",
          competitiveAdvantage: "First-mover advantage in niche market",
          estimatedRevenue: "$1M - $5M first year",
          growthPotential: "Very High",
        },
        {
          name: `Smart ${data.industry || "Business"} Network`,
          industry: data.industry || "Technology",
          description: `An AI-powered networking platform that automates ${data.painPoint || "lead generation"} for ${data.businessType || "B2B"} companies.`,
          targetAudience: data.targetAudience || "Growth-stage startups",
          revenueModel: "Freemium with enterprise tiers",
          competitiveAdvantage: "Proprietary AI matching algorithm",
          estimatedRevenue: "$250K - $1M first year",
          growthPotential: "Medium-High",
        },
      ];
      
      setGeneratedResults(mockResults);
      setIsGenerating(false);
    }, 3000);
  };

  const handleWizardClose = () => {
    setShowWizard(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-lg">N</span>
              </div>
              <span className="text-xl font-bold text-foreground">Naz.io</span>
            </Link>

            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <LogOut className="w-4 h-4" />
                Log out
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 pb-12">
        <div className="container mx-auto px-6">
          {/* Welcome Section */}
          <div className="mb-12">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">
              Welcome to <span className="text-gradient">Naz.io</span>
            </h1>
            <p className="text-muted-foreground text-lg">
              Generate AI-powered business ideas and opportunities
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid md:grid-cols-4 gap-4 mb-12">
            {[
              { icon: Building2, label: "Businesses Generated", value: generatedResults.length.toString() },
              { icon: Target, label: "Success Rate", value: "94%" },
              { icon: Users, label: "Active Users", value: "12K+" },
              { icon: TrendingUp, label: "Avg. Growth", value: "340%" },
            ].map((stat) => (
              <div key={stat.label} className="p-6 rounded-2xl glass border-glow">
                <stat.icon className="w-8 h-8 text-primary mb-3" />
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Generate Business CTA */}
          {!showWizard && !isGenerating && (
            <div className="text-center py-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border-glow mb-6">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">AI-Powered Generation</span>
              </div>
              
              <h2 className="text-2xl md:text-3xl font-bold mb-4">
                Ready to discover your next{" "}
                <span className="text-gradient">business opportunity</span>?
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto mb-8">
                Our AI analyzes market trends, identifies gaps, and generates personalized business ideas tailored to your expertise and goals.
              </p>
              
              <Button variant="hero" size="xl" onClick={handleGenerateBusiness}>
                <Sparkles className="w-5 h-5" />
                Generate Business
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          )}

          {/* Wizard */}
          {showWizard && (
            <BusinessWizard 
              onComplete={handleWizardComplete} 
              onClose={handleWizardClose}
            />
          )}

          {/* Loading State */}
          {isGenerating && (
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/20 mb-6 animate-pulse">
                <Sparkles className="w-8 h-8 text-primary animate-spin" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Generating Your Business Ideas...</h2>
              <p className="text-muted-foreground">Our AI is analyzing market trends and opportunities</p>
            </div>
          )}

          {/* Generated Results */}
          {generatedResults.length > 0 && !showWizard && !isGenerating && (
            <GeneratedResults 
              results={generatedResults} 
              onGenerateMore={handleGenerateBusiness}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;

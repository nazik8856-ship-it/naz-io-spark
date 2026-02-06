import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { ArrowRight, ArrowLeft, X, Sparkles } from "lucide-react";

interface WizardStep {
  id: string;
  title: string;
  description: string;
  field: string;
  placeholder: string;
  options?: string[];
}

const wizardSteps: WizardStep[] = [
  {
    id: "industry",
    title: "What industry interests you?",
    description: "Select or type the industry you want to explore",
    field: "industry",
    placeholder: "e.g., Technology, Healthcare, Finance",
    options: ["Technology", "Healthcare", "Finance", "E-commerce", "Education", "Real Estate"],
  },
  {
    id: "businessType",
    title: "What type of business model?",
    description: "Choose your preferred business approach",
    field: "businessType",
    placeholder: "e.g., B2B, B2C, Marketplace",
    options: ["B2B SaaS", "B2C Product", "Marketplace", "Agency/Service", "Subscription", "Freemium"],
  },
  {
    id: "targetAudience",
    title: "Who is your target audience?",
    description: "Describe your ideal customers",
    field: "targetAudience",
    placeholder: "e.g., Small businesses, Enterprise, Consumers",
    options: ["Startups", "Small Businesses", "Mid-Market", "Enterprise", "Consumers", "Developers"],
  },
  {
    id: "painPoint",
    title: "What problem do you want to solve?",
    description: "Identify the main pain point to address",
    field: "painPoint",
    placeholder: "e.g., Time management, Lead generation, Automation",
    options: ["Efficiency", "Cost Reduction", "Lead Generation", "Communication", "Analytics", "Automation"],
  },
  {
    id: "budget",
    title: "What's your starting budget?",
    description: "This helps us suggest realistic opportunities",
    field: "budget",
    placeholder: "e.g., $10K, $50K, $100K+",
    options: ["Under $10K", "$10K - $50K", "$50K - $100K", "$100K - $500K", "$500K+"],
  },
];

interface BusinessWizardProps {
  onComplete: (data: Record<string, string>) => void;
  onClose: () => void;
}

const BusinessWizard = ({ onComplete, onClose }: BusinessWizardProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [customInput, setCustomInput] = useState("");

  const step = wizardSteps[currentStep];
  const isLastStep = currentStep === wizardSteps.length - 1;
  const isFirstStep = currentStep === 0;

  const handleOptionSelect = (option: string) => {
    setFormData({ ...formData, [step.field]: option });
    setCustomInput("");
  };

  const handleNext = () => {
    // Save custom input if provided
    if (customInput) {
      setFormData({ ...formData, [step.field]: customInput });
    }

    if (isLastStep) {
      onComplete(formData);
    } else {
      setCurrentStep(currentStep + 1);
      setCustomInput("");
    }
  };

  const handleBack = () => {
    if (!isFirstStep) {
      setCurrentStep(currentStep - 1);
      setCustomInput("");
    }
  };

  const progress = ((currentStep + 1) / wizardSteps.length) * 100;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            Step {currentStep + 1} of {wizardSteps.length}
          </p>
          <div className="w-48 h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Step Content */}
      <div className="p-8 rounded-3xl glass border-glow">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{step.title}</h2>
            <p className="text-muted-foreground text-sm">{step.description}</p>
          </div>
        </div>

        {/* Options Grid */}
        {step.options && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            {step.options.map((option) => (
              <button
                key={option}
                onClick={() => handleOptionSelect(option)}
                className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                  formData[step.field] === option
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/50 hover:bg-secondary/50"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {/* Custom Input */}
        <div className="space-y-2">
          <Label htmlFor="custom">Or enter your own</Label>
          <Input
            id="custom"
            placeholder={step.placeholder}
            value={customInput}
            onChange={(e) => {
              setCustomInput(e.target.value);
              setFormData({ ...formData, [step.field]: e.target.value });
            }}
            className="bg-secondary/50 border-border"
          />
        </div>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={isFirstStep}
            className={isFirstStep ? "invisible" : ""}
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>

          <Button
            variant="hero"
            onClick={handleNext}
            disabled={!formData[step.field] && !customInput}
          >
            {isLastStep ? (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Ideas
              </>
            ) : (
              <>
                Next
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BusinessWizard;

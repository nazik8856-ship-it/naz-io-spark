import { ArrowRight, CheckCircle2, Sparkles, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WorkflowPreviewProps {
  prompt: string;
  onApprove: () => void;
  onCancel: () => void;
  isGenerating: boolean;
}

const steps = [
  { icon: <Sparkles className="w-4 h-4" />, label: "Plan", detail: "Analyze your prompt & pick a style" },
  { icon: <Eye className="w-4 h-4" />, label: "Act", detail: "Generate full HTML/CSS/JS website" },
  { icon: <Pencil className="w-4 h-4" />, label: "Reflect", detail: "Preview & iterate with AI chat" },
];

const WorkflowPreview = ({ prompt, onApprove, onCancel, isGenerating }: WorkflowPreviewProps) => {
  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="rounded-xl border-2 border-primary/30 bg-card p-6 space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-1">
            Proposed Workflow
          </p>
          <p className="text-sm text-muted-foreground">
            Here's how NazAI will bring your idea to life:
          </p>
        </div>

        {/* Prompt preview */}
        <div className="rounded-lg bg-secondary/50 border border-border px-4 py-3">
          <p className="text-xs text-muted-foreground mb-1 font-medium">Your prompt</p>
          <p className="text-sm text-foreground leading-relaxed line-clamp-3">"{prompt}"</p>
        </div>

        {/* Steps */}
        <div className="flex items-center justify-center gap-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex flex-col items-center text-center gap-1.5 min-w-[100px]">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  {step.icon}
                </div>
                <p className="text-xs font-bold text-foreground">{step.label}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{step.detail}</p>
              </div>
              {i < steps.length - 1 && (
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-[-20px]" />
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <Button
            variant="hero"
            size="lg"
            onClick={onApprove}
            disabled={isGenerating}
            className="flex-1"
          >
            <CheckCircle2 className="w-4 h-4" />
            Generate Now
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={onCancel}
            disabled={isGenerating}
          >
            Revise Prompt
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowPreview;

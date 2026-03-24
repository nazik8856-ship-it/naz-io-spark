import { cn } from "@/lib/utils";

interface DecisionOption {
  label: string;
  description: string;
  icon?: React.ReactNode;
}

interface DecisionForkProps {
  question: string;
  options: [DecisionOption, DecisionOption];
  onSelect: (index: number) => void;
}

const DecisionFork = ({ question, options, onSelect }: DecisionForkProps) => {
  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="rounded-xl border-2 border-primary/20 bg-card p-5 space-y-4">
        <p className="text-sm font-bold text-foreground text-center">{question}</p>
        <div className="grid grid-cols-2 gap-3">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className={cn(
                "flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-border",
                "bg-secondary/30 hover:border-primary hover:bg-primary/5",
                "transition-all duration-200 hover:scale-[1.02] hover:-translate-y-0.5",
                "text-center group"
              )}
            >
              {opt.icon && (
                <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  {opt.icon}
                </div>
              )}
              <p className="text-sm font-semibold text-foreground">{opt.label}</p>
              <p className="text-xs text-muted-foreground leading-snug">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DecisionFork;

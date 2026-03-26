import { Pencil, Globe, Download, Share2, Sparkles, Palette, Layout, Type } from "lucide-react";
import { cn } from "@/lib/utils";

interface NextStepAction {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

interface NextStepSuggestionsProps {
  onEdit: () => void;
  onPublish: () => void;
  onShare: () => void;
  onDownload: () => void;
  onNewWebsite: () => void;
  isPublished: boolean;
  onStrategyQuestion?: (question: string) => void;
}

const NextStepSuggestions = ({
  onEdit,
  onPublish,
  onShare,
  onDownload,
  onNewWebsite,
  isPublished,
}: NextStepSuggestionsProps) => {
  const actions: NextStepAction[] = [
    {
      icon: <Pencil className="w-5 h-5" />,
      label: "Refine & Edit",
      description: "Use the AI chat to tweak layout, colors, or copy",
      onClick: onEdit,
      variant: "primary",
    },
    {
      icon: <Globe className="w-5 h-5" />,
      label: isPublished ? "View Live" : "Publish Live",
      description: isPublished ? "Your site is live — check it out" : "Make your website publicly accessible",
      onClick: onPublish,
      variant: "primary",
    },
    {
      icon: <Share2 className="w-5 h-5" />,
      label: "Share Link",
      description: "Copy a shareable preview link",
      onClick: onShare,
    },
    {
      icon: <Sparkles className="w-5 h-5" />,
      label: "Start Fresh",
      description: "Generate a completely new website",
      onClick: onNewWebsite,
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
        What's next?
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={action.onClick}
            className={cn(
              "group flex flex-col items-start gap-2 p-4 rounded-xl border-2 text-left transition-all duration-200",
              "hover:scale-[1.02] hover:-translate-y-0.5",
              action.variant === "primary"
                ? "border-primary/50 bg-primary/5 hover:border-primary hover:bg-primary/10"
                : "border-border bg-card hover:border-primary/30 hover:bg-secondary/50"
            )}
          >
            <div
              className={cn(
                "p-2 rounded-lg transition-colors",
                action.variant === "primary"
                  ? "bg-primary/10 text-primary group-hover:bg-primary/20"
                  : "bg-secondary text-muted-foreground group-hover:text-primary"
              )}
            >
              {action.icon}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{action.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {action.description}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default NextStepSuggestions;

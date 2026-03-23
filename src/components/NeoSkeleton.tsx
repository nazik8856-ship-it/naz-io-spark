import { cn } from "@/lib/utils";

interface NeoSkeletonProps {
  className?: string;
  lines?: number;
  variant?: "block" | "text" | "card" | "preview";
}

const NeoSkeleton = ({ className, lines = 3, variant = "block" }: NeoSkeletonProps) => {
  if (variant === "preview") {
    return (
      <div className={cn("w-full h-full min-h-[500px] bg-background border-4 border-foreground p-6 space-y-6", className)}>
        {/* Nav skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-8 w-32 bg-primary animate-neo-pulse border-2 border-foreground" />
          <div className="flex gap-3">
            <div className="h-8 w-20 bg-muted animate-neo-pulse border-2 border-foreground" style={{ animationDelay: "0.1s" }} />
            <div className="h-8 w-20 bg-muted animate-neo-pulse border-2 border-foreground" style={{ animationDelay: "0.2s" }} />
            <div className="h-8 w-20 bg-muted animate-neo-pulse border-2 border-foreground" style={{ animationDelay: "0.3s" }} />
          </div>
        </div>
        {/* Hero skeleton */}
        <div className="space-y-4 pt-8">
          <div className="h-12 w-3/4 bg-primary/30 animate-neo-pulse border-2 border-foreground mx-auto" style={{ animationDelay: "0.2s" }} />
          <div className="h-6 w-1/2 bg-muted animate-neo-pulse border-2 border-foreground mx-auto" style={{ animationDelay: "0.4s" }} />
          <div className="flex justify-center gap-4 pt-4">
            <div className="h-12 w-36 bg-primary animate-neo-pulse border-2 border-foreground" style={{ animationDelay: "0.5s" }} />
            <div className="h-12 w-36 bg-muted animate-neo-pulse border-2 border-foreground" style={{ animationDelay: "0.6s" }} />
          </div>
        </div>
        {/* Cards skeleton */}
        <div className="grid grid-cols-3 gap-4 pt-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 p-4 border-2 border-foreground bg-card" style={{ animationDelay: `${0.7 + i * 0.15}s` }}>
              <div className="h-6 w-full bg-primary/20 animate-neo-pulse border-2 border-foreground" />
              <div className="h-4 w-3/4 bg-muted animate-neo-pulse border-2 border-foreground" />
              <div className="h-4 w-1/2 bg-muted animate-neo-pulse border-2 border-foreground" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div className={cn("p-5 border-4 border-foreground bg-card space-y-3", className)}>
        <div className="h-6 w-2/3 bg-primary/30 animate-neo-pulse border-2 border-foreground" />
        <div className="h-4 w-full bg-muted animate-neo-pulse border-2 border-foreground" style={{ animationDelay: "0.15s" }} />
        <div className="h-4 w-4/5 bg-muted animate-neo-pulse border-2 border-foreground" style={{ animationDelay: "0.3s" }} />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-5 bg-muted animate-neo-pulse border-2 border-foreground"
          style={{
            width: `${85 - i * 15}%`,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  );
};

export default NeoSkeleton;

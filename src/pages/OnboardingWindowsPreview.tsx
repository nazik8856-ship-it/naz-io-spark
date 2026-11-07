import { useSearchParams } from "react-router-dom";
import { LimitWindowView } from "@/components/onboarding/LimitWindow";
import { OnboardingWindowView } from "@/components/onboarding/OnboardingWindows";
import type { LimitKind } from "@/lib/limit-window";
import type { OnboardingWindowId } from "@/lib/onboarding-windows";

// Development only (the route exists only in `vite dev`): every onboarding and limit window with fixed values, for review and
// screenshots. ?w=<window id> picks one: first_use_control, first_use_generator, connector_unlock, control_unlock, discovery,
// feedback, limit_control_task, limit_website, limit_credits; &usage=1 opens "View usage" on a limit window.

const ONBOARDING: OnboardingWindowId[] = ["first_use_control", "first_use_generator", "connector_unlock", "control_unlock", "discovery", "feedback"];

export default function OnboardingWindowsPreview() {
  const [params] = useSearchParams();
  const w = params.get("w") ?? "first_use_control";
  const noop = () => undefined;
  return (
    <div className="min-h-screen bg-[#020617] p-8 text-zinc-500">
      <div className="mx-auto max-w-3xl space-y-3 opacity-60">
        <div className="h-10 w-64 rounded-lg bg-white/[0.04]" />
        <div className="h-40 rounded-2xl border border-white/5 bg-white/[0.02]" />
        <div className="h-24 rounded-2xl border border-white/5 bg-white/[0.02]" />
      </div>
      {(ONBOARDING as string[]).includes(w) && (
        <OnboardingWindowView id={w as OnboardingWindowId} canStartTask done={noop} go={noop} />
      )}
      {w.startsWith("limit_") && (
        <LimitWindowView
          detail={{ kind: w.slice(6) as LimitKind, used: w === "limit_website" ? 2 : 3, limit: w === "limit_website" ? 2 : 3, resets_at: "2026-12-01T00:00:00+00:00" }}
          open
          onClose={noop}
          onUpgrade={noop}
          showUsage={params.get("usage") === "1"}
          onViewUsage={noop}
          usage={[
            { label: "Control Tasks", used: w === "limit_website" ? 1 : 3, limit: 3 },
            { label: "New websites", used: w === "limit_website" ? 2 : 0, limit: 2 },
          ]}
          credits={w === "limit_credits" ? 0 : 12}
        />
      )}
    </div>
  );
}

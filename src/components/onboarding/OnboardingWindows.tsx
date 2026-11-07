import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import OnboardingArt, { type OnboardingArtKind } from "@/components/onboarding/OnboardingArt";
import {
  FEEDBACK_REASONS, isOnboardingUser, isOuterPath, nextWindow, onboardingState,
  type OnboardingState, type OnboardingWindowId,
} from "@/lib/onboarding-windows";

// First-time windows 3-5 and the post-first-success cards (docs/onboarding-windows.md). Small corner cards, one at a time, never
// modal: the person can keep working and ignore them. Each carries exactly one creative from OnboardingArt.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // outer_control_workflows is not in the generated types

/** The routes inside the app where these cards may appear (never on the landing page or sign-in). */
const APP_PREFIXES = ["/dashboard", "/generator-home", "/control-system", "/projects", "/generated"];
const OPEN = new Set(["queued", "running", "awaiting_human"]);

export function OnboardingCard({ art, eyebrow, title, children, onClose, testId }: {
  art: OnboardingArtKind; eyebrow: string; title: string; children: ReactNode; onClose: () => void; testId: string;
}) {
  return (
    <section
      role="complementary"
      aria-label={title}
      className="oc-in fixed bottom-4 left-4 right-4 z-40 overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#030a17]/95 p-4 text-white shadow-[0_0_60px_-22px_rgba(34,211,238,0.5)] backdrop-blur sm:right-auto sm:w-[380px]"
      data-testid={testId}
    >
      <div className="pointer-events-none absolute -left-16 -top-16 h-40 w-40 rounded-full bg-cyan-500/10 blur-[70px]" aria-hidden />
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 transition hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" data-testid="onboarding-close">
        <X className="h-4 w-4" />
      </button>
      <div className="relative flex gap-4">
        <OnboardingArt kind={art} size={64} />
        <div className="min-w-0 flex-1 pr-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">{eyebrow}</div>
          <h2 className="mt-1 text-[15px] font-semibold leading-snug tracking-tight">{title}</h2>
          {children}
        </div>
      </div>
    </section>
  );
}

const Body = ({ children }: { children: ReactNode }) => <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{children}</p>;

function Actions({ primary, secondary }: { primary: { label: string; onClick: () => void; id: string }; secondary?: { label: string; onClick: () => void; id: string } }) {
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2">
      <button type="button" onClick={primary.onClick} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3.5 py-2 text-[13px] font-semibold text-[#03121a] transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" data-testid={primary.id}>
        {primary.label} <ArrowRight className="h-3.5 w-3.5" />
      </button>
      {secondary && (
        <button type="button" onClick={secondary.onClick} className="rounded-lg border border-white/10 px-3.5 py-2 text-[13px] text-zinc-300 transition hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" data-testid={secondary.id}>
          {secondary.label}
        </button>
      )}
    </div>
  );
}

function FeedbackWindow({ onDone }: { onDone: (value: string) => void }) {
  const [step, setStep] = useState<"ask" | "why" | "thanks">("ask");
  const answer = (v: string) => { setStep("thanks"); setTimeout(() => onDone(v), 1200); };
  return (
    <OnboardingCard art="feedback-check" eyebrow="Optional · 1 tap" title={step === "thanks" ? "Thanks, noted" : "Was this useful?"} onClose={() => onDone("skipped")} testId="onboarding-feedback">
      {step === "ask" && (
        <>
          <Body>Your first controlled Task finished. Tell us if the result helped; you can skip this.</Body>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => answer("useful")} className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3.5 py-2 text-[13px] font-medium text-cyan-100 transition hover:bg-cyan-400/20" data-testid="feedback-useful">Useful</button>
            <button type="button" onClick={() => setStep("why")} className="rounded-lg border border-white/10 px-3.5 py-2 text-[13px] text-zinc-300 transition hover:border-white/20 hover:text-white" data-testid="feedback-not-really">Not really</button>
            <button type="button" onClick={() => onDone("skipped")} className="ml-auto text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline" data-testid="feedback-skip">Skip</button>
          </div>
        </>
      )}
      {step === "why" && (
        <>
          <Body>What was missing? Pick one, or skip.</Body>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FEEDBACK_REASONS.map((r) => (
              <button key={r.id} type="button" onClick={() => answer(`not_useful:${r.id}`)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-cyan-400/40 hover:text-white" data-testid={`feedback-reason-${r.id}`}>{r.label}</button>
            ))}
          </div>
          <button type="button" onClick={() => answer("not_useful")} className="mt-2.5 text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">Skip</button>
        </>
      )}
      {step === "thanks" && <Body>This helps decide what to improve first.</Body>}
    </OnboardingCard>
  );
}

/** One window's content. `done(value)` records it as seen; `go(path)` records it and navigates. */
export function OnboardingWindowView({ id, canStartTask, done, go }: {
  id: OnboardingWindowId; canStartTask: boolean; done: (value?: true | string) => void; go: (path: string) => void;
}) {
  switch (id) {
    case "first_use_control":
      return (
        <OnboardingCard art="first-step" eyebrow="Outer Control · first use" title="Your first controlled step" onClose={() => done()} testId="onboarding-first-use-control">
          <Body>A Task runs in steps. At each step a tool answers, NazAI checks the reply against your rules, and you get one result that shows what was changed.</Body>
          <Actions primary={{ label: "Got it", onClick: () => done(), id: "onboarding-primary" }}
            secondary={canStartTask ? { label: "Start a task", onClick: () => go("/control-system/outer?start=task"), id: "onboarding-secondary" } : undefined} />
        </OnboardingCard>
      );
    case "first_use_generator":
      return (
        <OnboardingCard art="first-step" eyebrow="Generator · first use" title="Your first build" onClose={() => done()} testId="onboarding-first-use-generator">
          <Body>Describe what you want. The Generator proposes a page structure first; after you approve it, it writes the content and checks each page against your rules before saving.</Body>
          <Actions primary={{ label: "Got it", onClick: () => done(), id: "onboarding-primary" }} />
        </OnboardingCard>
      );
    case "connector_unlock":
      return (
        <OnboardingCard art="linked-nodes" eyebrow="Unlocked · after Task 1" title="Connect your own AI tool" onClose={() => done()} testId="onboarding-connector-unlock">
          <Body>Your first Task used NazAI's starter tools. Connect a tool (an HTTP endpoint or an MCP server) and its replies pass the same rule layer.</Body>
          <Actions primary={{ label: "Connect a tool", onClick: () => go("/control-system/outer?start=connect"), id: "onboarding-primary" }}
            secondary={{ label: "Later", onClick: () => done(), id: "onboarding-secondary" }} />
        </OnboardingCard>
      );
    case "control_unlock":
      return (
        <OnboardingCard art="shield-check" eyebrow="Unlocked · after Task 2" title="Generator and AI Control are open" onClose={() => done()} testId="onboarding-control-unlock">
          <Body>Two controlled Tasks are done. The Generator builds websites and agents under the same rules; AI Control holds those rules, the approvals and the record of every check.</Body>
          <Actions primary={{ label: "Try Generator", onClick: () => go("/generator-home"), id: "onboarding-primary" }}
            secondary={{ label: "Explore AI Control", onClick: () => go("/control-system"), id: "onboarding-secondary" }} />
        </OnboardingCard>
      );
    case "discovery":
      return (
        <OnboardingCard art="linked-nodes" eyebrow="Also in NazAI" title="The same rules apply everywhere" onClose={() => done()} testId="onboarding-discovery">
          <ul className="mt-2 space-y-1">
            {[
              { path: "/generator-home", name: "Generator", what: "Websites and agents from a description" },
              { path: "/control-system", name: "AI Control", what: "Rules, approvals and the record of every check" },
              { path: "/projects", name: "Projects", what: "Your documents, used as context for Tasks" },
            ].map((p) => (
              <li key={p.path}>
                <button type="button" onClick={() => go(p.path)} className="group flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.04]" data-testid={`discovery-${p.name.toLowerCase().replace(/\s/g, "-")}`}>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-zinc-100">{p.name}</span>
                    <span className="block text-xs text-zinc-500">{p.what}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-cyan-300/70 transition group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </OnboardingCard>
      );
    case "feedback":
      return <FeedbackWindow onDone={(v) => done(v)} />;
  }
}

/** Mounted once in App. Decides which first-time card to show, if any, and remembers what was seen on the account. */
export default function OnboardingWindows() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const eligible = isOnboardingUser(user);
  const [state, setState] = useState<OnboardingState>(() => onboardingState(user));
  useEffect(() => { setState(onboardingState(user)); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Completed and open Tasks on the account (the same reading FirstValueBanner uses).
  const [progress, setProgress] = useState({ done: 0, running: false });
  const onOuter = isOuterPath(location.pathname);
  useEffect(() => {
    if (!eligible || !user?.id) return;
    let stop = false;
    const read = async () => {
      try {
        const { data } = await anyDb.from("outer_control_workflows").select("status").eq("user_id", user.id);
        const rows = (Array.isArray(data) ? data : []) as { status: string }[];
        if (!stop) setProgress({ done: rows.filter((r) => r.status === "completed").length, running: rows.some((r) => OPEN.has(r.status)) });
      } catch { /* keep what is known */ }
    };
    void read();
    const t = setInterval(read, onOuter ? 5000 : 15000);
    return () => { stop = true; clearInterval(t); };
  }, [eligible, user?.id, onOuter]);

  // Any modal window (Welcome, the task choice, Start a task, the limit window) goes first: wait until none is open.
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => {
    if (!eligible) return;
    const check = () => setDialogOpen(!!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));
    check();
    const t = setInterval(check, 800);
    return () => clearInterval(t);
  }, [eligible]);

  // Leaving Outer Control after the first success.
  const prevPath = useRef(location.pathname);
  const [leftOuter, setLeftOuter] = useState(false);
  useEffect(() => {
    if (isOuterPath(prevPath.current) && !isOuterPath(location.pathname) && progress.done >= 1) setLeftOuter(true);
    prevPath.current = location.pathname;
  }, [location.pathname, progress.done]);

  if (!eligible || !APP_PREFIXES.some((p) => location.pathname.startsWith(p))) return null;
  const id = nextWindow({ path: location.pathname, done: progress.done, running: progress.running, dialogOpen, leftOuter, state });
  if (!id) return null;

  const mark = (value: true | string = true) => {
    const next = { ...state, [id]: value };
    setState(next);
    void supabase.auth.updateUser({ data: { onboarding: next } }).catch(() => undefined);
  };
  return (
    <OnboardingWindowView
      key={id}
      id={id}
      canStartTask={progress.done === 0 && !progress.running}
      done={mark}
      go={(path) => { mark(); navigate(path); }}
    />
  );
}

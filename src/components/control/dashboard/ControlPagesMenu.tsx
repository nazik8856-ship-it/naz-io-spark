// Blueprint task #63: every one of the Inner Control System's sub-pages
// used to live as a flat row of ~25 header buttons. The redesigned landing
// page surfaces a handful of them as real widgets instead (approvals,
// coverage, health) -- this menu is where EVERY one of them, including the
// two that had no nav entry at all (Policy, Spend & safety), stays
// reachable. Nothing from the old nav bar was dropped, just grouped.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type MenuItem = { label: string; description: string; path: string };
type MenuGroup = { title: string; items: MenuItem[] };

// Blueprint task #67 follow-up: names here used to be bare jargon ("Policy
// as code", "Confidence calibration", "Rule effectiveness", "Action
// reversals"...) with nothing explaining what you'd actually find on the
// other side of the click. Every label is now plain language, and every
// item carries a one-line description of what it does -- this menu is the
// one place that lists literally everything in the Inner Control System,
// so it's the highest-leverage place to fix that.
const GROUPS: MenuGroup[] = [
  {
    title: "Decisions",
    items: [
      {
        label: "Waiting on you",
        description: "Escalated or low-confidence actions that still need a human answer.",
        path: "/control-system/pending",
      },
      {
        label: "Approval queue",
        description: "Escalated actions that must be approved or rejected before they run.",
        path: "/control-system/approvals",
      },
      {
        label: "All decisions",
        description: "Every decision the AI has made, past and present -- searchable and filterable.",
        path: "/control-system/decision-history",
      },
      {
        label: "Live activity",
        description: "Watch decisions happen in real time, as they're made.",
        path: "/control-system/live",
      },
      {
        label: "Undo log",
        description: "Actions the AI actually carried out that can be (or were) reversed.",
        path: "/control-system/action-reversals",
      },
    ],
  },
  {
    title: "Rules & policy",
    items: [
      {
        label: "Safety rules",
        description: "Hard pattern-matching checks that run before any AI judgement call.",
        path: "/control-system/safety-rules",
      },
      {
        label: "Policy versions",
        description: "Saved snapshots of your rules over time; new versions are tested before going live.",
        path: "/control-system/policy",
      },
      {
        label: "Test a rule",
        description: "Try a hypothetical action against your rules before it happens for real.",
        path: "/control-system/simulator",
      },
      {
        label: "Starter rule sets",
        description: "Ready-made guardrails you can apply with one click instead of starting blank.",
        path: "/control-system/templates",
      },
      {
        label: "Ungoverned actions",
        description: "Things your connected tools can do that no rule currently covers.",
        path: "/control-system/coverage",
      },
      {
        label: "Export / import rules",
        description: "Back up or move your entire rule set as a file (for technical users).",
        path: "/control-system/policy-bundle",
      },
      {
        label: "Pending rule changes",
        description: "Edits to rules that still need approval before they take effect.",
        path: "/control-system/policy-changes",
      },
      {
        label: "What applies to this agent",
        description: "See exactly which rules apply to one specific agent right now.",
        path: "/control-system/agent-policy",
      },
    ],
  },
  {
    title: "Monitoring",
    items: [
      {
        label: "System health",
        description: "How reliably the Control System itself is running.",
        path: "/control-system/health",
      },
      {
        label: "Incidents",
        description: "Automatic safety events that need a human resolution note.",
        path: "/control-system/incidents",
      },
      {
        label: "Settings history",
        description: "Every change made to your rules, spend limits and safety switches.",
        path: "/control-system/changes",
      },
      {
        label: "Are my rules working?",
        description: "Rules that haven't matched anything in 30 days -- may be dead weight.",
        path: "/control-system/rule-effectiveness",
      },
      {
        label: "AI confidence accuracy",
        description: "When the AI says it's 80% sure, is it actually right 80% of the time?",
        path: "/control-system/confidence-calibration",
      },
      {
        label: "Verify records weren't altered",
        description: "Re-checks the cryptographic signature on every past decision.",
        path: "/control-system/audit-verify",
      },
    ],
  },
  {
    title: "Reports",
    items: [
      {
        label: "Compliance report",
        description: "An audit-ready summary of decisions, rules and incidents.",
        path: "/control-system/compliance",
      },
      {
        label: "Value report",
        description: "How much ran autonomously vs. needed a human, and what that's costing or saving.",
        path: "/control-system/roi",
      },
      {
        label: "Export or delete my data",
        description: "Download everything stored here, or request permanent deletion.",
        path: "/control-system/account-data",
      },
    ],
  },
  {
    title: "Admin",
    items: [
      {
        label: "Team",
        description: "Invite people and set what they're allowed to see, approve or change.",
        path: "/control-system/team",
      },
      {
        label: "Spend & safety",
        description: "Daily spend limit, kill switch and automatic circuit breakers.",
        path: "/control-system/spend-safety",
      },
      {
        label: "Notify other tools",
        description: "Send an automatic alert to Slack, PagerDuty, etc. when something happens.",
        path: "/control-system/webhooks",
      },
      {
        label: "API keys",
        description: "Keys other systems use to call the Control System directly.",
        path: "/control-system/api-keys",
      },
      {
        label: "Developer docs",
        description: "Reference for developers integrating directly with the Control API.",
        path: "/control-system/api-docs",
      },
    ],
  },
];

export default function ControlPagesMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded border px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider transition",
          open ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300" : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10",
        )}
      >
        <Menu className="h-3.5 w-3.5" />
        All pages
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[min(92vw,820px)] max-h-[80vh] overflow-y-auto rounded-lg border border-white/10 bg-[#0a0f1e] p-4 shadow-2xl shadow-black/60">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GROUPS.map((group) => (
              <div key={group.title}>
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{group.title}</div>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.path}>
                      <button
                        onClick={() => { setOpen(false); navigate(item.path); }}
                        className="block w-full rounded px-1.5 py-1.5 text-left transition hover:bg-white/5"
                      >
                        <span className="block text-xs font-medium text-zinc-200">{item.label}</span>
                        <span className="block text-[11px] leading-snug text-zinc-500">{item.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

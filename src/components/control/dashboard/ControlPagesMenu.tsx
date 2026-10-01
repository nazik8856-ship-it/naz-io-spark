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

type MenuItem = { label: string; path: string };
type MenuGroup = { title: string; items: MenuItem[] };

const GROUPS: MenuGroup[] = [
  {
    title: "Decisions",
    items: [
      { label: "Pending decisions", path: "/control-system/pending" },
      { label: "Approvals", path: "/control-system/approvals" },
      { label: "Decision history", path: "/control-system/decision-history" },
      { label: "Live feed", path: "/control-system/live" },
      { label: "Action reversals", path: "/control-system/action-reversals" },
    ],
  },
  {
    title: "Rules & policy",
    items: [
      { label: "Safety rules", path: "/control-system/safety-rules" },
      { label: "Policy", path: "/control-system/policy" },
      { label: "Rule simulator", path: "/control-system/simulator" },
      { label: "Policy templates", path: "/control-system/templates" },
      { label: "Coverage gaps", path: "/control-system/coverage" },
      { label: "Policy as code", path: "/control-system/policy-bundle" },
      { label: "Policy change requests", path: "/control-system/policy-changes" },
      { label: "Agent policy", path: "/control-system/agent-policy" },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { label: "Health", path: "/control-system/health" },
      { label: "Incidents", path: "/control-system/incidents" },
      { label: "Change log", path: "/control-system/changes" },
      { label: "Rule effectiveness", path: "/control-system/rule-effectiveness" },
      { label: "Confidence calibration", path: "/control-system/confidence-calibration" },
      { label: "Verify audit trail", path: "/control-system/audit-verify" },
    ],
  },
  {
    title: "Reports",
    items: [
      { label: "Compliance report", path: "/control-system/compliance" },
      { label: "ROI report", path: "/control-system/roi" },
      { label: "Account data", path: "/control-system/account-data" },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Team", path: "/control-system/team" },
      { label: "Spend & safety", path: "/control-system/spend-safety" },
      { label: "Webhooks", path: "/control-system/webhooks" },
      { label: "API keys", path: "/control-system/api-keys" },
      { label: "API docs", path: "/control-system/api-docs" },
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
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[min(90vw,640px)] rounded-lg border border-white/10 bg-[#0a0f1e] p-4 shadow-2xl shadow-black/60">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {GROUPS.map((group) => (
              <div key={group.title}>
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{group.title}</div>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.path}>
                      <button
                        onClick={() => { setOpen(false); navigate(item.path); }}
                        className="w-full rounded px-1.5 py-1 text-left text-xs text-zinc-300 transition hover:bg-white/5 hover:text-white"
                      >
                        {item.label}
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

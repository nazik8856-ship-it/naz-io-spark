import type { MouseEvent as ReactMouseEvent } from "react";
import { forgetChoices } from "@/lib/inner-projects";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, FolderKanban, LogOut, type MessageSquare, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isFirstVisit } from "@/lib/welcome";
import { useProjectList } from "@/hooks/useProjectList";
import { projectStatus, sourceBadge, type ProjectItem } from "@/lib/projects";

/**
 * NAZAI DASHBOARD — MINIMAL V1
 * Two-window Command Center. All legacy Titan V27 logic archived at
 * src/pages/Dashboard.legacy.tsx.archive.
 */

type Card = {
  id: "generator" | "control-system" | "projects";
  label: string;
  title: string;
  description: string;
  /** First-time only: a short badge on the card and one line saying when to choose it. */
  badge: string;
  when: string;
  icon: typeof MessageSquare;
  glow: string; // hex
  route: string;
};

const CARDS: Card[] = [
  {
    id: "generator",
    label: "COMMAND CENTER",
    title: "Generator",
    description:
      "Describe an agent or a website in plain language. NazAI plans it, builds it and connects your tools.",
        badge: "Start here",
    when: "Choose this when you want to create something new.",
    icon: Sparkles,
    glow: "#00f2ff",
    route: "/generator-home",
  },
  {
    id: "control-system",
    label: "CONTROL",
    title: "AI Control System",
    description:
      "See why each AI decision was made, set the rules, and require approval before risky actions run.",
        badge: "Next step",
    when: "Choose this when AI already runs for you and you want to check or limit what it does.",
    icon: ShieldCheck,
    glow: "#a855f7",
    route: "/control-system",
  },
  {
    id: "projects",
    label: "WORKSPACE",
    title: "Projects",
    description: "Your imported and generated projects, under NazAI control. Open one to see its source, rules and tasks.",
    badge: "Your work",
    when: "Choose this to see your projects, or to import one from a link, files, pasted text or Notion.",
    icon: FolderKanban,
    glow: "#d4af37",
    route: "/projects",
  },
];

/** The Projects card's preview: real projects (not a sample), with where each came from; with none yet, where to import one from. */
function ProjectsPreview({ items, loading }: { items: ProjectItem[]; loading: boolean }) {
  if (loading || items.length === 0) {
    return (
      <div className="mt-5 rounded-xl border border-white/10 bg-[#020617]/80 p-3 font-mono text-[12.5px]" data-testid="preview-projects">
        <div className="mb-1.5 flex gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-white/20" /><i className="h-1.5 w-1.5 rounded-full bg-white/20" /><i className="h-1.5 w-1.5 rounded-full bg-white/20" /></div>
        {loading ? (
          <p className="py-1.5 text-slate-500" data-testid="preview-projects-loading">Loading your projects…</p>
        ) : (
          <>
            {["Link", "Files", "Pasted text", "Notion"].map((from) => (
              <div key={from} className="flex items-center justify-between border-t border-white/[0.06] py-1.5 text-slate-400 first-of-type:border-t-0" data-testid="preview-import-source">
                <span className="truncate pr-2">Import from {from === "Files" || from === "Pasted text" ? from.toLowerCase() : `a ${from === "Link" ? "link" : "Notion page"}`}</span>
                <span className="shrink-0 rounded-full border border-dashed border-amber-300/50 px-2 py-px text-[10.5px] text-amber-200/80">+</span>
              </div>
            ))}
            <span className="mt-2 inline-block rounded-full border border-amber-400/40 bg-amber-400/15 px-2.5 py-0.5 text-[11px] text-amber-200" data-testid="preview-projects-status">
              ● No projects yet · import your first
            </span>
          </>
        )}
      </div>
    );
  }
  const attention = items.filter((i) => projectStatus(i.imported ?? null).tone === "warn").length;
  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-[#020617]/80 p-3 font-mono text-[12.5px]" data-testid="preview-projects">
      <div className="mb-1.5 flex gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-white/20" /><i className="h-1.5 w-1.5 rounded-full bg-white/20" /><i className="h-1.5 w-1.5 rounded-full bg-white/20" /></div>
      {items.slice(0, 3).map((i) => {
        const b = sourceBadge(i.imported ?? null);
        const tone = b.tone === "linked" ? "text-cyan-300" : b.tone === "snapshot" ? "text-zinc-300" : "text-purple-300";
        return (
          <div key={i.key} className="flex items-center justify-between border-t border-white/[0.06] py-1.5 text-slate-300 first-of-type:border-t-0" data-testid="preview-project">
            <span className="truncate pr-2">{i.name}</span>
            <span className={`shrink-0 rounded-full border border-current px-2 py-px text-[10.5px] ${tone}`}>{b.tone === "linked" ? "Linked" : b.label}</span>
          </div>
        );
      })}
      <span className={`mt-2 inline-block rounded-full border px-2.5 py-0.5 text-[11px] ${attention ? "border-amber-400/40 bg-amber-400/15 text-amber-200" : "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"}`} data-testid="preview-projects-status">
        ● {items.length} project{items.length === 1 ? "" : "s"} · {attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : "all under control"}
      </span>
    </div>
  );
}

/** Small illustrations of what is behind each card. Sample content only; the caption says so. */
function GeneratorPreview() {
  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-[#020617]/80 p-3 font-mono text-[12.5px]" data-testid="preview-generator" aria-hidden>
      <div className="mb-2.5 flex gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-white/20" /><i className="h-1.5 w-1.5 rounded-full bg-white/20" /><i className="h-1.5 w-1.5 rounded-full bg-white/20" /></div>
      <div className="text-slate-300">› <span className="welcome-type">Build an agent for booking emails</span><span className="welcome-caret ml-0.5 inline-block h-3.5 w-[7px] bg-[#00f2ff] align-[-2px]" /></div>
      <span className="welcome-ready mt-2.5 inline-block rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2.5 py-0.5 text-[11px] text-emerald-300">● Agent ready · 3 tools connected</span>
    </div>
  );
}

function ControlPreview() {
  const rows: Array<[string, string, string]> = [
    ["Send order confirmation", "Allow", "text-emerald-300"],
    ["Refund over $500", "Approval", "text-amber-300"],
    ["Share customer list", "Block", "text-rose-300"],
  ];
  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-[#020617]/80 p-3 font-mono text-[12.5px]" data-testid="preview-control" aria-hidden>
      <div className="mb-1.5 flex gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-white/20" /><i className="h-1.5 w-1.5 rounded-full bg-white/20" /><i className="h-1.5 w-1.5 rounded-full bg-white/20" /></div>
      {rows.map(([what, verdict, tone]) => (
        <div key={what} className="flex items-center justify-between border-t border-white/[0.06] py-1.5 text-slate-300 first-of-type:border-t-0">
          <span className="truncate pr-2">{what}</span>
          <span className={`shrink-0 rounded-full border border-current px-2 py-px text-[10.5px] ${tone}`}>{verdict}</span>
        </div>
      ))}
    </div>
  );
}

/** The card's edge light follows the cursor, and the card leans a few degrees toward it. */
function follow(e: ReactMouseEvent<HTMLButtonElement>) {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
  el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  el.style.transform = `translateY(-4px) perspective(900px) rotateX(${((0.5 - y) * 4).toFixed(2)}deg) rotateY(${((x - 0.5) * 5).toFixed(2)}deg)`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstVisit = isFirstVisit(user);
  // Projects is always the third card: with no project yet it opens on the import.
  const projectList = useProjectList();

  // Choosing an interface ends the first visit; the marker lives on the account so it holds on every device.
  const choose = (route: string) => {
    // Opening Inner Control from here starts from the project the person spends the most time on, not from an earlier pick.
    if (route === "/control-system") forgetChoices();
    if (firstVisit) void supabase.auth.updateUser({ data: { welcome_seen: true } }).catch(() => undefined);
    navigate(route);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{ backgroundColor: "#020617" }}
    >
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/5">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          aria-label="Back to landing"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-mono uppercase tracking-wider">Back</span>
        </button>

        <div className="text-xs font-mono text-zinc-500 hidden sm:block">
          {user?.email}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/account")}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-white/30 transition-colors text-sm"
            aria-label="Account settings"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-white/30 transition-colors text-sm"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="relative px-4 sm:px-6 py-10 md:py-14 max-w-7xl mx-auto">
        {/* grid and drifting colour behind everything */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage: "linear-gradient(rgba(125,211,252,1) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,1) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
              maskImage: "radial-gradient(ellipse at 50% 45%, #000 20%, transparent 75%)",
              WebkitMaskImage: "radial-gradient(ellipse at 50% 45%, #000 20%, transparent 75%)",
            }}
          />
          <div className="welcome-drift-a absolute left-[8%] top-32 h-[26rem] w-[26rem] rounded-full bg-cyan-500/20 blur-[120px]" />
          <div className="welcome-drift-b absolute right-[6%] top-40 h-[26rem] w-[26rem] rounded-full bg-purple-600/20 blur-[120px]" />
          <div className="welcome-drift-a absolute right-[-4%] top-[28rem] h-[22rem] w-[22rem] rounded-full bg-amber-400/10 blur-[120px]" />
          <div className="absolute bottom-[-10rem] left-1/3 h-80 w-[26rem] rounded-full bg-blue-600/15 blur-[120px]" />
        </div>

        <div className="relative mb-9 md:mb-12 text-center">
          <h1 className="welcome-in text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
            Welcome to <span className="text-[#00f2ff]" style={{ textShadow: "0 0 30px rgba(0,242,255,0.45)" }}>NazAI</span>
          </h1>
          <p className="welcome-in mx-auto mt-3 max-w-xl text-zinc-300 text-sm sm:text-base leading-relaxed" style={{ animationDelay: "0.12s" }} data-testid="welcome-subtitle">
            Build AI agents with the Generator, review or restrict what they do with the AI Control System, and keep your projects under control in Projects.
          </p>
          <p className="welcome-in mt-2 text-zinc-500 text-xs font-mono uppercase tracking-[0.2em]" style={{ animationDelay: "0.2s" }}>Choose your interface</p>
        </div>

        <div className="relative mx-auto max-w-6xl">
          {/* Three cards: one line through all three with a node on each, and the chip saying what connects them. */}
          <div className="pointer-events-none relative mb-5 hidden h-8 md:block" aria-hidden data-testid="welcome-link-3">
            <div className="absolute left-[16.6%] right-[16.6%] top-1/2 h-px bg-gradient-to-r from-[#00f2ff]/50 via-[#a855f7]/50 to-[#d4af37]/60" />
            {["16.6%", "50%", "83.4%"].map((x, i) => (
              <span key={x} className="welcome-pulse absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: x, backgroundColor: ["#00f2ff", "#a855f7", "#d4af37"][i], boxShadow: `0 0 10px ${["#00f2ff", "#a855f7", "#d4af37"][i]}` }} />
            ))}
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-sky-300/40 bg-[#04101f] px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-sky-300 shadow-[0_0_24px_rgba(56,189,248,0.3)]">Build → Control → Projects</span>
          </div>
          <div className="relative grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-8 lg:gap-10">
            {CARDS.map((c, idx) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
                  onClick={() => choose(c.route)}
                  data-testid={`card-${c.id}`}
                  className="welcome-in group relative text-left rounded-2xl p-6 md:p-7 border transition-[box-shadow,border-color,transform] duration-300 flex flex-col h-full min-h-[240px] md:min-h-[400px] overflow-hidden focus-visible:outline-none focus-visible:ring-2"
                  style={{
                    background: `linear-gradient(160deg, ${c.glow}14 0%, transparent 55%), #020617`,
                    borderColor: `${c.glow}55`,
                    boxShadow: `0 0 18px ${c.glow}22, inset 0 0 0 1px ${c.glow}22`,
                    animationDelay: `${0.3 + idx * 0.15}s`,
                    ["--tw-ring-color" as string]: c.glow,
                  }}
                  onMouseMove={follow}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = `0 0 40px ${c.glow}66, inset 0 0 0 1px ${c.glow}88`;
                    e.currentTarget.style.borderColor = c.glow;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = `0 0 18px ${c.glow}22, inset 0 0 0 1px ${c.glow}22`;
                    e.currentTarget.style.borderColor = `${c.glow}55`;
                    e.currentTarget.style.transform = "";
                  }}
                >
                  {/* cursor light */}
                  <span
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: `radial-gradient(260px circle at var(--mx, 50%) var(--my, 20%), ${c.glow}2e, transparent 70%)` }}
                    aria-hidden
                  />
                  <div className="relative flex min-h-[24px] items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em]" style={{ color: c.glow }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.glow, boxShadow: `0 0 10px ${c.glow}` }} />
                      {c.label}
                    </div>
                    {firstVisit && (
                      <span
                        className="rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider"
                        style={{ borderColor: `${c.glow}88`, color: c.glow, backgroundColor: `${c.glow}14` }}
                        data-testid="first-time-badge"
                      >
                        {c.badge}
                      </span>
                    )}
                  </div>

                  <div
                    className="relative h-12 w-12 rounded-xl flex items-center justify-center border mb-4 transition-transform duration-300 group-hover:scale-105"
                    style={{ borderColor: `${c.glow}66`, backgroundColor: `${c.glow}14`, boxShadow: `0 0 20px ${c.glow}30` }}
                  >
                    <Icon className="h-6 w-6" style={{ color: c.glow }} />
                  </div>

                  <h2 className="relative text-2xl md:text-[28px] font-bold mb-2">{c.title}</h2>
                  <p className="relative text-zinc-300 text-sm md:text-[14.5px] leading-relaxed">{c.description}</p>

                  <div className="relative">{c.id === "generator" ? <GeneratorPreview /> : c.id === "projects" ? <ProjectsPreview items={projectList.items} loading={projectList.loading} /> : <ControlPreview />}</div>

                  <div className="relative mt-auto pt-5">
                    {firstVisit && (
                      <p className="mb-3 border-t border-white/10 pt-3 text-xs leading-snug text-zinc-400" data-testid="first-time-when">
                        {c.when}
                      </p>
                    )}
                    <span className="flex items-center gap-1.5 text-sm font-semibold transition-all duration-300 group-hover:gap-2.5" style={{ color: c.glow }}>
                      Open <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <p className="relative mt-8 text-center text-[11px] text-slate-600" data-testid="welcome-illustration-note">
          The Generator and Control previews are illustrations with sample content; Projects shows your real projects.
        </p>
      </main>
    </div>
  );
}

// Digital-Employee panel rendered beneath the generated dashboard in AgentCockpit.
// Shows: Business Sync, Schedule, Approvals queue, Clarifications inbox, Memory.
import { useCallback, useEffect, useState } from "react";
import { Brain, CalendarClock, CheckCircle2, MessageCircleQuestion, ShieldCheck, XCircle, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type AgentRow = {
  id: string;
  role: string | null;
  schedule_cron: string | null;
  schedule_label: string | null;
  next_run_at: string | null;
  business_profile_id: string | null;
  autonomy: string | null;
};
type BusinessProfile = {
  company_name: string | null;
  one_liner: string | null;
  industry: string | null;
  tone: string | null;
  audience: string | null;
  offers: unknown;
  source_url: string | null;
};
type MemoryRow = { id: string; key: string; value: string; source: string; created_at: string };
type EventRow = { id: string; run_id: string; kind: string; payload: Record<string, unknown>; created_at: string };

const SCHEDULE_PRESETS: { label: string; cron: string }[] = [
  { label: "Every 10 min", cron: "*/10 * * * *" },
  { label: "Every hour", cron: "0 */1 * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Daily 07:00 UTC", cron: "0 7 * * *" },
  { label: "Daily 09:00 UTC", cron: "0 9 * * *" },
  { label: "Weekly Mon 08:00", cron: "0 8 * * 1" },
];

export default function AgentEmployeePanel({ agentId, events }: { agentId: string; events: EventRow[] }) {
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [memory, setMemory] = useState<MemoryRow[]>([]);

  const load = useCallback(async () => {
    const { data: a } = await supabase
      .from("agents")
      .select("id, role, schedule_cron, schedule_label, next_run_at, business_profile_id, autonomy")
      .eq("id", agentId).maybeSingle();
    setAgent(a as AgentRow | null);
    if (a?.business_profile_id) {
      const { data: p } = await supabase
        .from("business_profiles")
        .select("company_name, one_liner, industry, tone, audience, offers, source_url")
        .eq("id", a.business_profile_id).maybeSingle();
      setProfile(p as BusinessProfile | null);
    }
    const { data: m } = await supabase
      .from("agent_memory").select("id, key, value, source, created_at")
      .eq("agent_id", agentId).order("created_at", { ascending: false }).limit(30);
    setMemory((m as MemoryRow[]) || []);
  }, [agentId]);

  useEffect(() => { load(); const iv = setInterval(load, 12000); return () => clearInterval(iv); }, [load]);

  // Derive pending approvals and unresolved clarifications from event stream
  const approvals = events.filter((e) => e.kind === "pending_approval").filter((e) => {
    const after = events.find((x) => x.created_at > e.created_at && (x.kind === "approval_granted" || x.kind === "approval_rejected") && (x.payload as { ref?: string })?.ref === e.id);
    return !after;
  }).slice(-6);

  const clarifications = (() => {
    const reqs = events.filter((e) => e.kind === "clarification_request");
    return reqs.filter((e) => !events.some((x) => x.created_at > e.created_at && x.kind === "clarification_answer" && (x.payload as { ref?: string })?.ref === e.id)).slice(-3);
  })();

  const answerClarification = async (eventId: string, answer: string) => {
    if (!answer.trim()) return;
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const ev = events.find((e) => e.id === eventId);
    if (!ev || !userId) return;
    const { error } = await supabase.from("agent_events").insert({
      agent_id: agentId, user_id: userId, run_id: ev.run_id,
      kind: "clarification_answer", payload: { ref: eventId, answer },
    } as never);
    if (error) { toast.error(error.message); return; }
    await supabase.from("agent_memory").insert({
      agent_id: agentId, user_id: userId,
      key: `operator.answer.${Date.now()}`, value: answer.slice(0, 600), source: "operator",
    } as never);
    toast.success("Answer sent — agent will resume.");
    void supabase.functions.invoke("agent-runtime", { body: { agentId, trigger: "manual", userInstruction: `Operator answered: ${answer}` } });
  };

  const respondApproval = async (eventId: string, granted: boolean) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const ev = events.find((e) => e.id === eventId);
    if (!ev || !userId) return;
    const { error } = await supabase.from("agent_events").insert({
      agent_id: agentId, user_id: userId, run_id: ev.run_id,
      kind: granted ? "approval_granted" : "approval_rejected",
      payload: { ref: eventId },
    } as never);
    if (error) { toast.error(error.message); return; }
    toast.success(granted ? "Approved — agent will execute on next run." : "Rejected.");
    if (granted) {
      void supabase.functions.invoke("agent-runtime", { body: { agentId, trigger: "manual", userInstruction: `Operator approved action: ${JSON.stringify(ev.payload).slice(0, 400)}` } });
    }
  };


  const respondApproval = async (eventId: string, granted: boolean) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const ev = events.find((e) => e.id === eventId);
    const { error } = await supabase.from("agent_events").insert({
      agent_id: agentId,
      user_id: userId,
      run_id: (ev?.payload as { runId?: string })?.runId ??
        (events.slice().reverse().find((e) => e.kind === "run_started")?.id),
      kind: granted ? "approval_granted" : "approval_rejected",
      payload: { ref: eventId },
    } as never);
    if (error) { toast.error(error.message); return; }
    toast.success(granted ? "Approved — agent will execute on next run." : "Rejected.");
    if (granted) {
      void supabase.functions.invoke("agent-runtime", { body: { agentId, trigger: "manual", userInstruction: `Operator approved action: ${JSON.stringify(ev?.payload || {}).slice(0, 400)}` } });
    }
  };

  const setSchedule = async (cron: string, label: string) => {
    const next = computeNext(cron);
    const { error } = await supabase.from("agents").update({
      schedule_cron: cron, schedule_label: label, next_run_at: next,
    }).eq("id", agentId);
    if (error) { toast.error(error.message); return; }
    toast.success(`Schedule set: ${label}`);
    load();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      {/* Business Sync */}
      <Card title="Business Sync" icon={<ShieldCheck className="h-4 w-4" />}>
        {profile ? (
          <div className="space-y-1.5 text-xs text-zinc-300">
            <div className="text-sm font-semibold text-white">{profile.company_name}</div>
            <div className="text-zinc-400">{profile.one_liner}</div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {profile.industry && <Tag>{profile.industry}</Tag>}
              {profile.tone && <Tag>tone: {profile.tone}</Tag>}
              {profile.source_url && <Tag>{profile.source_url.replace(/^https?:\/\//, "").slice(0, 32)}</Tag>}
            </div>
            <div className="text-zinc-500 mt-1">audience: {profile.audience}</div>
          </div>
        ) : (
          <div className="text-xs text-zinc-500">No business profile attached. Add a URL in the next agent prompt and NazAI will auto-sync.</div>
        )}
      </Card>

      {/* Schedule */}
      <Card title="Schedule" icon={<CalendarClock className="h-4 w-4" />}>
        <div className="text-xs text-zinc-400 mb-2">
          Current: <span className="text-emerald-300 font-mono">{agent?.schedule_label || agent?.schedule_cron || "manual"}</span>
          {agent?.next_run_at && (<span className="ml-2 text-zinc-500">· next {new Date(agent.next_run_at).toLocaleString()}</span>)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SCHEDULE_PRESETS.map((p) => (
            <button key={p.cron} onClick={() => setSchedule(p.cron, p.label)}
              className={`px-2 py-1 text-[10px] rounded border ${agent?.schedule_cron === p.cron ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:text-white hover:border-white/30"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Approvals queue */}
      <Card title={`Approvals · ${approvals.length}`} icon={<CheckCircle2 className="h-4 w-4" />}>
        {approvals.length === 0 ? (
          <div className="text-xs text-zinc-500">No pending approvals. Agent will queue external actions here.</div>
        ) : (
          <div className="space-y-2">
            {approvals.map((e) => {
              const p = e.payload as { action?: string; payload?: unknown; risk?: string };
              return (
                <div key={e.id} className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-amber-200 truncate">{p.action}</div>
                      <div className="text-[10px] text-zinc-500 font-mono uppercase">risk: {p.risk || "med"}</div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => respondApproval(e.id, true)} className="px-2 py-1 text-[10px] rounded bg-emerald-400 text-black font-bold hover:opacity-90">Approve</button>
                      <button onClick={() => respondApproval(e.id, false)} className="px-2 py-1 text-[10px] rounded border border-white/15 text-zinc-300 hover:text-white"><XCircle className="h-3 w-3" /></button>
                    </div>
                  </div>
                  <pre className="mt-1.5 text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap max-h-24">
                    {JSON.stringify(p.payload, null, 2).slice(0, 600)}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Clarifications inbox */}
      <Card title={`Clarifications · ${clarifications.length}`} icon={<MessageCircleQuestion className="h-4 w-4" />}>
        {clarifications.length === 0 ? (
          <div className="text-xs text-zinc-500">Agent will only ask here when essential info is missing.</div>
        ) : (
          <div className="space-y-3">
            {clarifications.map((e) => <ClarificationItem key={e.id} ev={e} onAnswer={answerClarification} />)}
          </div>
        )}
      </Card>

      {/* Memory */}
      <Card title={`Memory · ${memory.length}`} icon={<Brain className="h-4 w-4" />} wide>
        {memory.length === 0 ? (
          <div className="text-xs text-zinc-500">No facts yet. The agent will remember things as it works.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1 custom-scroll">
            {memory.map((m) => (
              <div key={m.id} className="rounded-md border border-white/10 bg-white/[0.02] p-2">
                <div className="text-[10px] font-mono text-cyan-300/80 truncate">{m.key}</div>
                <div className="text-xs text-zinc-200 break-words">{m.value}</div>
                <div className="text-[9px] text-zinc-500 mt-0.5 uppercase">{m.source}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ClarificationItem({ ev, onAnswer }: { ev: EventRow; onAnswer: (id: string, answer: string) => void }) {
  const p = ev.payload as { question?: string; options?: string[] };
  const [val, setVal] = useState("");
  return (
    <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] p-2.5">
      <div className="text-xs text-cyan-100">{p.question}</div>
      {p.options && p.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {p.options.map((o, i) => (
            <button key={i} onClick={() => onAnswer(ev.id, o)} className="px-2 py-1 text-[10px] rounded border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20">{o}</button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 mt-2">
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="or type your answer"
          className="flex-1 px-2 py-1 text-xs rounded border border-white/10 bg-black/30 text-white focus:outline-none focus:border-cyan-400/60" />
        <button onClick={() => { onAnswer(ev.id, val); setVal(""); }} className="p-1.5 rounded bg-cyan-400 text-black hover:opacity-90"><Send className="h-3 w-3" /></button>
      </div>
    </div>
  );
}

function Card({ title, icon, children, wide = false }: { title: string; icon: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`relative rounded-2xl border border-white/10 bg-white/[0.02] p-4 backdrop-blur-xl ${wide ? "md:col-span-2" : ""}`}
      style={{ boxShadow: "0 20px 60px -40px rgba(34, 211, 238, 0.25) inset" }}>
      <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider font-mono text-zinc-400">
        <span className="text-cyan-300">{icon}</span>{title}
      </div>
      {children}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-white/10 bg-white/[0.04] text-zinc-300">{children}</span>;
}

function computeNext(cron: string): string {
  const now = new Date();
  let m = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m) { now.setMinutes(now.getMinutes() + parseInt(m[1], 10)); return now.toISOString(); }
  m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m) { const n = new Date(now); n.setUTCHours(parseInt(m[2], 10), parseInt(m[1], 10), 0, 0); if (n <= now) n.setUTCDate(n.getUTCDate() + 1); return n.toISOString(); }
  m = cron.match(/^(\d+)\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (m) { now.setHours(now.getHours() + parseInt(m[2], 10)); return now.toISOString(); }
  m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+(\d+)$/);
  if (m) { const n = new Date(now); n.setUTCHours(parseInt(m[2], 10), parseInt(m[1], 10), 0, 0); const dow = parseInt(m[3], 10) % 7; const d = (dow - n.getUTCDay() + 7) % 7; n.setUTCDate(n.getUTCDate() + (d === 0 && n <= now ? 7 : d)); return n.toISOString(); }
  now.setHours(now.getHours() + 1); return now.toISOString();
}

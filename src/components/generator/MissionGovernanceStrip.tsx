// Blueprint task #6: the mission-intake box is the one place a client
// actually types what they want built -- before this, nothing there ever
// said the three pillars (Generator / Inner Control / Outer Control) are
// one system. A client could generate an agent or a page with zero idea
// whether any rule governs it until they stumbled into the separate
// Control System pages afterward. This surfaces that fact right at the
// point of intake: what's already enforced, and that it applies to
// whatever gets generated next AND to any external AI the account connects.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function MissionGovernanceStrip({ userId }: { userId: string | undefined }) {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<{ hard: number; safety: number } | null>(null);

  useEffect(() => {
    if (!userId) { setCounts(null); return; }
    let cancelled = false;
    (async () => {
      const [{ count: hard }, { count: safety }] = await Promise.all([
        supabase.from("hard_rules").select("id", { count: "exact", head: true })
          .eq("user_id", userId).is("agent_id", null).eq("enabled", true),
        supabase.from("safety_rules").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("enabled", true),
      ]);
      if (!cancelled) setCounts({ hard: hard ?? 0, safety: safety ?? 0 });
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!userId || !counts) return null;

  const total = counts.hard + counts.safety;
  const active = total > 0;

  return (
    <button
      type="button"
      onClick={() => navigate("/control-system")}
      title={active
        ? "These rules govern every agent and page you generate, and any external AI you connect -- click to review them"
        : "Set hard rules and safety rules so generation, your agents, and any connected external AI are all governed the same way"}
      className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors hover:opacity-80 ${
        active
          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
    >
      {active ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
      {active
        ? `Governed by ${counts.hard} hard rule${counts.hard === 1 ? "" : "s"} · ${counts.safety} safety rule${counts.safety === 1 ? "" : "s"} — applies here, to every agent, and to any connected external AI`
        : "No rules set yet — generation, agents, and connected AI run unrestricted. Set one in Control System"}
    </button>
  );
}

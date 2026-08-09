import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldAlert, Power } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

const REVEAL_CODE = "killswitch";
const REVEAL_KEY = "nazai_ks_reveal";

/**
 * GLOBAL KILL SWITCH (hidden operator control).
 * Not visible or reachable for normal users: it only renders after the
 * operator types the reveal code, or loads the page with ?ops=killswitch.
 * Flips are logged to agent_decisions (source: kill_switch_flip) with the
 * acting user's id.
 */
export default function KillSwitchPanel() {
  const { user } = useAuth();
  const [revealed, setRevealed] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const buffer = useRef("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ops") === REVEAL_CODE) {
      sessionStorage.setItem(REVEAL_KEY, "1");
    }
    if (sessionStorage.getItem(REVEAL_KEY) === "1") setRevealed(true);

    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return;
      buffer.current = (buffer.current + e.key.toLowerCase()).slice(-REVEAL_CODE.length);
      if (buffer.current === REVEAL_CODE) {
        sessionStorage.setItem(REVEAL_KEY, "1");
        setRevealed(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Owner-only gate: verified against the user_roles table (RLS-protected),
  // and enforced again at the database level by the kill-switch trigger.
  useEffect(() => {
    if (!user) { setIsOwner(false); return; }
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "owner")
      .maybeSingle()
      .then(({ data }) => setIsOwner(Boolean(data)));
  }, [user]);

  useEffect(() => {
    if (!revealed || !user || !isOwner) return;
    supabase
      .from("profiles")
      .select("kill_switch")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setOn(Boolean((data as { kill_switch?: boolean } | null)?.kill_switch)));
  }, [revealed, user]);

  const toggle = useCallback(async () => {
    if (!user || busy || !isOwner) return;
    const next = !on;
    setBusy(true);
    try {
      const { error } = await supabase.from("profiles").update({ kill_switch: next }).eq("id", user.id);
      if (error) throw error;
      setOn(next);
      const { data: logged } = await supabase.from("agent_decisions").insert({
        user_id: user.id,
        decision: next ? "block" : "allow",
        reasoning: `Kill switch turned ${next ? "ON" : "OFF"} by ${user.email ?? user.id}`,
        alternatives_considered: [],
        confidence_score: 100,
        source: "kill_switch_flip",
        escalated: false,
      }).select("id").maybeSingle();

      // Real-time alert (Slack if connected, prominent server log otherwise).
      supabase.functions.invoke("control-engine", {
        body: {
          alert_event: "kill_switch_flip",
          enabled: next,
          decision_id: (logged as { id?: string } | null)?.id ?? null,
          actor: user.email ?? user.id,
        },
      }).catch(() => { /* alerting must never block the flip */ });

      toast({
        title: next ? "Kill switch ON" : "Kill switch OFF",
        description: next
          ? "Every Control System action is now blocked immediately."
          : "Normal decision flow restored.",
      });
    } catch (e) {
      toast({ title: "Could not change kill switch", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [busy, on, user, isOwner]);

  if (!revealed || !user || !isOwner) return null;

  return (
    <div
      className="mx-6 mb-3 flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{
        borderColor: on ? "#ef444488" : "#ffffff14",
        backgroundColor: on ? "#ef44440f" : "#ffffff06",
      }}
    >
      <ShieldAlert className="h-4 w-4" style={{ color: on ? "#ef4444" : "#71717a" }} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-mono uppercase tracking-wider" style={{ color: on ? "#ef4444" : "#a1a1aa" }}>
          Global kill switch {on ? "active" : "off"}
        </p>
        <p className="text-[11px] text-zinc-500 truncate">
          {on ? "All control-engine calls return blocked instantly." : "Decisions run normally."}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={busy}
        aria-label="Toggle global kill switch"
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
        style={{
          borderColor: on ? "#ef444488" : "#22c55e55",
          color: on ? "#ef4444" : "#22c55e",
        }}
      >
        <Power className="h-3.5 w-3.5" />
        {on ? "Disable" : "Activate"}
      </button>
    </div>
  );
}

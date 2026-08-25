import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldAlert, Power, Radiation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// platform_settings (2026-08-27) isn't in the generated Supabase types yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

const REVEAL_CODE = "killswitch";
const REVEAL_KEY = "nazai_ks_reveal";

/**
 * ACCOUNT KILL SWITCH + PLATFORM KILL SWITCH (hidden operator controls).
 * Not visible or reachable for normal users: it only renders after the
 * operator types the reveal code, or loads the page with ?ops=killswitch.
 * The account switch flips profiles.kill_switch for the acting platform
 * owner's OWN account only -- previously mislabeled "global" here, which
 * was actively misleading now that a REAL platform-wide switch exists
 * below it (platform_settings, checked by control-gate.ts before every
 * other layer, for every account). Flips of either are logged to
 * agent_decisions (source: kill_switch_flip / platform_kill_switch_flip)
 * with the acting user's id.
 */
export default function KillSwitchPanel() {
  const { user } = useAuth();
  const [revealed, setRevealed] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [platformOn, setPlatformOn] = useState(false);
  const [platformBusy, setPlatformBusy] = useState(false);
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

  // Broader than the account switch's isOwner gate above (admin OR owner,
  // matching platform_settings' own RLS write policy and
  // OpsPlatformIncidents.tsx's check) -- more people should be able to
  // respond to a genuine platform-wide incident than can flip their own
  // single account's switch.
  useEffect(() => {
    if (!user) { setIsPlatformAdmin(false); return; }
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "owner"])
      .maybeSingle()
      .then(({ data }) => setIsPlatformAdmin(Boolean(data)));
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

  useEffect(() => {
    if (!revealed || !user || !isPlatformAdmin) return;
    anyDb
      .from("platform_settings")
      .select("kill_switch")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }: { data: unknown }) => setPlatformOn(Boolean((data as { kill_switch?: boolean } | null)?.kill_switch)));
  }, [revealed, user, isPlatformAdmin]);

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
          ? "Every Control System action on this account is now blocked immediately."
          : "Normal decision flow restored for this account.",
      });
    } catch (e) {
      toast({ title: "Could not change kill switch", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [busy, on, user, isOwner]);

  const togglePlatform = useCallback(async () => {
    if (!user || platformBusy || !isPlatformAdmin) return;
    const next = !platformOn;
    setPlatformBusy(true);
    try {
      const { error } = await anyDb.from("platform_settings").update({
        kill_switch: next,
        kill_switch_reason: next ? `Paused by ${user.email ?? user.id}` : null,
        kill_switch_updated_at: new Date().toISOString(),
        kill_switch_updated_by: user.id,
      }).eq("id", 1);
      if (error) throw error;
      setPlatformOn(next);
      // Attributed to the acting admin's own account, same as the
      // account-level flip above -- there's no single "platform account"
      // to attach an audit row to, and this at least makes the flip
      // traceable to who did it and when, even though this event affects
      // every account, not just theirs.
      await anyDb.from("agent_decisions").insert({
        user_id: user.id,
        decision: next ? "block" : "allow",
        reasoning: `PLATFORM kill switch turned ${next ? "ON" : "OFF"} by ${user.email ?? user.id} -- affects every account, not just this one.`,
        alternatives_considered: [],
        confidence_score: 100,
        source: "platform_kill_switch_flip",
        escalated: true,
      });
      toast({
        title: next ? "PLATFORM kill switch ON" : "Platform kill switch OFF",
        description: next
          ? "Every account's decision-gating is now blocked, platform-wide, until this is turned off."
          : "Normal decision flow restored for every account.",
      });
    } catch (e) {
      toast({ title: "Could not change the platform kill switch", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPlatformBusy(false);
    }
  }, [platformBusy, platformOn, user, isPlatformAdmin]);

  if (!revealed || !user || (!isOwner && !isPlatformAdmin)) return null;

  return (
    <div className="mx-6 mb-3 space-y-2">
      {isOwner && (
        <div
          className="flex items-center gap-3 rounded-xl border px-4 py-3"
          style={{
            borderColor: on ? "#ef444488" : "#ffffff14",
            backgroundColor: on ? "#ef44440f" : "#ffffff06",
          }}
        >
          <ShieldAlert className="h-4 w-4" style={{ color: on ? "#ef4444" : "#71717a" }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-mono uppercase tracking-wider" style={{ color: on ? "#ef4444" : "#a1a1aa" }}>
              This account's kill switch {on ? "active" : "off"}
            </p>
            <p className="text-[11px] text-zinc-500 truncate">
              {on ? "Every action on THIS account returns blocked instantly." : "Decisions on this account run normally."}
            </p>
          </div>
          <button
            onClick={toggle}
            disabled={busy}
            aria-label="Toggle this account's kill switch"
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
      )}

      {isPlatformAdmin && (
        <div
          className="flex items-center gap-3 rounded-xl border px-4 py-3"
          style={{
            borderColor: platformOn ? "#ef444488" : "#a855f755",
            backgroundColor: platformOn ? "#ef44440f" : "#a855f70f",
          }}
        >
          <Radiation className="h-4 w-4" style={{ color: platformOn ? "#ef4444" : "#a855f7" }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-mono uppercase tracking-wider" style={{ color: platformOn ? "#ef4444" : "#a855f7" }}>
              Platform-wide kill switch {platformOn ? "active" : "off"}
            </p>
            <p className="text-[11px] text-zinc-500 truncate">
              {platformOn
                ? "EVERY account is blocked right now, not just this one -- a genuine platform-wide incident stop."
                : "For a genuine platform-wide incident only -- blocks every account at once, until cleared."}
            </p>
          </div>
          <button
            onClick={togglePlatform}
            disabled={platformBusy}
            aria-label="Toggle the platform-wide kill switch"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{
              borderColor: platformOn ? "#ef444488" : "#a855f755",
              color: platformOn ? "#ef4444" : "#a855f7",
            }}
          >
            <Power className="h-3.5 w-3.5" />
            {platformOn ? "Disable" : "Activate"}
          </button>
        </div>
      )}
    </div>
  );
}

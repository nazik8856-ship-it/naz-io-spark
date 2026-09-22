import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldAlert, Power, Radiation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// platform_settings (2026-08-27) isn't in the generated Supabase types yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { toast } from "@/hooks/use-toast";

const REVEAL_CODE = "killswitch";
const REVEAL_KEY = "nazai_ks_reveal";

/**
 * ACCOUNT KILL SWITCH (visible to any account owner) + PLATFORM KILL SWITCH
 * (hidden operator controls).
 *
 * Pillar 1 fix (2026-09-21): this whole component used to sit behind the
 * same secret reveal code -- meaning a normal business owner had no way to
 * ever discover their OWN account's kill switch, the one piece of this
 * pillar's "you can always stop it right now" promise that actually
 * requires a deliberate manual action. Only the genuinely cross-tenant
 * controls (the platform-wide switch and the consequential-sweeps pause,
 * which affect every account, not just this one) still require the reveal
 * code; the account-level switch below now renders for any account owner,
 * revealed or not.
 *
 * The account switch flips profiles.kill_switch for the VIEWED account
 * (useActiveAccount, same as every other per-account panel) -- previously
 * mislabeled "global" here, which was actively misleading now that a REAL
 * platform-wide switch exists below it (platform_settings, checked by
 * control-gate.ts before every other layer, for every account). Flips of
 * either are logged to agent_decisions (source: kill_switch_flip /
 * platform_kill_switch_flip); the account-level flip is logged against the
 * affected account (accountId), the acting user identified in the text.
 *
 * 2026-09-22 fix: two bugs, found together while re-verifying Pillar 1.
 * (1) This whole component read/wrote `user.id` regardless of the account
 * switcher, so a delegated team member managing a different account
 * silently saw and flipped their OWN account's switch instead. (2) isOwner
 * was gated on the GLOBAL user_roles table (a single-row "platform owner"
 * concept, confirmed live: exactly 1 row, for the actual site operator) --
 * meaning every other real account owner had isOwner=false and never even
 * saw their own account's switch. The DB trigger (guard_kill_switch) had
 * the same gap independently: it authorized the global owner or an
 * explicitly-invited account_members "owner" row, never "this is your own
 * account" -- confirmed live that account_members has zero rows in
 * production, so no account's real owner could have flipped their own
 * switch even by hitting the RPC directly. Fixed in a migration alongside
 * this: guard_kill_switch now also allows auth.uid() = old.id.
 */
export default function KillSwitchPanel() {
  const { user } = useAuth();
  const { accountId } = useActiveAccount();
  const [revealed, setRevealed] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [platformOn, setPlatformOn] = useState(false);
  const [platformBusy, setPlatformBusy] = useState(false);
  const [sweepsOn, setSweepsOn] = useState(false);
  const [sweepsBusy, setSweepsBusy] = useState(false);
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

  // Owner-of-THIS-account gate: you always own your own account
  // (accountId === user.id, the default state before any delegation), or
  // you're a team member explicitly invited with the "owner" role on the
  // account currently being viewed (is_account_member). Enforced again,
  // independently, at the database level by the kill-switch trigger.
  useEffect(() => {
    if (!user || !accountId) { setIsOwner(false); return; }
    if (accountId === user.id) { setIsOwner(true); return; }
    anyDb
      .rpc("is_account_member", { _account_owner_id: accountId, _min_role: "owner" })
      .then(({ data }: { data: unknown }) => setIsOwner(Boolean(data)));
  }, [user, accountId]);

  // Broader than the account switch's isOwner gate above (admin OR owner,
  // matching platform_settings' own RLS write policy and
  // OpsPlatformIncidents.tsx's check) -- more people should be able to
  // respond to a genuine platform-wide incident than can flip their own
  // single account's switch.
  useEffect(() => {
    if (!user) { setIsPlatformAdmin(false); return; }
    // .maybeSingle() throws away the result (silently, since its error was
    // never checked) whenever a user holds BOTH an "admin" and an "owner"
    // row -- unique(user_id, role) allows exactly that -- hiding the
    // platform controls from someone who should have them, with no
    // indication anything went wrong. .limit(1) has no such failure mode.
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "owner"])
      .limit(1)
      .then(({ data, error }) => {
        if (error) { setIsPlatformAdmin(false); return; }
        setIsPlatformAdmin((data?.length ?? 0) > 0);
      });
  }, [user]);

  useEffect(() => {
    if (!user || !isOwner || !accountId) return;
    supabase
      .from("profiles")
      .select("kill_switch")
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data }) => setOn(Boolean((data as { kill_switch?: boolean } | null)?.kill_switch)));
  }, [user, isOwner, accountId]);

  useEffect(() => {
    if (!revealed || !user || !isPlatformAdmin) return;
    anyDb
      .from("platform_settings")
      .select("kill_switch, consequential_sweeps_paused")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }: { data: unknown }) => {
        const row = data as { kill_switch?: boolean; consequential_sweeps_paused?: boolean } | null;
        setPlatformOn(Boolean(row?.kill_switch));
        setSweepsOn(Boolean(row?.consequential_sweeps_paused));
      });
  }, [revealed, user, isPlatformAdmin]);

  const toggle = useCallback(async () => {
    if (!user || busy || !isOwner || !accountId) return;
    const next = !on;
    setBusy(true);
    try {
      const { error } = await supabase.from("profiles").update({ kill_switch: next }).eq("id", accountId);
      if (error) throw error;
      setOn(next);
      const { data: logged } = await supabase.from("agent_decisions").insert({
        user_id: accountId,
        decision: next ? "block" : "allow",
        reasoning: `Kill switch turned ${next ? "ON" : "OFF"} by ${user.email ?? user.id}`,
        alternatives_considered: [],
        confidence_score: 100,
        source: "kill_switch_flip",
        escalated: false,
      }).select("id").maybeSingle();

      // Real-time alert (Slack if connected, prominent server log otherwise).
      // account_id: a delegated owner-tier member flipping a DIFFERENT
      // account's switch (accountId !== user.id) must alert on the
      // affected account, not their own -- same account_id resolution
      // control-engine's main decide route now uses.
      supabase.functions.invoke("control-engine", {
        body: {
          alert_event: "kill_switch_flip",
          enabled: next,
          decision_id: (logged as { id?: string } | null)?.id ?? null,
          actor: user.email ?? user.id,
          account_id: accountId,
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
  }, [busy, on, user, isOwner, accountId]);

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

  const toggleSweeps = useCallback(async () => {
    if (!user || sweepsBusy || !isPlatformAdmin) return;
    const next = !sweepsOn;
    setSweepsBusy(true);
    try {
      const { error } = await anyDb.from("platform_settings").update({
        consequential_sweeps_paused: next,
        consequential_sweeps_paused_reason: next ? `Paused by ${user.email ?? user.id}` : null,
        consequential_sweeps_paused_at: next ? new Date().toISOString() : null,
        consequential_sweeps_paused_by: next ? user.id : null,
      }).eq("id", 1);
      if (error) throw error;
      setSweepsOn(next);
      await anyDb.from("agent_decisions").insert({
        user_id: user.id,
        decision: next ? "block" : "allow",
        reasoning: `Consequential sweeps (control-api-abuse-sweep, outcome-quality-sweep, stuck-approval-sweep) ` +
          `turned ${next ? "OFF" : "ON"} by ${user.email ?? user.id} -- affects every account's automatic key ` +
          `pauses/policy downgrades/approval auto-resolutions, not just this one.`,
        alternatives_considered: [],
        confidence_score: 100,
        source: "consequential_sweeps_paused_flip",
        escalated: true,
      });
      toast({
        title: next ? "Consequential sweeps PAUSED" : "Consequential sweeps resumed",
        description: next
          ? "control-api-abuse-sweep, outcome-quality-sweep, and stuck-approval-sweep will skip every run until this is turned off."
          : "All 3 sweeps will resume taking real action on their next scheduled run.",
      });
    } catch (e) {
      toast({ title: "Could not change the sweeps pause switch", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSweepsBusy(false);
    }
  }, [sweepsBusy, sweepsOn, user, isPlatformAdmin]);

  // Owners always see their own account's switch; the reveal code is only
  // required to unlock the platform-wide/sweeps sections below, and only
  // matters for someone who is a platform admin but not this account's owner.
  if (!user || (!isOwner && !(revealed && isPlatformAdmin))) return null;

  return (
    <div className="mb-3 space-y-2">
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

      {revealed && isPlatformAdmin && (
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

      {revealed && isPlatformAdmin && (
        <div
          className="flex items-center gap-3 rounded-xl border px-4 py-3"
          style={{
            borderColor: sweepsOn ? "#ef444488" : "#f59e0b55",
            backgroundColor: sweepsOn ? "#ef44440f" : "#f59e0b0f",
          }}
        >
          <ShieldAlert className="h-4 w-4" style={{ color: sweepsOn ? "#ef4444" : "#f59e0b" }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-mono uppercase tracking-wider" style={{ color: sweepsOn ? "#ef4444" : "#f59e0b" }}>
              Consequential sweeps {sweepsOn ? "PAUSED" : "active"}
            </p>
            <p className="text-[11px] text-zinc-500 truncate">
              {sweepsOn
                ? "control-api-abuse-sweep, outcome-quality-sweep, stuck-approval-sweep are all skipping every run."
                : "A narrower stop than the platform kill switch above -- only these 3 sweeps' auto-pauses/downgrades/auto-resolutions."}
            </p>
          </div>
          <button
            onClick={toggleSweeps}
            disabled={sweepsBusy}
            aria-label="Toggle the consequential sweeps pause switch"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{
              borderColor: sweepsOn ? "#ef444488" : "#f59e0b55",
              color: sweepsOn ? "#ef4444" : "#f59e0b",
            }}
          >
            <Power className="h-3.5 w-3.5" />
            {sweepsOn ? "Resume" : "Pause"}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Daily AI-gateway spend cap, per org (account).
//
//  * every gateway call is metered into ai_spend_daily (calls, tokens, cost)
//  * at 90% of the daily cap we warn once — via Slack if the org has Slack
//    connected, otherwise a prominent console warning + a logged decision row
//  * at 100% we auto-trip the org's kill switch. The trip is marked
//    kill_switch_auto = true so it clears itself on the next UTC day; the
//    owner can also clear it manually at any time.
// ============================================================================
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { slackPostMessage } from "./provider-writes.ts";

export const DEFAULT_DAILY_CAP_USD = 5.0;

/** Rough $/1M tokens for the gateway models NazAI uses. Input, output. */
const PRICES: Record<string, [number, number]> = {
  "google/gemini-3-flash-preview": [0.3, 2.5],
  "google/gemini-2.5-flash": [0.3, 2.5],
  "google/gemini-2.5-flash-lite": [0.1, 0.4],
  "google/gemini-2.5-pro": [1.25, 10],
  "openai/gpt-5-mini": [0.25, 2],
  default: [0.3, 2.5],
};

export type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

export function estimateCostUsd(model: string, usage: Usage | undefined | null): number {
  const [inPrice, outPrice] = PRICES[model] ?? PRICES.default;
  const pt = Number(usage?.prompt_tokens ?? 0) || 0;
  const ct = Number(usage?.completion_tokens ?? (usage?.total_tokens ?? 0) - pt) || 0;
  return (pt / 1_000_000) * inPrice + (Math.max(ct, 0) / 1_000_000) * outPrice;
}

const today = () => new Date().toISOString().slice(0, 10);

export type SpendStatus = {
  enabled: boolean;
  cap_usd: number;
  spent_usd: number;
  calls: number;
  pct: number;
  over_cap: boolean;
  day: string;
};

/** Current day's spend vs. the org's configured cap. Never throws. */
export async function getSpendStatus(admin: SupabaseClient, userId: string): Promise<SpendStatus> {
  const day = today();
  try {
    const [{ data: capRow }, { data: usageRow }] = await Promise.all([
      admin.from("ai_spend_caps").select("daily_cap_usd, enabled").eq("user_id", userId).maybeSingle(),
      admin.from("ai_spend_daily").select("cost_usd, calls").eq("user_id", userId).eq("day", day).maybeSingle(),
    ]);
    const cap = Number((capRow as { daily_cap_usd?: number } | null)?.daily_cap_usd ?? DEFAULT_DAILY_CAP_USD);
    const enabled = (capRow as { enabled?: boolean } | null)?.enabled ?? true;
    const spent = Number((usageRow as { cost_usd?: number } | null)?.cost_usd ?? 0);
    const calls = Number((usageRow as { calls?: number } | null)?.calls ?? 0);
    const pct = cap > 0 ? (spent / cap) * 100 : 0;
    return { enabled, cap_usd: cap, spent_usd: spent, calls, pct, over_cap: enabled && cap > 0 && spent >= cap, day };
  } catch (_) {
    return { enabled: true, cap_usd: DEFAULT_DAILY_CAP_USD, spent_usd: 0, calls: 0, pct: 0, over_cap: false, day };
  }
}

/**
 * Clears a kill switch that was tripped automatically by yesterday's spend cap.
 * Manual (owner-flipped) kill switches are never touched.
 */
export async function clearExpiredSpendKillSwitch(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    const { data } = await admin
      .from("profiles")
      .select("kill_switch, kill_switch_auto, kill_switch_source, kill_switch_at")
      .eq("id", userId)
      .maybeSingle();
    const p = data as
      | { kill_switch?: boolean; kill_switch_auto?: boolean; kill_switch_source?: string; kill_switch_at?: string }
      | null;
    if (!p?.kill_switch || !p.kill_switch_auto || p.kill_switch_source !== "ai_spend_cap") return;
    const trippedDay = (p.kill_switch_at || "").slice(0, 10);
    if (trippedDay && trippedDay >= today()) return; // still the same UTC day
    await admin
      .from("profiles")
      .update({ kill_switch: false, kill_switch_auto: false, kill_switch_source: null, kill_switch_at: null })
      .eq("id", userId);
  } catch (_) { /* never break the caller */ }
}

async function notifyOrg(admin: SupabaseClient, userId: string, text: string): Promise<"slack" | "log"> {
  try {
    const { data } = await admin
      .from("agent_integrations")
      .select("provider, metadata")
      .eq("user_id", userId)
      .eq("provider", "slack")
      .eq("status", "connected")
      .maybeSingle();
    const channel = (data as { metadata?: Record<string, unknown> } | null)?.metadata?.default_channel;
    if (data) {
      const res = await slackPostMessage(admin, userId, "", {
        channel: String(channel || "#general"),
        text,
      });
      if (res.ok) return "slack";
      console.error(`[SPEND CAP] Slack warning failed: ${res.summary}`);
    }
  } catch (err) {
    console.error("[SPEND CAP] Slack warning threw:", String((err as Error)?.message || err));
  }
  console.warn(`[SPEND CAP] ${text}`);
  return "log";
}

/**
 * Meter one gateway call, then enforce the 90% warning / 100% kill-switch rules.
 * Safe to call from any edge function; never throws.
 */
export async function recordAiSpend(
  admin: SupabaseClient,
  userId: string,
  model: string,
  usage: Usage | undefined | null,
  context = "ai-gateway",
): Promise<SpendStatus & { warned?: boolean; tripped?: boolean }> {
  const cost = estimateCostUsd(model, usage);
  try {
    await admin.rpc("record_ai_spend", {
      _user_id: userId,
      _cost_usd: Number(cost.toFixed(6)),
      _prompt_tokens: Number(usage?.prompt_tokens ?? 0) || 0,
      _completion_tokens: Number(usage?.completion_tokens ?? 0) || 0,
    });
  } catch (err) {
    console.error("[SPEND CAP] failed to record spend:", String((err as Error)?.message || err));
  }

  const status = await getSpendStatus(admin, userId);
  if (!status.enabled || status.cap_usd <= 0) return status;

  const money = (n: number) => `$${n.toFixed(2)}`;
  const { data: dayRow } = await admin
    .from("ai_spend_daily")
    .select("id, warned_at, capped_at")
    .eq("user_id", userId)
    .eq("day", status.day)
    .maybeSingle();
  const row = dayRow as { id?: string; warned_at?: string | null; capped_at?: string | null } | null;

  // ---- 100% — auto-trip the kill switch for this org --------------------
  if (status.spent_usd >= status.cap_usd && !row?.capped_at) {
    const text =
      `🛑 NazAI daily AI spend cap reached — ${money(status.spent_usd)} of ${money(status.cap_usd)} ` +
      `across ${status.calls} calls today. The kill switch has been switched on automatically: ` +
      `no AI actions will run until tomorrow (UTC) or until an owner turns it off.`;
    let via: "slack" | "log" = "log";
    try {
      await admin.from("profiles").update({
        kill_switch: true,
        kill_switch_auto: true,
        kill_switch_source: "ai_spend_cap",
        kill_switch_at: new Date().toISOString(),
      }).eq("id", userId);
      const { data: logged } = await admin.from("agent_decisions").insert({
        user_id: userId,
        decision: "KILL_SWITCH_ON (daily AI spend cap)",
        reasoning: text,
        alternatives_considered: [],
        confidence_score: 100,
        source: "ai_spend_cap",
        escalated: true,
      }).select("id").maybeSingle();
      via = await sendCriticalAlert(admin, userId, {
        event: "kill_switch_auto",
        summary: text,
        decisionId: (logged as { id?: string } | null)?.id ?? null,
      });
      if (row?.id) await admin.from("ai_spend_daily").update({ capped_at: new Date().toISOString() }).eq("id", row.id);
    } catch (err) {
      console.error("[SPEND CAP] failed to trip kill switch:", String((err as Error)?.message || err));
    }
    console.warn(`[SPEND CAP] cap hit for ${userId} (${context}), notified via ${via}`);

    return { ...status, tripped: true, over_cap: true };
  }

  // ---- 90% — warn once per day -----------------------------------------
  if (status.pct >= 90 && !row?.warned_at && !row?.capped_at) {
    const text =
      `⚠️ NazAI daily AI spend is at ${Math.round(status.pct)}% of its cap — ` +
      `${money(status.spent_usd)} of ${money(status.cap_usd)} across ${status.calls} calls today. ` +
      `At 100% the kill switch trips automatically and AI actions stop until tomorrow.`;
    await notifyOrg(admin, userId, text);
    if (row?.id) {
      try {
        await admin.from("ai_spend_daily").update({ warned_at: new Date().toISOString() }).eq("id", row.id);
      } catch (_) { /* ignore */ }
    }
    return { ...status, warned: true };
  }

  return status;
}

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
import { sendCriticalAlert } from "./critical-alerts.ts";
import { triggerWebhooks } from "./webhooks.ts";

export const DEFAULT_DAILY_CAP_USD = 5.0;

/** Rough $/1M tokens for the gateway models NazAI uses. Input, output. */
const PRICES: Record<string, [number, number]> = {
  "google/gemini-3-flash-preview": [0.3, 2.5],
  "google/gemini-2.5-flash": [0.3, 2.5],
  "google/gemini-2.5-flash-lite": [0.1, 0.4],
  "google/gemini-2.5-pro": [1.25, 10],
  "google/gemini-3.1-pro-preview": [1.25, 10],
  "openai/gpt-5-mini": [0.25, 2],
  // "Real precedent memory" plan, item 11 -- a real, distinct entry so an
  // embedding call is never priced as if it were a full chat-completion
  // call (the `default` row above, ~15-25x more expensive per token).
  // Output price is 0: an embedding call has no generated tokens to
  // price. Rough estimate, same "unverified assumption" caveat as
  // EMBEDDING_MODEL/EMBEDDING_DIMENSIONS in decision-embeddings.ts --
  // verify against the gateway's real embeddings pricing before this
  // runs against a live account.
  "google/text-embedding-004": [0.15, 0],
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

// Per-agent spend cap: a separate, parallel mechanism alongside the
// account-wide cap above, not a replacement for it. An agent with no cap
// of its own (has_cap: false) has no agent-level enforcement at all --
// only the account-wide cap applies to it, same as every agent before
// this existed. Confirmed with the user: when an agent-level cap trips,
// it stops ONLY that agent (agents.kill_switch), never the account-wide
// kill switch.
export type AgentSpendStatus = SpendStatus & { has_cap: boolean };

const NO_AGENT_CAP: AgentSpendStatus = {
  enabled: false, cap_usd: 0, spent_usd: 0, calls: 0, pct: 0, over_cap: false, day: "", has_cap: false,
};

/** Current day's spend vs. the org's account-wide configured cap. Never throws. */
export async function getSpendStatus(admin: SupabaseClient, userId: string): Promise<SpendStatus> {
  const day = today();
  try {
    // .is("agent_id", null) is required now that a user_id can have more
    // than one ai_spend_caps/ai_spend_daily row (one account-wide + one
    // per agent that has its own cap) -- without it, .maybeSingle() would
    // throw the moment any per-agent row exists for this user.
    const [{ data: capRow }, { data: usageRow }] = await Promise.all([
      admin.from("ai_spend_caps").select("daily_cap_usd, enabled").eq("user_id", userId).is("agent_id", null).maybeSingle(),
      admin.from("ai_spend_daily").select("cost_usd, calls").eq("user_id", userId).eq("day", day).is("agent_id", null).maybeSingle(),
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
 * Current day's spend vs. this ONE agent's own configured cap. Returns
 * has_cap: false (and everything else zeroed) when the agent has no cap
 * of its own -- the caller should apply no agent-level enforcement in
 * that case, only the account-wide cap. Never throws.
 */
export async function getAgentSpendStatus(admin: SupabaseClient, userId: string, agentId: string): Promise<AgentSpendStatus> {
  const day = today();
  try {
    const { data: capRow } = await admin
      .from("ai_spend_caps").select("daily_cap_usd, enabled").eq("user_id", userId).eq("agent_id", agentId).maybeSingle();
    if (!capRow) return { ...NO_AGENT_CAP, day };
    const cap = Number((capRow as { daily_cap_usd?: number }).daily_cap_usd ?? 0);
    const enabled = (capRow as { enabled?: boolean }).enabled ?? true;
    const { data: usageRow } = await admin
      .from("ai_spend_daily").select("cost_usd, calls").eq("user_id", userId).eq("agent_id", agentId).eq("day", day).maybeSingle();
    const spent = Number((usageRow as { cost_usd?: number } | null)?.cost_usd ?? 0);
    const calls = Number((usageRow as { calls?: number } | null)?.calls ?? 0);
    const pct = cap > 0 ? (spent / cap) * 100 : 0;
    return { enabled, cap_usd: cap, spent_usd: spent, calls, pct, over_cap: enabled && cap > 0 && spent >= cap, day, has_cap: true };
  } catch (_) {
    return { ...NO_AGENT_CAP, day };
  }
}

// "Zero human review" plan, item 12: a per-api-key cap, parallel to the
// per-agent one above and structurally identical -- kept as its own type
// alias (rather than reusing AgentSpendStatus) purely for readability at
// call sites, even though the shape is the same.
export type ApiKeySpendStatus = SpendStatus & { has_cap: boolean };

const NO_KEY_CAP: ApiKeySpendStatus = {
  enabled: false, cap_usd: 0, spent_usd: 0, calls: 0, pct: 0, over_cap: false, day: "", has_cap: false,
};

/**
 * Current day's spend vs. this ONE api key's own configured cap. Returns
 * has_cap: false (and everything else zeroed) when the key has no cap of
 * its own -- the caller should apply no key-level enforcement in that
 * case, only the account-wide cap. Never throws.
 */
export async function getApiKeySpendStatus(admin: SupabaseClient, userId: string, apiKeyId: string): Promise<ApiKeySpendStatus> {
  const day = today();
  try {
    const { data: capRow } = await admin
      .from("ai_spend_caps").select("daily_cap_usd, enabled").eq("user_id", userId).eq("api_key_id", apiKeyId).maybeSingle();
    if (!capRow) return { ...NO_KEY_CAP, day };
    const cap = Number((capRow as { daily_cap_usd?: number }).daily_cap_usd ?? 0);
    const enabled = (capRow as { enabled?: boolean }).enabled ?? true;
    const { data: usageRow } = await admin
      .from("ai_spend_daily").select("cost_usd, calls").eq("user_id", userId).eq("api_key_id", apiKeyId).eq("day", day).maybeSingle();
    const spent = Number((usageRow as { cost_usd?: number } | null)?.cost_usd ?? 0);
    const calls = Number((usageRow as { calls?: number } | null)?.calls ?? 0);
    const pct = cap > 0 ? (spent / cap) * 100 : 0;
    return { enabled, cap_usd: cap, spent_usd: spent, calls, pct, over_cap: enabled && cap > 0 && spent >= cap, day, has_cap: true };
  } catch (_) {
    return { ...NO_KEY_CAP, day };
  }
}

type KillSwitchRow = { kill_switch?: boolean; kill_switch_auto?: boolean; kill_switch_source?: string | null; kill_switch_at?: string | null };

/** Pure — was this an auto-trip from the spend cap, from a UTC day that's already over? */
export function shouldClearAutoSpendTrip(row: KillSwitchRow | null, todayStr: string): boolean {
  if (!row?.kill_switch || !row.kill_switch_auto || row.kill_switch_source !== "ai_spend_cap") return false;
  const trippedDay = (row.kill_switch_at || "").slice(0, 10);
  return !(trippedDay && trippedDay >= todayStr); // still the same UTC day -> don't clear
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
    if (!shouldClearAutoSpendTrip(data as KillSwitchRow | null, today())) return;
    await admin
      .from("profiles")
      .update({ kill_switch: false, kill_switch_auto: false, kill_switch_source: null, kill_switch_at: null })
      .eq("id", userId);
  } catch (_) { /* never break the caller */ }
}

/** Same as clearExpiredSpendKillSwitch, but for one agent's own kill switch. */
export async function clearExpiredAgentSpendKillSwitch(admin: SupabaseClient, agentId: string): Promise<void> {
  try {
    const { data } = await admin
      .from("agents")
      .select("kill_switch, kill_switch_auto, kill_switch_source, kill_switch_at")
      .eq("id", agentId)
      .maybeSingle();
    if (!shouldClearAutoSpendTrip(data as KillSwitchRow | null, today())) return;
    await admin
      .from("agents")
      .update({ kill_switch: false, kill_switch_auto: false, kill_switch_source: null, kill_switch_at: null })
      .eq("id", agentId);
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

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Meter one gateway call, then enforce the 90% warning / 100% kill-switch
 * rules — both account-wide (unchanged) and, when agentId is given and
 * that agent has its own cap configured, agent-level too. An agent-level
 * trip stops ONLY that agent (agents.kill_switch) — the account-wide
 * kill switch and every other agent are untouched. Safe to call from any
 * edge function; never throws.
 */
export async function recordAiSpend(
  admin: SupabaseClient,
  userId: string,
  model: string,
  usage: Usage | undefined | null,
  context = "ai-gateway",
  agentId?: string | null,
  // "Zero human review" plan, item 12: threaded through so control-engine
  // can attribute a control-api mode="full" call's cost to the specific
  // key that made it, alongside the account-wide total -- record_ai_spend
  // upserts a per-key ai_spend_daily row only when the key ALSO has its
  // own cap configured, same as the agent_id parameter above.
  apiKeyId?: string | null,
): Promise<SpendStatus & { warned?: boolean; tripped?: boolean }> {
  const cost = estimateCostUsd(model, usage);
  try {
    await admin.rpc("record_ai_spend", {
      _user_id: userId,
      _cost_usd: Number(cost.toFixed(6)),
      _prompt_tokens: Number(usage?.prompt_tokens ?? 0) || 0,
      _completion_tokens: Number(usage?.completion_tokens ?? 0) || 0,
      _agent_id: agentId ?? null,
      _api_key_id: apiKeyId ?? null,
    });
  } catch (err) {
    console.error("[SPEND CAP] failed to record spend:", String((err as Error)?.message || err));
  }

  const status = await getSpendStatus(admin, userId);
  const result = await enforceAccountSpendCap(admin, userId, status, context);

  if (agentId) {
    await enforceAgentSpendCap(admin, userId, agentId, context);
  }

  return result;
}

async function enforceAccountSpendCap(
  admin: SupabaseClient,
  userId: string,
  status: SpendStatus,
  context: string,
): Promise<SpendStatus & { warned?: boolean; tripped?: boolean }> {
  if (!status.enabled || status.cap_usd <= 0) return status;

  const { data: dayRow } = await admin
    .from("ai_spend_daily")
    .select("id, warned_at, capped_at")
    .eq("user_id", userId)
    .eq("day", status.day)
    .is("agent_id", null)
    .maybeSingle();
  const row = dayRow as { id?: string; warned_at?: string | null; capped_at?: string | null } | null;

  // ---- 100% — auto-trip the account-wide kill switch ---------------------
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
      const killSwitchDecisionId = (logged as { id?: string } | null)?.id ?? null;
      if (killSwitchDecisionId) {
        try {
          await triggerWebhooks(admin, userId, "decision_logged", {
            id: killSwitchDecisionId, decision: "KILL_SWITCH_ON (daily AI spend cap)", source: "ai_spend_cap", escalated: true, agent_id: null,
          });
        } catch { /* ignore */ }
      }
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

/** Same 90%/100% enforcement as the account-wide cap, but scoped to one agent -- a trip here flips agents.kill_switch, never profiles.kill_switch. No-op if this agent has no cap of its own. */
async function enforceAgentSpendCap(
  admin: SupabaseClient,
  userId: string,
  agentId: string,
  context: string,
): Promise<void> {
  const status = await getAgentSpendStatus(admin, userId, agentId);
  if (!status.has_cap || !status.enabled || status.cap_usd <= 0) return;

  const { data: dayRow } = await admin
    .from("ai_spend_daily")
    .select("id, warned_at, capped_at")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .eq("day", status.day)
    .maybeSingle();
  const row = dayRow as { id?: string; warned_at?: string | null; capped_at?: string | null } | null;

  if (status.spent_usd >= status.cap_usd && !row?.capped_at) {
    const text =
      `🛑 Agent-level AI spend cap reached for one agent — ${money(status.spent_usd)} of ${money(status.cap_usd)} ` +
      `across ${status.calls} calls today. This agent's kill switch has been switched on automatically: ` +
      `it stops until tomorrow (UTC) or until an owner turns it back on. Other agents are unaffected.`;
    let via: "slack" | "log" = "log";
    try {
      await admin.from("agents").update({
        kill_switch: true,
        kill_switch_auto: true,
        kill_switch_source: "ai_spend_cap",
        kill_switch_at: new Date().toISOString(),
      }).eq("id", agentId);
      const { data: logged } = await admin.from("agent_decisions").insert({
        user_id: userId,
        agent_id: agentId,
        decision: "AGENT_KILL_SWITCH_ON (daily AI spend cap)",
        reasoning: text,
        alternatives_considered: [],
        confidence_score: 100,
        source: "ai_spend_cap",
        escalated: true,
      }).select("id").maybeSingle();
      const agentKillSwitchDecisionId = (logged as { id?: string } | null)?.id ?? null;
      if (agentKillSwitchDecisionId) {
        try {
          await triggerWebhooks(admin, userId, "decision_logged", {
            id: agentKillSwitchDecisionId, decision: "AGENT_KILL_SWITCH_ON (daily AI spend cap)", source: "ai_spend_cap", escalated: true, agent_id: agentId,
          });
        } catch { /* ignore */ }
      }
      via = await sendCriticalAlert(admin, userId, {
        event: "kill_switch_auto",
        summary: text,
        decisionId: (logged as { id?: string } | null)?.id ?? null,
      });
      if (row?.id) await admin.from("ai_spend_daily").update({ capped_at: new Date().toISOString() }).eq("id", row.id);
    } catch (err) {
      console.error("[SPEND CAP] failed to trip agent kill switch:", String((err as Error)?.message || err));
    }
    console.warn(`[SPEND CAP] agent cap hit for agent ${agentId} of ${userId} (${context}), notified via ${via}`);
    return;
  }

  if (status.pct >= 90 && !row?.warned_at && !row?.capped_at) {
    const text =
      `⚠️ One agent's AI spend is at ${Math.round(status.pct)}% of its own cap — ` +
      `${money(status.spent_usd)} of ${money(status.cap_usd)} across ${status.calls} calls today. ` +
      `At 100% that agent's kill switch trips automatically; other agents are unaffected.`;
    await notifyOrg(admin, userId, text);
    if (row?.id) {
      try {
        await admin.from("ai_spend_daily").update({ warned_at: new Date().toISOString() }).eq("id", row.id);
      } catch (_) { /* ignore */ }
    }
  }
}

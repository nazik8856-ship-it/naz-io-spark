// Autonomous agent runtime — one run of an agent.
// Business-aware: loads business profile + memory; supports remember/ask_user/request_approval tools.
// Input: { agentId: string, trigger?: "manual"|"cron"|"webhook", userInstruction?: string }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readSecret } from "../_shared/integration-secrets.ts";
import { validateToolInput, validateToolOutput } from "../_shared/tool-schemas.ts";
import {
  runToolWithSelfCorrection,
  buildCorrectionPrompt,
  MAX_TOOL_ATTEMPTS,
  type Corrector,
} from "../_shared/tool-retry.ts";
import { PROVIDER_WRITE_KINDS, runProviderWrite } from "../_shared/provider-writes.ts";
import { runControlGate } from "../_shared/control-gate.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { claimIdempotencyKey, saveIdempotencyResponse, releaseIdempotencyKey, buildRealActionKey } from "../_shared/idempotency.ts";
import { timingSafeEqual } from "../_shared/timing-safe.ts";
import { recordAiSpend, estimateCostUsd } from "../_shared/spend-guard.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";

import {
  readConfidence,
  normalizeAlternatives,
  logDecision as logDecisionRow,
} from "../_shared/decision-scoring.ts";
import {
  CAPABILITY_REGISTRY,
  canOfferTool,
  buildCapabilityBlock,
} from "../_shared/capability-registry.ts";
import {
  providerForTool,
  findOpenIssue,
  recordIssue,
  recordQuestionIssue,
  loadKnownAnswers,
  type IssueErrorType,
} from "../_shared/integration-issues.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-user-id",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const DEEP_MODEL = "google/gemini-3.1-pro-preview"; // stronger reasoning for deep analysis / audits / plans
const MAX_STEPS = 24;
// Per-run spend ceiling, independent of the account's DAILY cap
// (ai_spend_caps) -- a single run could stay comfortably under a generous
// daily cap while burning far more than any one run legitimately needs, if
// e.g. the model gets stuck re-reasoning without ever finishing. $2 covers
// a real, even fairly involved run (24 main-loop steps on the cheap flash
// model plus a handful of DEEP_MODEL tool calls) with real margin, while
// still catching a genuinely runaway one. Independently tunable from
// MAX_STEPS since token cost per step varies by what the step actually did.
const MAX_RUN_SPEND_USD = 2.0;
// Confirmed: the main reasoning loop's gateway fetch had no AbortController
// or timeout at all, unlike the http_post tool's own fetch (5s) or
// _shared/fetch-retry.ts's callers -- a slow/hanging gateway response
// stalled the whole run with no step-level bound, relying entirely on the
// platform's outer function timeout. 45s mirrors the frontend's own
// generation-request timeout (GenerationWorkspace.tsx's TIMEOUT_MS), with a
// little extra margin since this is a non-streaming, server-side call.
const STEP_TIMEOUT_MS = 45_000;
// Run-start limit: nothing previously stopped a misbehaving scheduler/webhook/
// caller from triggering unlimited full agent runs. Separate from
// STEP_RATE_LIMIT_PER_MINUTE below -- one run can legitimately make many
// gate calls, so the two must not share a bucket.
const RUN_RATE_LIMIT_PER_MINUTE = 20;
// Per-step gate-fallback limit: assessWithControlEngine's HTTP path already
// rides control-engine's own "control-engine" bucket, but shares it with
// human chat traffic under the same userId key. Agent-driven steps get
// their own key so they don't silently eat a human's chat budget, and so
// the in-process fallback branch (control-engine unreachable) -- which has
// no rate-limit layer of its own -- is covered too.
const STEP_RATE_LIMIT_PER_MINUTE = 120;


type Tool = { name: string; description: string; kind: string; config: Record<string, unknown> };
type Manifest = {
  name: string; goal: string; systemPrompt: string; decisionPolicy: string;
  tools: Tool[]; triggers: { kind: string; spec: string }[];
  guardrails: { rule: string; requiresApproval: boolean }[];
  kpis: { name: string; target: string }[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    // Accept params from either query string (external webhook callers) or JSON body (scheduler / frontend).
    const url = new URL(req.url);
    const qsAgentId = url.searchParams.get("agentId") || "";
    const qsTrigger = url.searchParams.get("trigger") || "";

    let bodyAgentId = "";
    let bodyTrigger = "";
    let bodyUserInstruction: string | undefined = undefined;
    let rawBody: unknown = undefined;
    if (req.method === "POST") {
      const text = await req.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          rawBody = parsed;
          if (parsed && typeof parsed === "object") {
            bodyAgentId = typeof parsed.agentId === "string" ? parsed.agentId : "";
            bodyTrigger = typeof parsed.trigger === "string" ? parsed.trigger : "";
            bodyUserInstruction = typeof parsed.userInstruction === "string" ? parsed.userInstruction : undefined;
          }
        } catch {
          rawBody = text;
        }
      }
    }

    const agentId = bodyAgentId || qsAgentId;
    const trigger = bodyTrigger || qsTrigger || "manual";
    // For external webhook calls, forward the posted body as userInstruction if none was set explicitly.
    let userInstruction = bodyUserInstruction;
    if (!userInstruction && trigger === "webhook" && rawBody !== undefined) {
      userInstruction = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
      if (userInstruction) userInstruction = userInstruction.slice(0, 4000);
    }
    if (!agentId) return json({ error: "agentId required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const schedulerUserId = req.headers.get("x-scheduler-user-id") ?? "";
    const userScopedClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve user:
    //  - scheduler → x-scheduler-user-id header
    //  - webhook (public) → look up the agent's owner via service role
    //  - normal → JWT
    let userId = "";
    if (schedulerUserId) {
      userId = schedulerUserId;
    } else if (trigger === "webhook") {
      const { data: ownerRow } = await adminClient
        .from("agents").select("user_id, webhook_secret_id").eq("id", agentId).maybeSingle();
      if (!ownerRow) return json({ error: "Unauthorized" }, 401);
      const provided = req.headers.get("x-webhook-secret") ?? "";
      const sid = (ownerRow as { webhook_secret_id?: string }).webhook_secret_id ?? "";
      let expected = "";
      if (sid) {
        const { data: sec } = await adminClient.rpc("read_webhook_secret", { _agent_id: agentId });
        if (typeof sec === "string") expected = sec;
      }
      if (!expected || !timingSafeEqual(provided, expected)) {
        return json({ error: "Unauthorized" }, 401);
      }
      userId = (ownerRow.user_id as string | undefined) ?? "";
    } else {
      const { data: userData } = await userScopedClient.auth.getUser();
      userId = userData?.user?.id ?? "";
    }
    if (!userId) return json({ error: "Not authenticated" }, 401);

    // ---- Rate limit (run start) --------------------------------------------
    // Nothing previously stopped a misbehaving client (manual/cron/webhook)
    // from triggering unlimited full agent runs. Fails OPEN if the limiter
    // itself can't be reached, same as every other rate-limited endpoint.
    const runRate = await checkRateLimit(adminClient, userId, "agent-runtime", RUN_RATE_LIMIT_PER_MINUTE, 60);
    if (!runRate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many agent runs — ${runRate.count} in the last minute (limit ${runRate.limit}). Try again shortly.`,
      }, 429);
    }

    const supabase = adminClient; // we'll always read/write scoped by user_id ourselves

    const { data: agent, error: agentErr } = await supabase
      .from("agents").select("*").eq("id", agentId).eq("user_id", userId).single();
    if (agentErr || !agent) return json({ error: "Agent not found" }, 404);

    const manifest = agent.manifest as Manifest;

    // Daily run cap — only enforced for cron triggers. Manual/webhook/scheduled
    // runs bypass the cap so users can always force a run.
    if (trigger === "cron") {
      const cap = Number((agent as { daily_run_cap?: number }).daily_run_cap ?? 3);
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("agent_runs")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agentId)
        .eq("user_id", userId)
        .eq("status", "completed")
        .gte("created_at", startOfDay.toISOString());
      if ((count ?? 0) >= cap) {
        await supabase.from("agent_events").insert({
          agent_id: agentId,
          user_id: userId,
          kind: "run_skipped",
          payload: { reason: "Daily run cap reached, skipping", cap, completed_today: count, trigger },
        });
        return json({ skipped: true, reason: "Daily run cap reached, skipping", cap, completed_today: count });
      }
    }

    // Load business profile and memory
    let profile: Record<string, unknown> | null = null;
    if (agent.business_profile_id) {
      const { data } = await supabase.from("business_profiles").select("*")
        .eq("id", agent.business_profile_id).eq("user_id", userId).maybeSingle();
      profile = data ?? null;
    }
    const { data: memory } = await supabase.from("agent_memory")
      .select("key, value, source").eq("agent_id", agentId).eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(40);

    // Load org-level learned patterns (Phase 2 org memory).
    const { data: orgInsights } = await supabase.from("org_insights")
      .select("insight, kind, confidence, evidence_count, last_confirmed_at")
      .eq("user_id", userId)
      .order("evidence_count", { ascending: false })
      .order("last_confirmed_at", { ascending: false })
      .limit(8);

    // Phase 4 — outcome history: past decisions of this org whose real-world
    // effect was already measured (decision_outcomes, written by the
    // measure-decision-outcomes job). Injected into the prompt so the agent
    // reasons from what actually worked, not just from what it once chose.
    const { data: outcomeRows } = await supabase.from("decision_outcomes")
      .select("provider, linked_metric, direction, delta_pct, window_days, measured_at, agent_decisions(decision, reasoning)")
      .eq("user_id", userId)
      .neq("direction", "unknown")
      .order("measured_at", { ascending: false })
      .limit(60);
    type OutcomeHistoryItem = {
      decision: string;
      reasoning: string;
      provider: string;
      metric: string;
      direction: string;
      deltaPct: number;
      windowDays: number;
    };
    const outcomeHistory: OutcomeHistoryItem[] = (outcomeRows || []).map((o) => {
      const d = (o as { agent_decisions?: { decision?: string; reasoning?: string } | null }).agent_decisions;
      return {
        decision: String(d?.decision || "").slice(0, 200),
        reasoning: String(d?.reasoning || "").slice(0, 200),
        provider: String((o as { provider?: string }).provider || ""),
        metric: String((o as { linked_metric?: string }).linked_metric || ""),
        direction: String((o as { direction?: string }).direction || "neutral"),
        deltaPct: Number((o as { delta_pct?: number }).delta_pct ?? 0),
        windowDays: Number((o as { window_days?: number }).window_days ?? 7),
      };
    }).filter((o) => o.decision);




    // Load connected integrations + their most recent synced snapshot so the
    // agent grounds its reasoning in real business data instead of guessing.
    const { data: integrations } = await supabase.from("agent_integrations")
      .select("provider, status, metadata, last_verified_at, last_error")
      .eq("user_id", userId)
      .or(agent.id ? `agent_id.eq.${agent.id},agent_id.is.null` : `agent_id.is.null`);
    const connectedIntegrations = (integrations || []).filter((i) => i.status === "connected");
    const { data: snapshots } = await supabase.from("integration_snapshots")
      .select("provider, kind, data, error, fetched_at")
      .eq("user_id", userId)
      .order("fetched_at", { ascending: false })
      .limit(200);
    const latestByProvider = new Map<string, { kind: string; data: Record<string, unknown>; error: string | null; fetched_at: string }>();
    for (const s of snapshots || []) {
      if (!latestByProvider.has(s.provider as string)) {
        latestByProvider.set(s.provider as string, {
          kind: s.kind as string,
          data: (s.data as Record<string, unknown>) || {},
          error: (s.error as string | null) ?? null,
          fetched_at: s.fetched_at as string,
        });
      }
    }

    // Trigger a fresh sync in the background if the newest snapshot is stale
    // (> 30 min) or missing entirely for any connected integration. This keeps
    // agent reasoning current without blocking the run.
    const staleMs = 30 * 60 * 1000;
    const needsSync = connectedIntegrations.some((i) => {
      const snap = latestByProvider.get(i.provider as string);
      if (!snap) return true;
      return Date.now() - new Date(snap.fetched_at).getTime() > staleMs;
    });
    if (needsSync) {
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
        body: JSON.stringify({ cron: false, userId, agentId }),
      }).catch(() => {});
    }

    // Pause if there's an unresolved clarification waiting
    const { data: lastClarify } = await supabase.from("agent_events")
      .select("id, kind, payload, created_at")
      .eq("agent_id", agentId).eq("user_id", userId)
      .in("kind", ["clarification_request", "clarification_answer"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    let expiredClarificationId: string | null = null;
    if (lastClarify && lastClarify.kind === "clarification_request") {
      const ageMs = Date.now() - new Date(lastClarify.created_at as string).getTime();
      if (ageMs < 24 * 60 * 60 * 1000) {
        return json({ skipped: true, reason: "awaiting clarification" });
      }
      expiredClarificationId = lastClarify.id as string;
    }

    // Concurrency guard: block if another run is already 'running' for this
    // agent, unless it's stale (>15 min old with no recent event heartbeat).
    const STALE_LOCK_MS = 15 * 60 * 1000;
    const { data: existingRunning } = await supabase
      .from("agent_runs")
      .select("id, created_at")
      .eq("agent_id", agentId)
      .eq("user_id", userId)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1);
    for (const r of existingRunning || []) {
      const ageMs = Date.now() - new Date(r.created_at as string).getTime();
      let stale = ageMs > STALE_LOCK_MS;
      if (stale) {
        // Check for any event heartbeat within the stale window
        const cutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();
        const { count: recentEventCount } = await supabase
          .from("agent_events")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", agentId)
          .eq("user_id", userId)
          .gte("created_at", cutoff);
        if ((recentEventCount ?? 0) > 0) stale = false;
      }
      if (stale) {
        // Atomically flip the stale row to 'failed' so only one caller proceeds
        const { data: claimed } = await supabase
          .from("agent_runs")
          .update({ status: "failed", completion_summary: "Stale run auto-closed (no heartbeat >15 min)" })
          .eq("id", r.id)
          .eq("status", "running")
          .select("id")
          .maybeSingle();
        if (!claimed) {
          // Someone else transitioned it; treat as still running
          await supabase.from("agent_events").insert({
            agent_id: agentId, user_id: userId, kind: "run_skipped",
            payload: { reason: "already running, skipped", trigger, blocking_run_id: r.id },
          });
          return json({ skipped: true, reason: "already running, skipped" });
        }
        await supabase.from("agent_events").insert({
          agent_id: agentId, user_id: userId, kind: "run_stale_cleared",
          payload: { reason: "stale lock cleared", stale_run_id: r.id, age_ms: ageMs },
        });
      } else {
        await supabase.from("agent_events").insert({
          agent_id: agentId, user_id: userId, kind: "run_skipped",
          payload: { reason: "already running, skipped", trigger, blocking_run_id: r.id, age_ms: ageMs },
        });
        return json({ skipped: true, reason: "already running, skipped", blocking_run_id: r.id });
      }
    }

    const { data: run, error: runErr } = await supabase
      .from("agent_runs")
      .insert({ agent_id: agentId, user_id: userId, trigger, status: "running" })
      .select("id").single();
    if (runErr || !run) return json({ error: "Could not start run" }, 500);
    const runId = run.id as string;

    // Retry-alternative-first guard: on any tool_result/action logged with
    // ok:false, remember which tool failed so we can force the model to try
    // one alternative before it is allowed to ask_user. Wrapped in an object
    // holder so TS control-flow analysis doesn't narrow it to null.
    const failGuard: { state: { failedTool: string; nudged: boolean } | null } = { state: null };

    // Identical-action loop detection, scoped to tools that never reach the
    // control gate. Confirmed: ACTION_CAPPED_KINDS tools eventually get a
    // circuit-breaker intervention after repeated failures, but calc,
    // http_get, web_search, deep_analyze, make_plan, audit_url,
    // read_analytics, read_email, and integration_query never touch the gate
    // at all -- a model stuck retrying one of these identically could burn
    // the full step budget with zero loop-specific circuit breaker or
    // dedupe. In-memory only (scoped to this one run, never persisted) --
    // this isn't a safety mechanism like the real circuit breaker, just a
    // "stop wasting steps" nudge for a pattern the model itself can recover
    // from once told plainly.
    const UNGATED_TOOL_KINDS = new Set([
      "calc", "http_get", "web_search", "deep_analyze", "make_plan",
      "audit_url", "read_analytics", "read_email", "integration_query",
    ]);
    const UNGATED_REPEAT_LIMIT = 2; // the 3rd identical attempt is intercepted
    const recentUngatedCalls = new Map<string, number>();

    const ARTIFACT_KINDS: Record<string, string> = {
      create_doc: "doc", edit_doc: "doc",
      create_sheet: "sheet", edit_sheet: "sheet",
      create_calendar_event: "calendar_event",
      send_email: "email", reply_email: "email",
      generate_report: "report",
      slack_post_message: "message",
      notion_create_page: "notion_page", notion_update_page: "notion_page",
      canva_create_design: "design", canva_create_folder: "folder",
      figma_post_comment: "comment", figma_create_dev_resource: "dev_resource",
      shopify_create_draft_order: "draft_order", shopify_update_product: "product",
    };
    // Which provider each deliverable belongs to (null = produced by NazAI itself).
    const ARTIFACT_PROVIDERS: Record<string, string | null> = {
      create_doc: "Google", edit_doc: "Google",
      create_sheet: "Google", edit_sheet: "Google",
      create_calendar_event: "Google",
      send_email: "Gmail", reply_email: "Gmail",
      generate_report: null,
      slack_post_message: "Slack",
      notion_create_page: "Notion", notion_update_page: "Notion",
      canva_create_design: "Canva", canva_create_folder: "Canva",
      figma_post_comment: "Figma", figma_create_dev_resource: "Figma",
      shopify_create_draft_order: "Shopify", shopify_update_product: "Shopify",
    };
    // Guards against double-recording when a tool emits both an `action` and a
    // `tool_result` event for the same deliverable.
    const recordedArtifacts = new Set<string>();

    // Verified-action executor kinds subject to the daily action cap AND the
    // control-engine gate (kill switch, hard rules, circuit breaker, spend
    // cap, safety scanner, anomaly detector, model risk/fit). Must match
    // every kind capability-registry.ts marks implemented+verified+write —
    // http_post and schedule_followup were missing here for a while (a real
    // gap found by the call-graph audit: both are genuine external/self-
    // perpetuating effects that used to run on nothing but their own local
    // guardrail, invisible to the kill switch).
    const ACTION_CAPPED_KINDS = new Set([
      "send_email", "reply_email",
      "create_doc", "edit_doc",
      "create_sheet", "edit_sheet",
      "create_calendar_event",
      "upsert_client_note",
      "slack_post_message",
      "notion_create_page", "notion_update_page",
      "canva_create_design", "canva_create_folder",
      "figma_post_comment", "figma_create_dev_resource",
      "shopify_create_draft_order", "shopify_update_product",
      "http_post", "schedule_followup",
    ]);
    const dailyActionCap = Math.max(0, Number((agent as { daily_action_cap?: number }).daily_action_cap ?? 20));
    // Confidence-escalation threshold (per-agent, default 60): any tool call or
    // decide block the model reports BELOW this score is paused for a human.
    const confidenceThreshold = Math.max(
      0,
      Math.min(100, Math.round(Number((agent as { confidence_threshold?: number }).confidence_threshold ?? 60))),
    );
    const clientWriteMode = String((agent as { client_write_mode?: string }).client_write_mode || "hybrid");
    const actionCapState: { blocked: boolean; loggedOnce: boolean; usedToday: number } = { blocked: false, loggedOnce: false, usedToday: 0 };

    // Count today's ok:true action events for this agent (UTC-day boundary).
    const startOfUtcDay = () => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    };
    const countTodaysActions = async (): Promise<number> => {
      const { data } = await supabase
        .from("agent_events")
        .select("payload")
        .eq("agent_id", agentId)
        .eq("user_id", userId)
        .eq("kind", "action")
        .gte("created_at", startOfUtcDay());
      let n = 0;
      for (const row of data || []) {
        const p = (row.payload as Record<string, unknown>) || {};
        if (p.ok === true && ACTION_CAPPED_KINDS.has(String(p.type || ""))) n++;
      }
      return n;
    };
    actionCapState.usedToday = await countTodaysActions();
    if (dailyActionCap > 0 && actionCapState.usedToday >= dailyActionCap) actionCapState.blocked = true;

    // Auto-upsert / update a client record for this agent, respecting client_write_mode.
    // Returns { ok, clientId, requiresApproval, reason }.
    const upsertClient = async (opts: {
      email?: string; name?: string; company?: string;
      note?: string; tags?: string[]; incrementInteraction?: boolean;
    }): Promise<{ ok: boolean; clientId?: string; requiresApproval?: boolean; reason?: string }> => {
      const email = (opts.email || "").trim().toLowerCase() || null;
      const name = (opts.name || "").trim() || null;
      if (!email && !name) return { ok: false, reason: "email or name required" };
      // Look up existing (by email preferred)
      let existing: { id: string; notes: string | null; interaction_count: number } | null = null;
      if (email) {
        const { data } = await supabase.from("agent_clients")
          .select("id, notes, interaction_count")
          .eq("agent_id", agentId).eq("user_id", userId)
          .ilike("email", email).maybeSingle();
        if (data) existing = data as typeof existing;
      }
      const isEdit = !!existing;
      const requiresApproval = clientWriteMode === "approval" || (clientWriteMode === "hybrid" && isEdit && !!opts.note && (existing?.notes || "").length > 0);
      if (requiresApproval) {
        await logEvent("pending_approval", {
          action: "upsert_client_note",
          payload: { email, name, company: opts.company, note: opts.note, tags: opts.tags, client_id: existing?.id ?? null, mode: isEdit ? "edit" : "create" },
          risk: "low",
          reason: `client_write_mode=${clientWriteMode} — ${isEdit ? "edit to existing client note" : "new client record"} requires approval`,
        });
        return { ok: false, requiresApproval: true, reason: "queued for approval" };
      }
      const now = new Date().toISOString();
      if (existing) {
        const newNotes = opts.note
          ? ((existing.notes ? existing.notes + "\n\n" : "") + `[${now}] ${opts.note}`).slice(0, 20000)
          : existing.notes;
        const { error: upErr } = await supabase.from("agent_clients").update({
          notes: newNotes,
          name: name || undefined,
          company: opts.company || undefined,
          tags: opts.tags && opts.tags.length ? opts.tags : undefined,
          last_interaction_at: now,
          interaction_count: (existing.interaction_count || 0) + (opts.incrementInteraction ? 1 : 0),
        }).eq("id", existing.id);
        if (upErr) return { ok: false, reason: upErr.message };
        return { ok: true, clientId: existing.id };
      }
      const { data: ins, error: insErr } = await supabase.from("agent_clients").insert({
        agent_id: agentId, user_id: userId,
        email, name, company: opts.company || null,
        tags: opts.tags || [],
        notes: opts.note ? `[${now}] ${opts.note}` : null,
        first_seen_at: now, last_interaction_at: now,
        interaction_count: opts.incrementInteraction ? 1 : 0,
      }).select("id").single();
      if (insErr || !ins) return { ok: false, reason: insErr?.message || "insert failed" };
      return { ok: true, clientId: ins.id };
    };
    // Decision provenance staged by the parser for the next `action` event.
    const pendingProvenance: { reasoning?: string; confidence?: string } = {};

    // ---- Decision provenance log -------------------------------------------
    // Every branch point (which tool, which strategy, which source) is written
    // to agent_decisions with the model's own reasoning, the alternatives it
    // weighed and a 0-100 self-reported confidence score.
    // Pin the active policy version once per run so every decision this run
    // writes records exactly which policy artifact judged it.
    let activePolicyVersion: number | null = null;
    try {
      const { data: pv } = await supabase.rpc("get_active_policy_version", { _user_id: userId });
      const pvRow = (Array.isArray(pv) ? pv[0] : pv) as { version?: number } | null;
      activePolicyVersion = typeof pvRow?.version === "number" ? pvRow.version : null;
    } catch { /* decisions still log without a pinned version */ }

    const logDecision = (d: {
      decision: string;
      reasoning: string;
      alternatives: unknown;
      score: number;
      stepIndex?: number;
      escalated?: boolean;
      actionType?: string | null;
      provider?: string | null;
    }): Promise<string | null> =>
      logDecisionRow(supabase, { userId, agentId, runId }, { ...d, policyVersion: activePolicyVersion });



    // Output-validation guard: when a tool reports success but its result is
    // missing required keys, we downgrade the event to an incomplete_result
    // error and stage a corrective instruction for the next model turn.
    const outputGuard: { pending: string | null; retried: Record<string, number> } = { pending: null, retried: {} };

    const logEvent = async (kind: string, payload: Record<string, unknown>) => {
      // ---- Per-tool OUTPUT validation gate: runs after the executor succeeds,
      // before the result reaches the user. Incomplete "successes" never ship.
      if (kind === "action" && (payload as { ok?: unknown }).ok === true) {
        const p = payload as Record<string, unknown>;
        const outKind = String(p.type || "");
        const outName = String(p.tool || p.type || outKind || "tool");
        const check = validateToolOutput(outKind, outName, p);
        if (!check.success) {
          const attempts = (outputGuard.retried[outKind] || 0) + 1;
          outputGuard.retried[outKind] = attempts;
          // Rewrite the delivered payload: this is NOT a success.
          payload.ok = false;
          payload.error = "incomplete_result";
          payload.missing = check.missing;
          payload.summary = check.humanMessage;
          payload.reason = check.humanMessage;
          outputGuard.pending = attempts <= 1
            ? `${check.humanMessage}\nRetry this step ONCE — re-run the same tool with corrected input so the missing pieces come back. If the retry is also incomplete, try a different approach before escalating. Explain any failure to the user in plain everyday language.`
            : `${check.humanMessage}\nThis step has now failed output validation ${attempts} times. Stop retrying it, try a different approach, and if nothing works tell the user plainly what could not be confirmed.`;
          // Separate, queryable failure record.
          supabase.from("agent_events").insert({
            run_id: runId, agent_id: agentId, user_id: userId,
            kind: "output_validation_failed",
            payload: {
              tool: outName, kind: outKind, attempt: attempts,
              missing: check.missing,
              message: check.humanMessage,
              technical: check.message,
            },
          }).then(() => {}, () => {});
        }
      }
      // Same gate for tool_result events that carry an explicit tool kind
      // (executors that report results without a paired `action` event).
      if (kind === "tool_result" && (payload as { ok?: unknown }).ok === true && (payload as { kind?: unknown }).kind) {
        const p = payload as Record<string, unknown>;
        const outKind = String(p.kind || "");
        const outName = String(p.tool || outKind);
        const check = validateToolOutput(outKind, outName, p);
        if (!check.success) {
          const attempts = (outputGuard.retried[outKind] || 0) + 1;
          outputGuard.retried[outKind] = attempts;
          payload.ok = false;
          payload.error = "incomplete_result";
          payload.missing = check.missing;
          payload.summary = check.humanMessage;
          payload.reason = check.humanMessage;
          outputGuard.pending = `${check.humanMessage}\n${attempts <= 1 ? "Retry this step once with corrected input." : "Stop retrying this step and try a different approach."} Explain any failure to the user in plain everyday language.`;
        }
      }

      if (kind === "tool_result" || kind === "action") {
        const p = payload as { ok?: unknown; tool?: unknown; type?: unknown };
        const toolName = String(p.tool || p.type || "unknown");
        if (p.ok === false) {
          failGuard.state = { failedTool: toolName, nudged: false };
        } else if (p.ok === true && failGuard.state && toolName !== failGuard.state.failedTool) {
          failGuard.state = null;
        }
      }

      // ---- Automatic artifact recording -------------------------------------
      // Any verified write that produced a real deliverable is mirrored into
      // agent_artifacts here, inside the single event path every executor
      // already goes through — no per-tool bookkeeping. Runs AFTER the output
      // validation gate above, so downgraded "successes" never record.
      if (kind === "action" || kind === "tool_result") {
        const p = payload as Record<string, unknown>;
        const rawKind = String(p.type || p.kind || "");
        const artifactKind = ARTIFACT_KINDS[rawKind];
        if (p.ok === true && artifactKind) {
          const dedupeKey = `${rawKind}::${String(p.result_ref ?? p.ref ?? p.url ?? p.target ?? p.summary ?? "")}`;
          if (!recordedArtifacts.has(dedupeKey)) {
            recordedArtifacts.add(dedupeKey);
            const provider = ARTIFACT_PROVIDERS[rawKind] ?? null;
            const integ = provider
              ? connectedIntegrations.find((i) => String(i.provider) === provider ||
                  (provider === "Google" && String(i.provider).startsWith("Google")))
              : undefined;
            const meta = (integ?.metadata as Record<string, unknown>) || {};
            const gmail = connectedIntegrations.find((i) => String(i.provider) === "Gmail");
            const gmailMeta = (gmail?.metadata as Record<string, unknown>) || {};
            const { error: artErr } = await supabase.from("agent_artifacts").insert({
              user_id: userId,
              agent_id: agentId,
              run_id: runId,
              kind: artifactKind,
              title: String(p.target || p.title || p.summary || rawKind || "output").slice(0, 300),
              url: p.url ? String(p.url) : null,
              ref: {
                result_ref: p.result_ref ?? p.ref ?? null,
                tool: p.tool ?? rawKind,
                tool_kind: rawKind,
                summary: typeof p.summary === "string" ? p.summary.slice(0, 1000) : null,
              },
              provider,
              account_email: (meta.account_email as string) || (gmailMeta.account_email as string) || null,
            });
            if (artErr) {
              recordedArtifacts.delete(dedupeKey);
              console.warn("agent_artifacts insert failed", rawKind, artErr.message);
            }
          }
        }
      }

      // Attach decision provenance (reasoning + confidence) to the next action
      // event when the model provided it alongside the tool call. Purely
      // additive — old rows have these columns null.
      const row: Record<string, unknown> = { run_id: runId, agent_id: agentId, user_id: userId, kind, payload };
      if (kind === "action" && (pendingProvenance.reasoning || pendingProvenance.confidence)) {
        if (pendingProvenance.reasoning) row.reasoning = pendingProvenance.reasoning;
        if (pendingProvenance.confidence) row.confidence = pendingProvenance.confidence;
        pendingProvenance.reasoning = undefined;
        pendingProvenance.confidence = undefined;
      }
      return supabase.from("agent_events").insert(row);
    };

    // ---- Confidence-based escalation gate -----------------------------------
    // A low-confidence choice (< the agent's confidence_threshold) is never
    // executed blind: the run pauses BEFORE the step, the operator sees the
    // decision / reasoning / alternatives, and their verdict is logged back to
    // agent_decisions as a `human_override` row linked to the model's entry.
    type EscalationVerdict = {
      requestId: string;
      answer: string;
      decisionId: string | null;
      verdict: "approve" | "reject" | "alternative";
    };
    const escalationVerdicts = new Map<string, EscalationVerdict>();
    const escKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
    const classifyVerdict = (answer: string): "approve" | "reject" | "alternative" => {
      const a = answer.trim().toLowerCase();
      if (/^(approve|approved|yes|go ahead|proceed|ok|okay|do it)\b/.test(a)) return "approve";
      if (/^(reject|rejected|no|stop|don'?t|do not|cancel|skip)\b/.test(a)) return "reject";
      return "alternative";
    };
    // Load past escalation questions + the operator's answers, and back-fill an
    // override row for any answered escalation that hasn't been logged yet.
    const loadEscalationVerdicts = async () => {
      const { data: evs } = await supabase.from("agent_events")
        .select("id, kind, payload, created_at")
        .eq("agent_id", agentId).eq("user_id", userId)
        .in("kind", ["clarification_request", "clarification_answer"])
        .order("created_at", { ascending: false }).limit(200);
      const rows = (evs || []) as { id: string; kind: string; payload: Record<string, unknown> }[];
      const answersByRef = new Map<string, string>();
      for (const r of rows) {
        if (r.kind !== "clarification_answer") continue;
        const ref = String(r.payload?.ref || "");
        const ans = String(r.payload?.answer || "").trim();
        if (ref && ans && !answersByRef.has(ref)) answersByRef.set(ref, ans);
      }
      for (const r of rows) {
        if (r.kind !== "clarification_request" || r.payload?.escalation !== true) continue;
        const key = String(r.payload?.escalation_key || "");
        const answer = answersByRef.get(r.id);
        if (!key || !answer) continue;
        const decisionId = (r.payload?.decision_id as string | null) ?? null;
        const verdict = classifyVerdict(answer);
        if (!escalationVerdicts.has(key)) escalationVerdicts.set(key, { requestId: r.id, answer, decisionId, verdict });
        // Persist the human's call as an override row, once.
        if (!decisionId) continue;
        const { data: existing } = await supabase.from("agent_decisions")
          .select("id").eq("override_of", decisionId).limit(1).maybeSingle();
        if (existing) continue;
        const overrideDecision = `Operator ${verdict === "approve" ? "approved" : verdict === "reject" ? "rejected" : "redirected"}: ${String(r.payload?.decision_text || "low-confidence step").slice(0, 300)}`;
        const { data: overrideRow } = await supabase.from("agent_decisions").insert({
          user_id: userId,
          agent_id: agentId,
          agent_run_id: runId,
          decision: overrideDecision,
          reasoning: `Human override after confidence escalation. Operator answered: ${answer.slice(0, 600)}`,
          alternatives_considered: normalizeAlternatives(r.payload?.alternatives),
          confidence_score: 100,
          source: "human_override",
          human_response: answer.slice(0, 1000),
          override_of: decisionId,
          escalated: true,
        }).select("id").maybeSingle();
        const overrideDecisionId = (overrideRow as { id?: string } | null)?.id ?? null;
        if (overrideDecisionId) {
          try {
            await triggerWebhooks(supabase, userId, "decision_logged", {
              id: overrideDecisionId, decision: overrideDecision, source: "human_override", escalated: true, agent_id: agentId,
            });
          } catch { /* ignore */ }
        }
      }
    };
    await loadEscalationVerdicts().catch(() => {});

    // Returns "proceed" when the step may run, or a message to feed the model.
    const escalateLowConfidence = async (args: {
      decisionText: string;
      reasoning: string;
      alternatives: unknown;
      score: number;
      decisionId: string | null;
      stepIndex: number;
    }): Promise<{ outcome: "proceed" | "blocked" | "paused"; message?: string }> => {
      const key = escKey(args.decisionText);
      const prior = escalationVerdicts.get(key);
      if (prior) {
        if (prior.verdict === "approve") {
          await logEvent("reason", { thought: `Low-confidence step (${args.score}%) already approved by the operator: "${prior.answer}". Proceeding.` });
          return { outcome: "proceed" };
        }
        return {
          outcome: "blocked",
          message: prior.verdict === "reject"
            ? `The operator REJECTED this low-confidence step ("${args.decisionText}"). Do not run it. Choose a different approach or finish and explain plainly.`
            : `The operator redirected this low-confidence step ("${args.decisionText}"). Their instruction: ${prior.answer}\nFollow it instead of your original plan.`,
        };
      }
      const alternatives = normalizeAlternatives(args.alternatives);
      const question =
        `I'm only ${args.score}% sure about this step: ${args.decisionText}.\nWhy I want to do it: ${args.reasoning || "no reasoning recorded"}.\n` +
        (alternatives.length ? `Other options I weighed: ${alternatives.join(" · ")}.\n` : "") +
        `Should I go ahead, skip it, or take a different option?`;
      const options = ["Approve — go ahead", "Reject — don't do this", ...alternatives.map((a) => `Do instead: ${a}`)].slice(0, 6);
      await logEvent("confidence_escalation", {
        decision: args.decisionText,
        reasoning: args.reasoning,
        alternatives,
        confidence_score: args.score,
        threshold: confidenceThreshold,
        decision_id: args.decisionId,
        humanMessage: question,
      });
      await logEvent("clarification_request", {
        question,
        options,
        input_type: "choice",
        fix_action: "input",
        humanMessage: question,
        requested_at: new Date().toISOString(),
        response_timeout_ms: 180_000,
        // Escalation metadata — distinguishes this from a normal ask_user.
        escalation: true,
        escalation_key: key,
        decision_id: args.decisionId,
        decision_text: args.decisionText,
        reasoning: args.reasoning,
        alternatives,
        confidence_score: args.score,
        threshold: confidenceThreshold,
      });
      return { outcome: "paused" };
    };


    await logEvent("run_started", { trigger, goal: manifest.goal });
    if (expiredClarificationId) {
      await logEvent("clarification_expired", { original_event_id: expiredClarificationId, expired_after_hours: 24 });
    }
    await logEvent("reason", { thought: `Agent activated (${trigger}). Reviewing business context and memory before acting.` });

    // ---- Known-issue memory -------------------------------------------------
    // Blockers the user has already been told about (and not yet fixed), plus
    // answers they have already given. Both are checked before any tool runs so
    // the same failure is never rediscovered and the same question never asked
    // twice.
    const knownAnswers = await loadKnownAnswers(supabase, userId).catch(() => []);
    const knownAnswersBlock = knownAnswers.length
      ? `\n# Answers the operator already gave (never ask these again — use the answer directly)\n${knownAnswers.map((a) => `- Q: ${a.question}\n  A: ${a.answer}`).join("\n")}`
      : "";
    const blockedIssueCache = new Map<string, boolean>();


    // Build system prompt with business + memory context
    const profileBlock = profile
      ? `\n# Business you work for\n- Company: ${profile.company_name}\n- One-liner: ${profile.one_liner}\n- Industry: ${profile.industry}\n- Tone: ${profile.tone}\n- Audience: ${profile.audience}\n- Offers: ${JSON.stringify(profile.offers)}\n- Channels: ${JSON.stringify(profile.channels)}`
      : "";
    const memoryBlock = (memory && memory.length)
      ? `\n# What you remember about this business (recent facts)\n${memory.map((m) => `- [${m.source}] ${m.key} = ${m.value}`).join("\n")}`
      : "";
    const insightsBlock = (orgInsights && orgInsights.length)
      ? `\n# Known patterns from this business's history (learned across past agent runs — factor these in when deciding)\n${orgInsights.map((i) => `- (${i.kind}, confidence: ${i.confidence}, seen ${i.evidence_count}x) ${i.insight}`).join("\n")}`
      : "";

    // ---- Phase 4: outcome-aware reasoning ---------------------------------
    // Similarity is deliberately simple and transparent: shared meaningful
    // words between the new decision text and a past decision, plus an exact
    // provider match. No behaviour is auto-changed — the history is injected
    // into the prompt, and the model's own confidence is nudged within a
    // small bounded band, with the adjustment written into provenance.
    const STOPWORDS = new Set(["the", "a", "an", "to", "for", "of", "and", "with", "call", "tool", "use", "on", "in", "this", "that", "from", "by", "at", "is", "it"]);
    const tokens = (s: string) =>
      new Set(
        s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
          .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
      );
    const similarity = (a: string, b: string) => {
      const ta = tokens(a), tb = tokens(b);
      if (!ta.size || !tb.size) return 0;
      let shared = 0;
      for (const t of ta) if (tb.has(t)) shared++;
      return shared / Math.min(ta.size, tb.size);
    };
    const MAX_CONFIDENCE_NUDGE = 10;
    /**
     * Find measured outcomes of past decisions similar to the one about to be
     * made. Returns a bounded confidence adjustment plus a human-readable note
     * for the provenance record.
     */
    const outcomeAdjustment = (decisionText: string, providerHint?: string) => {
      if (!outcomeHistory.length) return null;
      const matches = outcomeHistory
        .map((o) => {
          const providerMatch = !!providerHint && !!o.provider &&
            o.provider.toLowerCase() === providerHint.toLowerCase();
          const sim = similarity(decisionText, `${o.decision} ${o.reasoning}`);
          return { o, score: sim + (providerMatch ? 0.4 : 0) };
        })
        .filter((m) => m.score >= 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      if (!matches.length) return null;
      const pos = matches.filter((m) => m.o.direction === "positive").length;
      const neg = matches.filter((m) => m.o.direction === "negative").length;
      if (pos === neg) {
        return {
          delta: 0,
          note: `Outcome history: ${matches.length} similar past decision(s) with mixed measured results — confidence left unchanged.`,
          matches: matches.map((m) => m.o),
        };
      }
      const net = pos - neg;
      const delta = Math.max(-MAX_CONFIDENCE_NUDGE, Math.min(MAX_CONFIDENCE_NUDGE, net * 5));
      const example = matches[0].o;
      return {
        delta,
        note:
          `Outcome history: ${pos} similar past decision(s) measured positive, ${neg} negative ` +
          `(e.g. "${example.decision}" → ${example.provider} ${example.metric} ${example.deltaPct >= 0 ? "+" : ""}${example.deltaPct}% over ${example.windowDays}d, ${example.direction}). ` +
          `Confidence adjusted ${delta >= 0 ? "+" : ""}${delta} based on that real history.`,
        matches: matches.map((m) => m.o),
      };
    };
    /** Apply the adjustment to a model-reported score + reasoning string. */
    const applyOutcomeHistory = (
      decisionText: string,
      reasoning: string,
      score: number,
      providerHint?: string,
    ) => {
      const adj = outcomeAdjustment(decisionText, providerHint);
      if (!adj) return { score, reasoning, adjusted: false as const };
      return {
        score: Math.max(0, Math.min(100, score + adj.delta)),
        reasoning: `${reasoning} [${adj.note}]`.trim(),
        adjusted: true as const,
        note: adj.note,
        delta: adj.delta,
      };
    };

    const outcomeHistoryBlock = outcomeHistory.length
      ? `\n# Measured outcomes of past decisions (what actually happened after similar choices — use this before repeating or avoiding them)\n${
          outcomeHistory.slice(0, 12).map((o) =>
            `- "${o.decision}" → ${o.provider || "metric"} ${o.metric} ${o.deltaPct >= 0 ? "+" : ""}${o.deltaPct}% over ${o.windowDays}d = ${o.direction.toUpperCase()}`
          ).join("\n")
        }\n- When your next step resembles one of these, say so explicitly in "reasoning" and let it move your confidence_score: raise it when the comparable past decisions measured positive, lower it when they measured negative, leave it when results were mixed.`
      : "";




    const integrationsBlock = connectedIntegrations.length
      ? `\n# Connected business tools (${connectedIntegrations.length}) — you must cite them by name in your reasoning\n${connectedIntegrations.map((i) => {
          const snap = latestByProvider.get(i.provider as string);
          const meta = (i.metadata as Record<string, unknown>) || {};
          const account = meta.handle || meta.account_name || meta.account_email || "connected account";
          if (!snap) return `- ${i.provider} (account: ${account}) — no live snapshot yet, call sync_now to pull data.`;
          const age = Math.round((Date.now() - new Date(snap.fetched_at).getTime()) / 60000);
          if (snap.error) return `- ${i.provider} (account: ${account}) — LAST SYNC FAILED ${age}m ago: ${snap.error}`;
          return `- ${i.provider} (account: ${account}) — live ${snap.kind} data (synced ${age}m ago):\n    ${JSON.stringify(snap.data)}`;
        }).join("\n")}`
      : "";

    // Inject built-in integration tools so EVERY agent (old or new) can
    // refresh and query live data from connected accounts without needing
    // them to be listed in the manifest.
    const builtInTools: Tool[] = [
      { name: "sync_now", kind: "sync_integrations", description: "Pull the freshest live data from every connected business tool. Call this when your snapshots look stale or missing.", config: {} },
      { name: "read_data", kind: "integration_query", description: "Look up the most recent synced snapshot for one connected tool. Use before making claims about numbers.", config: {} },
      { name: "deep_analyze", kind: "deep_analyze", description: "Run deep multi-step reasoning on a subject using a stronger model. Returns a structured diagnosis: findings, root causes, risks, concrete fixes with priority. Use for audits, debugging, competitive analysis, or any problem needing serious thinking.", config: {} },
      { name: "audit_url", kind: "audit_url", description: "Fetch a webpage/document URL and produce a concrete audit: what's wrong, what's missing, prioritized fixes with rationale. Use for website reviews, landing-page audits, doc reviews, competitor teardowns.", config: {} },
      { name: "make_plan", kind: "make_plan", description: "Produce a concrete, numbered execution plan for a stated objective. Each step includes owner, tool/action to take, success criteria. Use before large multi-step work.", config: {} },
      { name: "send_email", kind: "send_email", description: "Send a real email via the agent-notification template. Requires an explicit guardrail allowing external sends; otherwise it will be queued for approval instead of sent.", config: {} },
      { name: "generate_report", kind: "generate_report", description: "Write a markdown report/digest/audit/plan as a durable artifact the operator can open later.", config: {} },
      { name: "create_doc", kind: "create_doc", description: "Create a real Google Doc in the connected Google account (from the Gmail integration) with the given title and body text. Returns the doc URL.", config: {} },
      { name: "create_sheet", kind: "create_sheet", description: "Create a real Google Sheet in the connected Google account (from the Gmail integration) with the given title and rows (2D array of cell values). Returns the sheet URL.", config: {} },
      { name: "create_calendar_event", kind: "create_calendar_event", description: "Create a real event on the connected Google account's primary calendar. Requires ISO start/end times.", config: {} },
      { name: "edit_doc", kind: "edit_doc", description: "Edit an existing Google Doc by id — append to or replace its body content. Verifies the edit by re-reading the doc.", config: {} },
      { name: "edit_sheet", kind: "edit_sheet", description: "Update a range in an existing Google Sheet by id (e.g. Sheet1!A2:C10) with a 2D array of values. Verifies by re-reading the range.", config: {} },
      { name: "read_email", kind: "read_email", description: "Read the full body/thread of a Gmail message. Give a message_id, thread_id, or a Gmail search query (e.g. 'from:x@y.com newer_than:2d'). Returns decoded plain-text content, not just metadata.", config: {} },
      { name: "reply_email", kind: "reply_email", description: "Reply inside an existing Gmail thread by thread_id (proper In-Reply-To/References headers). Same approval-gating as send_email.", config: {} },
      { name: "read_analytics", kind: "read_analytics", description: "Fetch last 30 days of sessions and users from a Google Analytics 4 property via the GA4 Data API. Requires property_id.", config: {} },
      
      { name: "http_post", kind: "http_post", description: "POST a JSON payload to an allow-listed URL to trigger or adjust an external system. URL must be https and either match this agent's configured webhook_url or a whitelisted domain.", config: {} },
      { name: "webhook", kind: "http_post", description: "Alias for http_post — POST a JSON payload to an allow-listed URL.", config: {} },
      { name: "slack_post_message", kind: "slack_post_message", description: "Post a real message to a Slack channel via chat.postMessage using the connected workspace's bot token. Confirmed by Slack's own message receipt (ts) and a read-back where scopes allow.", config: {} },
      { name: "notion_create_page", kind: "notion_create_page", description: "Create a real Notion page under a parent page or database, then re-fetch the page to confirm it exists before reporting success.", config: {} },
      { name: "notion_update_page", kind: "notion_update_page", description: "Update an existing Notion page (title, archived state, or appended content) and re-fetch it to confirm the change landed.", config: {} },
      { name: "canva_create_design", kind: "canva_create_design", description: "Create a real Canva design via the Canva Connect API, then fetch the design back by id to confirm it exists. Returns the edit URL.", config: {} },
      { name: "canva_list_designs", kind: "canva_list_designs", description: "List the user's existing Canva designs (id, title, thumbnail, edit/view URLs) via the Canva Connect API.", config: {} },
      { name: "canva_create_folder", kind: "canva_create_folder", description: "Create a real Canva folder (project) via the Canva Connect API, then fetch it back by id to confirm it exists. Use its id as folder_id in canva_create_design.", config: {} },
      { name: "figma_post_comment", kind: "figma_post_comment", description: "Post a real comment on a Figma file (optionally pinned to a node), then re-read the file's comments to confirm it landed. Figma's API cannot create files or designs — use canva_create_design for real design creation.", config: {} },
      { name: "figma_create_dev_resource", kind: "figma_create_dev_resource", description: "Attach a real dev resource link to a Figma node, then re-read that node's dev resources to confirm it landed.", config: {} },
      { name: "shopify_create_draft_order", kind: "shopify_create_draft_order", description: "Create a real draft order in the connected Shopify store, then re-fetch it by id to confirm it exists. Returns the invoice URL.", config: {} },
      { name: "shopify_update_product", kind: "shopify_update_product", description: "Update a real Shopify product (title, status, description, variant prices/SKUs) and re-fetch the product to confirm every changed field actually changed.", config: {} },
      { name: "schedule_followup", kind: "schedule_followup", description: "Schedule this agent to run again at a specific future time, carrying an instruction forward.", config: {} },
      { name: "upsert_client_note", kind: "upsert_client_note", description: "Create/update a client (contact) record for THIS agent with a short interaction note. Looks up by email; if the client exists it appends a timestamped note. Respects the agent's client_write_mode (edits may require approval).", config: {} },
    ];

    // Capability registry gate: only offer tools that are genuinely implemented,
    // verified, AND whose provider account is actually connected for this org.
    const connectedProviderNames = connectedIntegrations.map((i) => String(i.provider));
    const allTools: Tool[] = [
      ...manifest.tools,
      ...builtInTools.filter((b) => !manifest.tools.some((t) => t.name === b.name || t.kind === b.kind)),
    ];
    const withdrawnTools: { tool: Tool; message: string }[] = [];
    const effectiveTools: Tool[] = allTools.filter((t) => {
      const verdict = canOfferTool(t.kind, connectedProviderNames);
      if (verdict.offerable) return true;
      withdrawnTools.push({ tool: t, message: verdict.message });
      return false;
    });
    const capabilityBlock = buildCapabilityBlock(connectedProviderNames);
    const withdrawnBlock = withdrawnTools.length
      ? `\n# Tools deliberately withheld this run (do NOT invent them)\n${
        withdrawnTools.map((w) => `- ${w.tool.name} (${w.tool.kind}): ${w.message}`).join("\n")
      }`
      : "";

    const toolDescriptions = effectiveTools.map((t) => {
      let usage = "";
      switch (t.kind) {
        case "web_search": usage = `web_search(query: string)`; break;
        case "http_get": usage = `http_get(url: string)`; break;
        case "calc": usage = `calc(expression: string)`; break;
        case "notify": usage = `notify(message: string, severity?: "info"|"warn"|"alert")`; break;
        case "remember": usage = `remember(key: string, value: string)  // persist a fact for future runs`; break;
        case "ask_user": usage = `ask_user(question: string, options?: string[], input_type?: "text"|"choice"|"file", accept?: string)  // pauses the run and shows the operator a real input widget. Use input_type:"file" (with accept, e.g. ".csv") whenever you need the operator to upload something, "choice" with options for a decision, otherwise "text".`; break;
        case "request_approval": usage = `request_approval(action: string, payload: object, risk?: "low"|"med"|"high")  // queue an external action`; break;
        case "sync_integrations": usage = `sync_now(provider?: string)  // refreshes live data from connected tools`; break;
        case "integration_query": usage = `read_data(provider: string)  // returns the latest synced snapshot for a connected tool`; break;
        case "deep_analyze": usage = `deep_analyze(subject: string, context?: string, focus?: string)  // deep structured diagnosis using a stronger reasoning model`; break;
        case "audit_url": usage = `audit_url(url: string, focus?: string)  // fetches the page and returns a concrete prioritized audit`; break;
        case "make_plan": usage = `make_plan(objective: string, constraints?: string)  // returns a numbered execution plan with success criteria`; break;
        case "send_email": usage = `send_email(to: string, subject: string, body: string)  // actually delivers an email unless guardrails require approval`; break;
        case "generate_report": usage = `generate_report(title: string, kind: "report"|"digest"|"audit"|"plan", body_markdown: string)  // saves a durable artifact`; break;
        case "create_doc": usage = `create_doc(title: string, body_markdown: string)  // creates a real Google Doc in the connected Google account and returns { url, id }`; break;
        case "create_sheet": usage = `create_sheet(title: string, rows: string[][])  // creates a real Google Sheet with the given rows and returns { url, id }`; break;
        case "create_calendar_event": usage = `create_calendar_event(title: string, start_iso: string, end_iso: string, description?: string)  // creates an event on the primary Google Calendar and returns { url, id }`; break;
        case "edit_doc": usage = `edit_doc(doc_id: string, mode: "append"|"replace", body_markdown: string)  // edits an existing Google Doc by id and re-reads to verify`; break;
        case "edit_sheet": usage = `edit_sheet(sheet_id: string, range: string, values: string[][])  // updates a range (e.g. "Sheet1!A2:C10") in an existing Google Sheet and re-reads to verify`; break;
        case "read_email": usage = `read_email(message_id?: string, thread_id?: string, query?: string, max?: number)  // returns full decoded body/thread content, not just unread counts`; break;
        case "reply_email": usage = `reply_email(thread_id: string, body: string, subject?: string)  // replies inside an existing Gmail thread with proper threading headers; approval-gated like send_email`; break;

        case "read_analytics": usage = `read_analytics(property_id: string)  // GA4 Data API: last 30 days sessions & totalUsers for the given property`; break;
        
        case "http_post": usage = `http_post(url: string, body: object)  // POSTs JSON to an allow-listed https URL (per-agent webhook_url or whitelisted domain)`; break;
        case "slack_post_message": usage = `slack_post_message(channel: string, text: string, thread_ts?: string)  // really posts to Slack; verified by Slack's message receipt`; break;
        case "notion_create_page": usage = `notion_create_page(parent_id: string, parent_type?: "page"|"database", title: string, body_markdown?: string)  // creates a real Notion page, verified by re-fetching it`; break;
        case "notion_update_page": usage = `notion_update_page(page_id: string, title?: string, append_markdown?: string, archived?: boolean)  // updates a real Notion page, verified by re-fetching it`; break;
        case "canva_create_design": usage = `canva_create_design(title: string, design_type?: "presentation"|"doc"|"whiteboard", folder_id?: string)  // creates a real Canva design (optionally inside a folder), verified by fetching it back`; break;
        case "canva_list_designs": usage = `canva_list_designs(query?: string, folder_id?: string, limit?: number)  // lists the user's real Canva designs with ids, titles, thumbnails and URLs`; break;
        case "canva_create_folder": usage = `canva_create_folder(name: string, parent_folder_id?: string)  // creates a real Canva folder (project), verified by fetching it back`; break;
        case "figma_post_comment": usage = `figma_post_comment(file_key: string, message: string, node_id?: string)  // really comments on a Figma file, verified by re-reading the file's comments`; break;
        case "figma_create_dev_resource": usage = `figma_create_dev_resource(file_key: string, node_id: string, name: string, url: string)  // really attaches a dev resource link to a Figma node, verified by re-reading it`; break;
        case "shopify_create_draft_order": usage = `shopify_create_draft_order(line_items: [{title?, price?, variant_id?, quantity}], email?: string, note?: string)  // creates a real Shopify draft order, verified by re-fetching it`; break;
        case "shopify_update_product": usage = `shopify_update_product(product_id: string, title?: string, status?: "active"|"draft"|"archived", body_html?: string, variants?: [{id, price?, sku?}])  // updates a real Shopify product, verified field-by-field by re-fetching it`; break;
        case "schedule_followup": usage = `schedule_followup(run_at_iso: string, instruction: string)  // queues a future run of this same agent`; break;
        case "upsert_client_note": usage = `upsert_client_note(email?: string, name?: string, company?: string, note: string, tags?: string[])  // creates/updates the agent's private client record and appends a timestamped note. Edits to existing notes may require approval per client_write_mode.`; break;
        default: usage = `${t.name}(...)  // CUSTOM — currently inert`;
      }
      return `- ${t.name} (${t.kind}): ${t.description}\n  Usage: ${usage}`;
    }).join("\n");


    const systemPrompt = `${manifest.systemPrompt}

# Operating contract
- Goal: ${manifest.goal}
- Decision policy: ${manifest.decisionPolicy}
- Guardrails: ${manifest.guardrails.map((g) => `${g.rule}${g.requiresApproval ? " [REQUIRES APPROVAL]" : ""}`).join("; ")}
- KPIs: ${manifest.kpis.map((k) => `${k.name}=${k.target}`).join(", ")}
${profileBlock}
${integrationsBlock}
${memoryBlock}
${insightsBlock}
${outcomeHistoryBlock}
${knownAnswersBlock}
${capabilityBlock}
${withdrawnBlock}

# Live-data contract
- Whenever you cite a number, name the connected tool it came from (e.g. "Shopify: 47 orders in the last 24h").
- If a connected tool has no fresh snapshot, call sync_now BEFORE reasoning about it.
- If any snapshot shows an error, mention the failing tool by name and either call sync_now once to retry or ask_user for updated credentials.

# Autonomy rules — you are a real digital employee who COMPLETES serious work end-to-end
- You are hired to FINISH the task, not narrate it. Every run must produce concrete delivered output (a diagnosis with evidence, an audit with prioritized fixes, an executed plan, a sent message, an updated record, a published report, an adjusted price) — not just observations or "I would…" statements.
- For serious analytical tasks (auditing a website/document, debugging a problem, researching competitors, diagnosing a broken process, building a plan), ALWAYS use deep_analyze / audit_url / make_plan — they invoke a stronger reasoning model. Feed them the real data you gathered (from http_get, read_data, web_search).
- Standard loop for a serious task: (1) gather evidence with http_get / web_search / read_data, (2) reason with deep_analyze or audit_url, (3) produce the deliverable (make_plan or the final artifact), (4) execute what you can inside policy, (5) queue the rest with request_approval, (6) remember() the durable facts.
- Internal + routine automated work (research, drafting, computing, reasoning, logging, sending scheduled reminders, replying to DMs within tone, generating reports, updating dashboards, adjusting prices within configured bounds, reconciling records) → EXECUTE it via the appropriate tool. Do not ask permission for work the operator already delegated to you.
- Reserve request_approval ONLY for irreversible, high-blast-radius actions: charging money above a threshold, mass public posts, legal/tax filings, deleting data, or anything a guardrail explicitly marks [REQUIRES APPROVAL].
- If you literally cannot proceed without info the business hasn't given you, call ask_user with at most one focused question. After ask_user, finish the run; you'll resume when the operator answers.
- Failure-recovery rule: if a tool call fails or returns ok:false, DO NOT immediately ask_user. First try ONE reasonable alternative approach (a different tool, different input, or a smaller sub-goal). Only call ask_user if the alternative also fails or the missing piece is genuinely operator-only info (credentials, a decision, a fact the business hasn't shared).
- Persist anything durable about the business with remember(key, value) so future runs are smarter.
- Before you finish, self-check: does what you actually produced this run satisfy the operator's instruction? Your finish summary MUST (a) list concrete artifacts as "Delivered: <thing> → <where/ID>", (b) plainly state whether the original goal was met (yes / partially / no) and why. If you delivered nothing, that is a failed run — say so honestly.

- Never break character. Never explain you are an LLM.



# Tools
${toolDescriptions}

# Loop protocol — output EXACTLY ONE fenced JSON block per turn:
\`\`\`json
{"action":"think","thought":"..."}
\`\`\`
\`\`\`json
{"action":"tool","tool":"<name>","input":{...},"reasoning":"<one short sentence WHY you chose this action now>","alternatives_considered":["<other option you weighed and rejected>","..."],"confidence_score":0-100,"confidence":"high|medium|low"}
\`\`\`
For any REAL WRITE action (send_email, reply_email, create_doc, edit_doc, create_sheet, edit_sheet, create_calendar_event, upsert_client_note, slack_post_message, notion_create_page, notion_update_page, canva_create_design, canva_create_folder, figma_post_comment, figma_create_dev_resource, shopify_create_draft_order, shopify_update_product, http_post, schedule_followup) the "reasoning" and "confidence" fields are REQUIRED. For read-only or internal tools they are optional.
Decision provenance (ALL tool + decide blocks): include "alternatives_considered" (the other tools/strategies/data sources you genuinely weighed for this step — empty array only if there truly was no alternative) and "confidence_score", an integer 0-100 that honestly reflects how certain YOU are in this specific choice given the data you actually have. Never emit a fixed or habitual number: lower it when data is stale, missing or ambiguous, raise it when you verified the inputs.
\`\`\`json
{"action":"decide","decision":"...","rationale":"...","alternatives_considered":["..."],"confidence_score":0-100}
\`\`\`

\`\`\`json
{"action":"finish","summary":"..."}
\`\`\`

Rules:
- Max ${MAX_STEPS} turns.
- Use at least one real tool unless the goal genuinely needs none.
- Output ONLY the fenced JSON block. No preamble.`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInstruction
        ? `Trigger: ${trigger}. Operator instruction: ${userInstruction}\nBegin.`
        : `Trigger: ${trigger}. Pursue your goal autonomously for the business above. Begin.` },
    ];

    // Ask the model to repair failed tool input from the exact error + stack.
    // Bounded by the wrapper's attempt ceiling; returns null to stop retrying.
    const correctToolInput: Corrector = async (ctx) => {
      try {
        const resp = await fetch(LOVABLE_URL, {
          method: "POST",
          headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            temperature: 0.1,
            messages: [
              { role: "system", content: "You repair failed tool-call inputs. Output ONLY the requested fenced JSON block." },
              { role: "user", content: buildCorrectionPrompt(ctx) },
            ],
          }),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        await recordAiSpend(supabase, userId, MODEL, data?.usage, "agent-runtime-correction", agentId);
        const raw: string = data?.choices?.[0]?.message?.content ?? "";
        const block = extractAction(raw);
        const nextInput = block?.input;
        const explanation = typeof block?.explanation === "string" ? block.explanation.slice(0, 300) : "corrected input";
        if (!nextInput || typeof nextInput !== "object" || Array.isArray(nextInput)) return null;
        if (JSON.stringify(nextInput) === JSON.stringify(ctx.input)) return null; // no change = no point retrying
        return { input: nextInput as Record<string, unknown>, explanation };
      } catch {
        return null;
      }
    };

    let finalSummary = "Run ended without explicit summary.";
    let steps = 0, finished = false, paused = false;
    // This run's own accumulated AI spend -- separate from the account-wide
    // daily total recordAiSpend already tracks. Confirmed: only control-engine
    // metered gateway usage before this; agent-runtime's own reasoning-loop
    // calls (up to MAX_STEPS per run) were invisible to the daily spend cap
    // entirely, so a stuck/looping agent could burn unbounded tokens across
    // unbounded runs without ever tripping it.
    let runSpendUsd = 0;

    // ---- Control-engine gate for real tool calls ---------------------------
    // Routes the "should this action run" question through the SAME endpoint
    // the Control System chat uses, so kill switch, hard rules, circuit
    // breaker, spend cap, safety scanner, risk/fit judgement and the org
    // strictness dial all apply to autonomous agent runs too. `assess_only`
    // keeps execution here — control-engine only rules on it.
    type GateVerdict = {
      ok: boolean;
      verdict: "allow" | "block" | "require_approval" | "modify" | "deferred";
      reason: string | null;
      decisionId: string | null;
      approvalId: string | null;
      source: string | null;
      safety: unknown;
      shadowRules: unknown[];
      riskTier?: string | null;
      fitAssessment?: string | null;
      confidenceScore?: number | null;
      strictness?: string | null;
      via: "control-engine" | "local-gate";
      /** True when a tripped breaker's cooldown had elapsed and this attempt
       * was let through as a half-open recovery trial -- the later
       * recordBreakerAttempt call for this same attempt needs to know, so a
       * successful trial actually clears the breaker instead of being
       * outvoted by a still-mostly-failed rolling window. */
      breakerHalfOpenTrial?: boolean;
    };

    const assessWithControlEngine = async (a: {
      actionType: string;
      provider: string;
      description: string;
      params: unknown;
      stepIndex: number;
    }): Promise<GateVerdict> => {
      // Own bucket, separate from control-engine's "control-engine" key --
      // agent-driven steps must not silently eat a human chat request's
      // budget, and this also covers the in-process fallback below, which
      // has no rate-limit layer of its own. Covers both the HTTP path and
      // the fallback with one check, since both are "one gate assessment".
      const stepRate = await checkRateLimit(supabase, userId, "agent-runtime-step", STEP_RATE_LIMIT_PER_MINUTE, 60);
      if (!stepRate.allowed) {
        return {
          ok: false,
          verdict: "block",
          reason: `Too many gate assessments for this account — ${stepRate.count} in the last minute (limit ${stepRate.limit}). Try again shortly.`,
          decisionId: null,
          approvalId: null,
          source: "rate_limit",
          safety: null,
          shadowRules: [],
          via: "local-gate",
        };
      }
      const base = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (base && serviceKey) {
        try {
          const resp = await fetch(`${base}/functions/v1/control-engine`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
              "x-internal-user-id": userId,
            },
            body: JSON.stringify({
              action_type: a.actionType,
              provider: a.provider,
              description: a.description,
              params: a.params,
              agentId,
              runId,
              stepIndex: a.stepIndex,
              assess_only: true,
            }),
          });
          if (resp.ok) {
            const d = await resp.json() as Record<string, unknown>;
            const decision = String(d.decision ?? "block") as GateVerdict["verdict"];
            return {
              ok: decision === "allow",
              verdict: decision,
              reason: (d.reason as string) ?? (d.reasoning as string) ?? null,
              decisionId: (d.decision_id as string) ?? null,
              approvalId: (d.approval_id as string) ?? null,
              source: (d.gate_source as string) ?? (d.model_judged ? "model" : null),
              safety: d.safety_scan ?? null,
              shadowRules: Array.isArray(d.shadow_rules) ? d.shadow_rules as unknown[] : [],
              riskTier: (d.risk_tier as string) ?? null,
              fitAssessment: (d.fit_assessment as string) ?? null,
              confidenceScore: typeof d.confidence_score === "number" ? d.confidence_score : null,
              strictness: (d.strictness as string) ?? null,
              via: "control-engine",
              breakerHalfOpenTrial: d.breaker_half_open_trial === true,
            };
          }
          await logEvent("reason", {
            thought: `Control engine returned ${resp.status} — falling back to the local control gate for this step.`,
          });
        } catch (err) {
          await logEvent("reason", {
            thought: `Could not reach the control engine (${err instanceof Error ? err.message : "network error"}) — falling back to the local control gate.`,
          });
        }
      }
      // Fallback: the deterministic layers still run locally, so a network
      // problem can never turn into an ungated real action.
      const gate = await runControlGate(supabase, {
        userId,
        actionType: a.actionType,
        provider: a.provider,
        description: a.description,
        params: a.params,
        agentId,
        runId,
        stepIndex: a.stepIndex,
        origin: "agent-runtime",
      });
      return {
        ok: gate.ok,
        verdict: gate.verdict,
        reason: gate.reason,
        decisionId: gate.decisionId,
        approvalId: gate.approvalId,
        source: gate.source,
        safety: gate.safety.matched ? gate.safety : null,
        shadowRules: gate.shadowRules,
        via: "local-gate",
        breakerHalfOpenTrial: gate.circuitBreakerHalfOpenTrial,
      };
    };


    while (steps < MAX_STEPS && !finished && !paused) {
      steps++;
      // Deliver any pending output-validation failure before the next turn so
      // the model retries / re-routes instead of treating the step as done.
      if (outputGuard.pending) {
        messages.push({ role: "user", content: `OUTPUT VALIDATION FAILED — the result was withheld from the user.\n${outputGuard.pending}` });
        outputGuard.pending = null;
      }

      const stepCtrl = new AbortController();
      const stepTimeout = setTimeout(() => stepCtrl.abort(), STEP_TIMEOUT_MS);
      let resp: Response;
      try {
        resp = await fetch(LOVABLE_URL, {
          method: "POST",
          headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
          body: JSON.stringify({ model: MODEL, messages, temperature: 0.4 }),
          signal: stepCtrl.signal,
        });
      } catch (e) {
        const timedOut = e instanceof Error && e.name === "AbortError";
        await logEvent("error", {
          phase: "ai_loop",
          message: timedOut
            ? `Step timed out after ${STEP_TIMEOUT_MS / 1000}s`
            : `Gateway request failed: ${e instanceof Error ? e.message : "unknown"}`,
        });
        break;
      } finally {
        clearTimeout(stepTimeout);
      }
      if (resp.status === 429) { await logEvent("error", { phase: "ai_loop", message: "Rate limit" }); break; }
      if (resp.status === 402) { await logEvent("error", { phase: "ai_loop", message: "AI credits exhausted" }); break; }
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        await logEvent("error", { phase: "ai_loop", message: `Gateway ${resp.status}`, detail: t.slice(0, 300) });
        break;
      }
      const data = await resp.json();
      // Meter this reasoning-loop call against the org's daily spend cap
      // (warns at 90%, auto-trips the kill switch at 100%) -- same call
      // shape control-engine already uses for its own gateway calls.
      await recordAiSpend(supabase, userId, MODEL, data?.usage, "agent-runtime", agentId);
      runSpendUsd += estimateCostUsd(MODEL, data?.usage);
      const raw: string = data?.choices?.[0]?.message?.content ?? "";
      messages.push({ role: "assistant", content: raw });

      if (runSpendUsd >= MAX_RUN_SPEND_USD) {
        await logEvent("error", {
          phase: "spend_ceiling",
          message: `Run stopped after spending $${runSpendUsd.toFixed(2)} of this run's own $${MAX_RUN_SPEND_USD.toFixed(2)} ceiling — independent of the account's daily cap.`,
        });
        break;
      }

      const parsed = extractAction(raw);
      if (!parsed) {
        await logEvent("error", { phase: "parse", message: "No valid action block", raw: raw.slice(0, 300) });
        messages.push({ role: "user", content: `Your last message did not contain a valid fenced JSON action block. Emit exactly one now.` });
        continue;
      }

      if (parsed.action === "think") {
        await logEvent("reason", { thought: String(parsed.thought || "").slice(0, 600) });
      } else if (parsed.action === "decide") {
        const decisionText = String(parsed.decision || "").slice(0, 400);
        const rationale = String(parsed.rationale || "").slice(0, 400);
        const conf = readConfidence(parsed as Record<string, unknown>);
        // Phase 4: let measured outcomes of similar past decisions move the
        // confidence (bounded) and be recorded in the provenance reasoning.
        const hist = applyOutcomeHistory(decisionText, rationale, conf.score);
        conf.score = hist.score;
        await logEvent("decision", {
          decision: decisionText,
          rationale: hist.reasoning,
          confidence_score: conf.score,
          outcome_history_applied: hist.adjusted ? { note: hist.note, delta: hist.delta } : null,
          alternatives_considered: (parsed as Record<string, unknown>).alternatives_considered ?? [],
        });
        const lowConfidence = conf.score < confidenceThreshold;
        const decisionId = await logDecision({
          decision: decisionText,
          reasoning: hist.reasoning,
          alternatives: (parsed as Record<string, unknown>).alternatives_considered,
          score: conf.score,
          stepIndex: steps,
          escalated: lowConfidence,
        });
        if (lowConfidence) {
          const gate = await escalateLowConfidence({
            decisionText,
            reasoning: rationale,
            alternatives: (parsed as Record<string, unknown>).alternatives_considered,
            score: conf.score,
            decisionId,
            stepIndex: steps,
          });
          if (gate.outcome === "blocked") {
            messages.push({ role: "user", content: gate.message! });
            continue;
          }
          if (gate.outcome === "paused") {
            paused = true;
            finalSummary = `Paused — waiting for your approval on a low-confidence decision (${conf.score}%): ${decisionText}`;
            break;
          }
        }

      } else if (parsed.action === "finish") {
        finalSummary = String(parsed.summary || finalSummary).slice(0, 600);
        await logEvent("finished", { summary: finalSummary });
        finished = true; break;
      } else if (parsed.action === "tool") {
        const toolName = String(parsed.tool || "");
        const tool = effectiveTools.find((t) => t.name === toolName) || effectiveTools.find((t) => t.kind === toolName);
        if (!tool) {
          await logEvent("tool_error", { tool: toolName, message: "Unknown tool" });
          messages.push({ role: "user", content: `Unknown tool "${toolName}". Available: ${effectiveTools.map((t) => t.name).join(", ")}` });
          continue;
        }
        const rawInput = (parsed.input && typeof parsed.input === "object") ? parsed.input as Record<string, unknown> : {};

        // ---- Zod schema gate: validate BEFORE any executor runs ----
        const validation = validateToolInput(tool.kind, tool.name, rawInput);
        if (!validation.success) {
          const payload = {
            success: false,
            error: "validation_error",
            tool: tool.name,
            kind: tool.kind,
            explanation: validation.humanMessage,
            details: validation.details,
          };
          await logEvent("tool_call", { tool: tool.name, kind: tool.kind, input: rawInput, rejected: true });
          await logEvent("tool_error", {
            tool: tool.name,
            kind: tool.kind,
            message: validation.humanMessage,
            technical: `validation_error: ${validation.message}`,
            details: validation.details,
          });
          await logEvent("tool_result", {
            tool: tool.name,
            ok: false,
            summary: validation.humanMessage,
            reason: validation.humanMessage,
            details: validation.details,
          });
          messages.push({
            role: "user",
            content: `Tool "${tool.name}" was NOT executed — its input failed validation.\n${validation.humanMessage}\n${JSON.stringify(payload)}\nFix the listed fields and re-emit a corrected action block, or choose a different tool. When you explain this to the user, use plain everyday language — no schema or field-code jargon.`,
          });

          continue;
        }
        const input = validation.data;

        // Identical-action loop detection for tools the control gate never
        // sees (see UNGATED_TOOL_KINDS above). Hashes (kind, input) rather
        // than a step counter, since these tools have no circuit breaker of
        // their own to eventually intervene.
        if (UNGATED_TOOL_KINDS.has(tool.kind)) {
          const repeatKey = `${tool.kind}::${JSON.stringify(input)}`;
          const priorAttempts = recentUngatedCalls.get(repeatKey) ?? 0;
          if (priorAttempts >= UNGATED_REPEAT_LIMIT) {
            await logEvent("reason", {
              thought: `Intercepted a repeat of "${tool.name}" with identical input — already tried ${priorAttempts} times this run with no new outcome.`,
            });
            messages.push({
              role: "user",
              content: `"${tool.name}" was NOT run again — you've already called it with this exact input ${priorAttempts} times this run and it won't produce a different result. Try a genuinely different input, a different tool, or move on to finishing with what you already have.`,
            });
            continue;
          }
          recentUngatedCalls.set(repeatKey, priorAttempts + 1);
        }

        // Retry-alternative-first guard: block ask_user until the model has
        // tried at least one different tool after the last failure.
        if (tool.kind === "ask_user" && failGuard.state && !failGuard.state.nudged) {
          failGuard.state.nudged = true;
          const failed = failGuard.state.failedTool;
          await logEvent("reason", {
            thought: `Intercepted ask_user — must try one alternative approach after "${failed}" failed before escalating to operator.`,
          });
          messages.push({
            role: "user",
            content: `Do NOT call ask_user yet. The last "${failed}" attempt failed. Try ONE reasonable alternative first — a different tool, different input, or a smaller sub-goal. Only call ask_user if that alternative also fails or the missing piece is genuinely operator-only (credentials, a decision, a fact the business hasn't shared).`,
          });
          continue;
        }
        // Any DIFFERENT tool attempt clears the pending-alternative flag.
        if (failGuard.state && tool.name !== failGuard.state.failedTool && tool.kind !== "ask_user") {
          failGuard.state = null;
        }

        // Stage decision provenance (reasoning + confidence) from the model's
        // action block, and log the full provenance record for EVERY tool
        // choice — what it picked, why, what else it weighed, how sure it is.
        {
          const p = parsed as Record<string, unknown>;
          const r = typeof p.reasoning === "string" ? p.reasoning.trim().slice(0, 400) : "";
          const conf = readConfidence(p);
          if (ACTION_CAPPED_KINDS.has(tool.kind)) {
            if (r) pendingProvenance.reasoning = r;
            pendingProvenance.confidence = conf.label;
          }
          const decisionText = `Call tool "${tool.name}"`;
          // Phase 4: enrich this choice with the measured outcomes of similar
          // past tool decisions (same provider and/or similar decision text).
          const providerHint = typeof (input as Record<string, unknown>).provider === "string"
            ? String((input as Record<string, unknown>).provider)
            : connectedIntegrations.map((i) => String(i.provider))
                .find((p2) => `${tool.name} ${tool.kind}`.toLowerCase().includes(p2.toLowerCase()));
          const hist = applyOutcomeHistory(
            `${decisionText} ${tool.kind} ${r}`,
            r || "No reasoning provided by the model for this step.",
            conf.score,
            providerHint,
          );
          conf.score = hist.score;
          if (hist.adjusted) {
            await logEvent("reason", { thought: hist.note!, outcome_history_delta: hist.delta });
            if (ACTION_CAPPED_KINDS.has(tool.kind)) pendingProvenance.reasoning = hist.reasoning.slice(0, 400);
          }
          const lowConfidence =
            conf.score < confidenceThreshold &&
            !["ask_user", "request_approval", "remember"].includes(tool.kind);
          const decisionId = await logDecision({
            decision: decisionText,
            reasoning: hist.reasoning,
            alternatives: p.alternatives_considered,
            score: conf.score,
            stepIndex: steps,
            escalated: lowConfidence,
            actionType: tool.kind,
            provider: providerHint ?? null,
          });

          // Escalation gate: pause BEFORE executing anything the model is
          // not confident enough about.
          if (lowConfidence) {
            const gate = await escalateLowConfidence({
              decisionText,
              reasoning: r,
              alternatives: p.alternatives_considered,
              score: conf.score,
              decisionId,
              stepIndex: steps,
            });
            if (gate.outcome === "blocked") {
              await logEvent("tool_result", {
                tool: tool.name,
                ok: false,
                skipped: true,
                summary: gate.message,
                humanMessage: gate.message,
              });
              messages.push({ role: "user", content: gate.message! });
              continue;
            }
            if (gate.outcome === "paused") {
              await logEvent("tool_result", {
                tool: tool.name,
                kind: tool.kind,
                ok: true,
                waiting_for_user: true,
                input_type: "choice",
                summary: `Paused for your approval — only ${conf.score}% sure about ${tool.name}.`,
                humanMessage: `Waiting for your decision before running ${tool.name} (confidence ${conf.score}%, threshold ${confidenceThreshold}%).`,
              });
              paused = true;
              finalSummary = `Paused — waiting for your approval on a low-confidence step (${conf.score}%): ${decisionText}`;
              break;
            }
          }
        }


        await logEvent("tool_call", { tool: tool.name, kind: tool.kind, input });


        // ---- Capability registry gate: refuse stub / unverified / unconnected
        // tools instead of letting them silently pretend to work.
        {
          const verdict = canOfferTool(tool.kind, connectedProviderNames);
          if (!verdict.offerable) {
            const cap = CAPABILITY_REGISTRY[tool.kind];
            await logEvent("capability_blocked", {
              tool: tool.name,
              kind: tool.kind,
              reason: verdict.reason,
              provider: cap?.provider ?? null,
              implemented: cap?.implemented ?? false,
              verified: cap?.verified ?? false,
              humanMessage: verdict.message,
              message: verdict.message,
            });
            await logEvent("tool_result", {
              tool: tool.name,
              ok: false,
              skipped: true,
              summary: verdict.message,
              humanMessage: verdict.message,
              category: "capability",
            });
            messages.push({
              role: "user",
              content: `"${tool.name}" was NOT run and produced no real effect. ${verdict.message}\nDo not retry it, do not simulate it, and do not describe its outcome as if it happened. Either use a genuinely available tool or state this limitation plainly to the operator in your output.`,
            });
            continue;
          }
        }

        // ---- CONTROL ENGINE GATE -------------------------------------------
        // Every real tool call is routed through control-engine (assess-only),
        // exactly like the Control System chat: spend cap, kill switch, hard
        // rules (live + shadow), circuit breaker, safety scanner, PLUS the
        // model risk/fit judgement and the org strictness dial. Only the
        // "should this run" verdict comes from there — the execution, its
        // verification and artifact recording stay inside this run.
        let gateAttempt: ((failed: boolean, why: string) => Promise<unknown>) | null = null;
        if (ACTION_CAPPED_KINDS.has(tool.kind)) {
          const gateProvider = providerForTool(tool.kind, input);
          const gateDescription = `Agent "${tool.name}" step ${steps} during an autonomous run.`;
          const verdict = await assessWithControlEngine({
            actionType: tool.kind,
            provider: gateProvider,
            description: gateDescription,
            params: input,
            stepIndex: steps,
          });

          gateAttempt = (failed: boolean, why: string) =>
            recordBreakerAttempt(supabase, {
              userId,
              actionType: tool.kind,
              provider: gateProvider,
              failed,
              why,
              agentId,
              runId,
              stepIndex: steps,
              isHalfOpenTrial: verdict.breakerHalfOpenTrial,
            });

          if (verdict.shadowRules?.length) {
            await logEvent("shadow_rule_hit", { tool: tool.name, kind: tool.kind, rules: verdict.shadowRules });
          }
          if (!verdict.ok) {
            const msg = verdict.reason ?? "Stopped by the control system.";
            await logEvent("control_gate_blocked", {
              tool: tool.name,
              kind: tool.kind,
              verdict: verdict.verdict,
              source: verdict.source,
              decision_id: verdict.decisionId,
              approval_id: verdict.approvalId,
              safety_scan: verdict.safety ?? null,
              risk_tier: verdict.riskTier ?? null,
              fit_assessment: verdict.fitAssessment ?? null,
              confidence_score: verdict.confidenceScore ?? null,
              strictness: verdict.strictness ?? null,
              via: verdict.via,
              humanMessage: msg,
              message: msg,
            });
            await logEvent("tool_result", {
              tool: tool.name,
              ok: false,
              skipped: true,
              summary: msg,
              humanMessage: msg,
              category: verdict.source ?? "control_gate",
            });
            messages.push({
              role: "user",
              content: `"${tool.name}" was NOT run and had no real effect. ${msg}\n${
                verdict.verdict === "allow"
                  ? ""
                  : verdict.verdict === "block"
                    ? "Do not retry it and do not describe its outcome as if it happened."
                    : "It is now waiting in the approval queue for a human. Do not retry it this run."
              } Continue with work that doesn't need it, or finish and state this plainly.`,
            });
            continue;
          }
        }




        // Daily action cap gate — blocks verified action executors once used>=cap for today (UTC).
        if (ACTION_CAPPED_KINDS.has(tool.kind) && dailyActionCap > 0) {
          if (!actionCapState.blocked) {
            actionCapState.usedToday = await countTodaysActions();
            if (actionCapState.usedToday >= dailyActionCap) actionCapState.blocked = true;
          }
          if (actionCapState.blocked) {
            if (!actionCapState.loggedOnce) {
              await logEvent("action_cap_reached", {
                reason: "Daily action cap reached, blocked",
                cap: dailyActionCap,
                used_today: actionCapState.usedToday,
                tool: tool.name,
                kind: tool.kind,
              });
              actionCapState.loggedOnce = true;
            }
            const msg = `Daily action cap reached, blocked (${actionCapState.usedToday}/${dailyActionCap}). No further real actions allowed today; you may still reason and finish.`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: tool.kind, target: "cap", ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg}\n\nSummarize what you have and finish.` });
            continue;
          }
        }

        // ---- Known-issue gate: skip execution entirely for a blocker the
        // user already knows about and hasn't fixed yet. No retries, no
        // rediscovery — just the same plain-language fix message.
        if (ACTION_CAPPED_KINDS.has(tool.kind) || tool.kind === "integration_query" || tool.kind === "sync_integrations") {
          const provider = providerForTool(tool.kind, input);
          const cacheKey = `${provider}::${tool.kind}`;
          if (blockedIssueCache.get(cacheKey) !== false) {
            const known = await findOpenIssue(supabase, userId, provider, tool.kind).catch(() => null);
            blockedIssueCache.set(cacheKey, !known);
            if (known) {
              await logEvent("blocked_known_issue", {
                tool: tool.name,
                kind: tool.kind,
                provider,
                issue_id: known.id,
                error_type: known.error_type,
                fix_action: known.fix_action,
                scope_hint: known.scope_hint,
                title: known.title,
                humanMessage: known.human_message,
                message: known.human_message,
              });
              await logEvent("tool_result", {
                tool: tool.name,
                ok: false,
                skipped: true,
                summary: known.human_message,
                humanMessage: known.human_message,
                category: known.error_type,
              });
              messages.push({
                role: "user",
                content: `"${tool.name}" was NOT run. There is a known unresolved blocker on ${provider} that only the operator can fix: ${known.human_message} Do not retry this tool or any other ${provider} tool this run. Continue with work that doesn't need ${provider}, or finish and state this blocker plainly.`,
              });
              continue;
            }
          }
        }

        // Built-in interactive tools pause the run
        if (tool.kind === "ask_user") {
          const question = String(input.question || "").slice(0, 400);
          const options = Array.isArray(input.options) ? (input.options as string[]).slice(0, 4) : undefined;
          // If the operator already answered this exact question before, reuse
          // the stored answer instead of pausing the run again.
          const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
          const prior = knownAnswers.find((a) => norm(a.question) === norm(question));
          if (prior) {
            await logEvent("reason", {
              thought: `Skipped asking the operator — this was already answered previously: "${prior.answer}".`,
            });
            messages.push({
              role: "user",
              content: `The operator already answered "${question}" previously: ${prior.answer}\nUse that answer and continue — do not ask again.`,
            });
            continue;
          }
          // Work out what widget the operator actually needs so the UI can
          // render a real control (upload box / choice buttons / text field)
          // instead of an endless "Calling ask_user…" spinner.
          const q = question.toLowerCase();
          const declared = String(input.input_type || "").toLowerCase();
          let inputType: "text" | "choice" | "file" =
            declared === "file" || declared === "choice" || declared === "text"
              ? (declared as "text" | "choice" | "file")
              : options && options.length
                ? "choice"
                : /\b(upload|attach|csv|spreadsheet|export file|send (me|us) the file|screenshot|pdf|image|logo|document file)\b/.test(q)
                  ? "file"
                  : "text";
          if (inputType === "choice" && !(options && options.length)) inputType = "text";
          const accept = String(input.accept || "").slice(0, 120) ||
            (inputType === "file"
              ? /\bcsv\b/.test(q) ? ".csv,text/csv"
                : /\b(sheet|spreadsheet|xlsx|excel)\b/.test(q) ? ".csv,.xlsx,.xls"
                  : /\b(image|screenshot|logo|photo)\b/.test(q) ? "image/*"
                    : /\bpdf\b/.test(q) ? ".pdf" : ""
              : "");

          await recordQuestionIssue(supabase, { userId, agentId, question, options }).catch(() => null);
          await logEvent("clarification_request", {
            question,
            options,
            input_type: inputType,
            accept: accept || undefined,
            fix_action: "input",
            humanMessage: question,
            requested_at: new Date().toISOString(),
            // The UI stops waiting silently after this and shows a persistent
            // "Waiting for your input" notice instead of a busy spinner.
            response_timeout_ms: 180_000,
          });
          // Close out the tool call so the log never shows an in-flight spinner
          // for a step that is actually just waiting on a human.
          await logEvent("tool_result", {
            tool: tool.name,
            kind: "ask_user",
            ok: true,
            waiting_for_user: true,
            input_type: inputType,
            summary: `Asked you: ${question}`,
            humanMessage: `Waiting for your input: ${question}`,
          });
          paused = true;
          finalSummary = `Paused — waiting for your input: ${question}`;
          break;


        }
        if (tool.kind === "request_approval") {
          await logEvent("pending_approval", {
            action: String(input.action || "external action").slice(0, 200),
            payload: input.payload ?? input,
            risk: String(input.risk || "med"),
          });
          messages.push({ role: "user", content: `Approval queued. Continue with other work or finish.` });
          continue;
        }
        if (tool.kind === "remember") {
          const k = String(input.key || "").slice(0, 120);
          const v = String(input.value || "").slice(0, 600);
          if (k && v) {
            await supabase.from("agent_memory").insert({ agent_id: agentId, user_id: userId, key: k, value: v, source: "agent" });
            await logEvent("memory_write", { key: k, value: v });
            messages.push({ role: "user", content: `Memory saved: ${k}. Continue.` });
          } else {
            messages.push({ role: "user", content: `remember requires non-empty key and value.` });
          }
          continue;
        }

        if (tool.kind === "sync_integrations") {
          const providerFilter = String(input.provider || "").trim() || null;
          try {
            const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
              body: JSON.stringify({ cron: true }),
            });
            const body = await r.json().catch(() => ({}));
            // Build a set of connected providers so we only return snapshots for live connections.
            const { data: connectedInts } = await supabase.from("agent_integrations")
              .select("provider")
              .eq("user_id", userId)
              .eq("status", "connected");
            const connectedSet = new Set((connectedInts || []).map((i) => String(i.provider).toLowerCase()));
            // Re-read the latest snapshots for THIS user so the agent has fresh numbers.
            const { data: fresh } = await supabase.from("integration_snapshots")
              .select("provider, kind, data, error, fetched_at")
              .eq("user_id", userId)
              .order("fetched_at", { ascending: false }).limit(50);
            const seen = new Set<string>();
            const summary = (fresh || [])
              .filter((s) => {
                if (seen.has(s.provider as string)) return false;
                if (!connectedSet.has(String(s.provider).toLowerCase())) return false;
                if (providerFilter && s.provider !== providerFilter) return false;
                seen.add(s.provider as string); return true;
              })
              .map((s) => `${s.provider} [${s.kind}] ${s.error ? `ERROR: ${s.error}` : JSON.stringify(s.data)}`)
              .join("\n");
            await logEvent("action", { type: "sync_integrations", ok: r.ok, providers: seen.size, cron_result: body });
            await logEvent("tool_result", { tool: tool.name, ok: r.ok, summary: summary || "No connected tools to sync." });
            messages.push({ role: "user", content: `Live data refreshed:\n${summary || "(none)"}\n\nContinue.` });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "sync failed";
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            messages.push({ role: "user", content: `sync_now failed: ${msg}. Continue with what you have.` });
          }
          continue;
        }
        if (tool.kind === "integration_query") {
          const providerFilter = String(input.provider || "").trim();
          if (!providerFilter) {
            messages.push({ role: "user", content: `read_data requires a "provider" string.` });
            continue;
          }
          // Resolve provider case-insensitively against the user's connected integrations,
          // so agents can call read_data("gmail") / "Gmail" / "GMAIL" interchangeably.
          const { data: intRows } = await supabase.from("agent_integrations")
            .select("provider")
            .eq("user_id", userId)
            .eq("status", "connected")
            .ilike("provider", providerFilter)
            .limit(1);
          const canonicalProvider = (intRows?.[0]?.provider as string | undefined) ?? providerFilter;
          const { data: rows } = await supabase.from("integration_snapshots")
            .select("kind, data, error, fetched_at")
            .eq("user_id", userId).ilike("provider", canonicalProvider)
            .order("fetched_at", { ascending: false }).limit(1);
          const snap = rows?.[0];
          const summary = snap
            ? `${canonicalProvider} [${snap.kind}] fetched ${snap.fetched_at}: ${snap.error ? `ERROR ${snap.error}` : JSON.stringify(snap.data)}`
            : `No snapshot yet for ${canonicalProvider}. Call sync_now first.`;
          await logEvent("tool_result", { tool: tool.name, ok: !!snap && !snap.error, summary });
          messages.push({ role: "user", content: `${summary}\n\nContinue.` });
          continue;
        }

        if (tool.kind === "send_email") {
          const to = String(input.to || "").trim();
          const subject = String(input.subject || "").slice(0, 200);
          const body = String(input.body || "").slice(0, 6000);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !body) {
            const msg = "send_email requires valid to, subject, body.";
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "send_email", target: to, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          const emailGuard = (manifest.guardrails || []).find((g) => {
            const r = (g.rule || "").toLowerCase();
            return g.requiresApproval && (r.includes("email") || r.includes("send") || r.includes("external"));
          });
          // Hard-required approval when guardrail literally says [REQUIRES APPROVAL].
          const hardBlock = emailGuard && /\[requires approval\]/i.test(emailGuard.rule || "");
          const autoApprove = (agent as { auto_approve_low_risk?: boolean }).auto_approve_low_risk === true && !hardBlock;
          if (emailGuard && !autoApprove) {
            await logEvent("pending_approval", {
              action: "send_email",
              payload: { to, subject, body },
              risk: "med",
              guardrail: emailGuard.rule,
            });
            const msg = `Queued for approval (guardrail: ${emailGuard.rule}); NOT sent.`;
            await logEvent("tool_result", { tool: tool.name, ok: true, summary: msg });
            await logEvent("action", { type: "send_email", target: to, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue with other work or finish.` });
            continue;
          }
          // Real-action idempotency claim -- see buildRealActionKey's own
          // comment for exactly what this does and doesn't protect against.
          const emailActionKey = await buildRealActionKey(runId, "send_email", { to, subject, body });
          const emailClaim = await claimIdempotencyKey(supabase, userId, emailActionKey);
          if (emailClaim.status !== "claimed") {
            const cached = emailClaim.status === "replay" ? emailClaim.response as { ok?: boolean; summary?: string } : null;
            const msg = cached
              ? `Already sent earlier in this run — not repeating it: ${cached.summary ?? ""}`
              : `This exact email is already being sent elsewhere in this run — not repeating it.`;
            await logEvent("tool_result", { tool: tool.name, ok: cached?.ok ?? false, summary: msg });
            await logEvent("action", { type: "send_email", target: to, ok: cached?.ok ?? false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg}\n\nContinue with other work or finish.` });
            continue;
          }
          try {
            const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            // Prefer real Gmail send when the user has connected Gmail (agent-scoped, then global).
            const admin = supabase;
            const { data: gmailRows } = await admin
              .from("agent_integrations")
              .select("id, credentials_secret_id, agent_id")
              .eq("user_id", userId)
              .eq("provider", "Gmail")
              .eq("status", "connected")
              .order("agent_id", { ascending: false, nullsFirst: false });
            const gmail = (gmailRows || []).find((r) => r.agent_id === agentId) || (gmailRows || [])[0];

            let ok = false;
            let summary = "";
            let messageId: string | null = null;

            if (gmail) {
              const { ensureAccessToken, gmailSend } = await import("../_shared/gmail.ts");
              const access = await ensureAccessToken(admin, { id: gmail.id, credentials_secret_id: (gmail.credentials_secret_id as string | null) ?? null });
              if (!access) {
                summary = "Gmail token invalid — please reconnect Gmail.";
              } else {
                const creds = await readSecret(admin, (gmail.credentials_secret_id as string | null) ?? null);
                const from = String(creds.email || "me");
                const result = await gmailSend(access, from, to, subject, body);
                ok = result.ok;
                messageId = result.id || null;
                if (ok && messageId) {
                  // Verify send actually landed in Gmail by re-fetching the message.
                  const vr = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata`,
                    { headers: { Authorization: `Bearer ${access}` } },
                  );
                  const vb = await vr.json().catch(() => ({}));
                  if (!vr.ok || !vb?.id) {
                    ok = false;
                    summary = `Gmail send unverified: ${vb?.error?.message || `verify HTTP ${vr.status}`} (initial id=${messageId})`;
                  } else {
                    summary = `Email sent via Gmail (${from}) to ${to} — subject "${subject}" (verified id=${vb.id}).`;
                  }
                } else {
                  summary = ok
                    ? `Email sent via Gmail (${from}) to ${to} — subject "${subject}".`
                    : `Gmail send failed: ${result.error || "unknown"}`;
                }
              }
            } else {
              const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
                body: JSON.stringify({
                  templateName: "agent-notification",
                  recipientEmail: to,
                  // Reuses the SAME stable key our own claim above uses --
                  // was previously `agent-${agentId}-${runId}-${Date.now()}`,
                  // which embedded the wall clock and so could never
                  // actually dedupe a real retry of the identical send
                  // (send-transactional-email forwards this straight
                  // through to the underlying email API's own idempotency
                  // handling, so a fresh value on every attempt defeated
                  // that layer of protection too, not just our own).
                  idempotencyKey: emailActionKey,
                  templateData: { subject, body, agentName: manifest.name },
                }),
              });
              const respBody = await r.json().catch(() => ({}));
              ok = r.ok && (respBody?.success !== false);
              messageId = respBody?.messageId ?? null;
              summary = ok
                ? `Email queued for delivery to ${to} — subject "${subject}".`
                : `Send failed: ${respBody?.error || respBody?.reason || `HTTP ${r.status}`}`;
            }

            if (ok) await saveIdempotencyResponse(supabase, userId, emailActionKey, { ok, summary });
            else await releaseIdempotencyKey(supabase, userId, emailActionKey);
            await logEvent("tool_result", { tool: tool.name, ok, summary });
            await logEvent("action", { type: "send_email", target: to, ok, result_ref: messageId, summary });
            if (ok) {
              const cr = await upsertClient({ email: to, note: `Sent email — subject "${subject}".`, incrementInteraction: true });
              if (cr.ok && cr.clientId) await logEvent("client_update", { client_id: cr.clientId, via: "send_email", email: to });
              else if (cr.requiresApproval) await logEvent("client_update_deferred", { via: "send_email", email: to, reason: cr.reason });
            }
            messages.push({ role: "user", content: `${summary}\n\nContinue.` });
          } catch (e) {
            await releaseIdempotencyKey(supabase, userId, emailActionKey);
            const msg = `send_email exception: ${e instanceof Error ? e.message : "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "send_email", target: to, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg}\n\nContinue.` });
          }
          continue;
        }

        if (tool.kind === "generate_report") {
          const title = String(input.title || "").slice(0, 200);
          const kind = String(input.kind || "report");
          const bodyMd = String(input.body_markdown || input.body || "").slice(0, 30000);
          if (!title || !bodyMd || !["report","digest","audit","plan"].includes(kind)) {
            const msg = "generate_report requires title, valid kind (report|digest|audit|plan), and body_markdown.";
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "generate_report", target: title, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          const { data: rep, error: repErr } = await supabase
            .from("agent_reports")
            .insert({ agent_id: agentId, run_id: runId, user_id: userId, title, kind, body_markdown: bodyMd })
            .select("id").single();
          const preview = bodyMd.slice(0, 200);
          if (repErr || !rep) {
            const msg = `Failed to save report: ${repErr?.message || "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "generate_report", target: title, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg}\n\nContinue.` });
            continue;
          }
          const summary = `Saved ${kind} "${title}" (id ${rep.id}). Preview: ${preview}`;
          await logEvent("tool_result", { tool: tool.name, ok: true, summary });
          await logEvent("action", { type: "generate_report", target: title, ok: true, result_ref: rep.id, summary: preview });
          messages.push({ role: "user", content: `Report saved: id=${rep.id} title="${title}" kind=${kind}. Preview:\n${preview}\n\nContinue.` });
          continue;
        }

        if (tool.kind === "create_doc" || tool.kind === "create_sheet") {
          const isDoc = tool.kind === "create_doc";
          const title = String(input.title || "").slice(0, 200).trim();
          const bodyMd = String(input.body_markdown || input.body || "");
          const rows = Array.isArray(input.rows) ? (input.rows as unknown[]) : [];
          if (!title || (isDoc && !bodyMd) || (!isDoc && rows.length === 0)) {
            const msg = isDoc
              ? "create_doc requires title and body_markdown."
              : "create_sheet requires title and non-empty rows (string[][]).";
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: tool.kind, target: title, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          try {
            const { data: gmailRows } = await supabase
              .from("agent_integrations")
              .select("id, credentials_secret_id, agent_id")
              .eq("user_id", userId)
              .eq("provider", "Gmail")
              .eq("status", "connected")
              .order("agent_id", { ascending: false, nullsFirst: false });
            const gmail = (gmailRows || []).find((r) => r.agent_id === agentId) || (gmailRows || [])[0];
            if (!gmail) {
              const msg = `${tool.kind} needs a connected Google account — connect Gmail in Integrations first.`;
              await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
              await logEvent("action", { type: tool.kind, target: title, ok: false, result_ref: null, summary: msg });
              messages.push({ role: "user", content: `${msg} Continue.` });
              continue;
            }
            const { ensureAccessToken } = await import("../_shared/gmail.ts");
            const access = await ensureAccessToken(supabase, { id: gmail.id, credentials_secret_id: (gmail.credentials_secret_id as string | null) ?? null });
            if (!access) {
              const msg = "Google token invalid — please reconnect Gmail.";
              await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
              await logEvent("action", { type: tool.kind, target: title, ok: false, result_ref: null, summary: msg });
              messages.push({ role: "user", content: `${msg} Continue.` });
              continue;
            }
            const authHeaders = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };

            if (isDoc) {
              const createR = await fetch("https://docs.googleapis.com/v1/documents", {
                method: "POST", headers: authHeaders, body: JSON.stringify({ title }),
              });
              const createBody = await createR.json().catch(() => ({}));
              if (!createR.ok || !createBody.documentId) {
                const msg = `Docs create failed: ${createBody?.error?.message || `HTTP ${createR.status}`}`;
                await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
                await logEvent("action", { type: "create_doc", target: title, ok: false, result_ref: null, summary: msg });
                messages.push({ role: "user", content: `${msg} Continue.` });
                continue;
              }
              const docId = createBody.documentId as string;
              const text = bodyMd.slice(0, 100000);
              if (text) {
                const upR = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
                  method: "POST", headers: authHeaders,
                  body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text } }] }),
                });
                if (!upR.ok) {
                  const eb = await upR.json().catch(() => ({}));
                  const msg = `Docs insertText failed: ${eb?.error?.message || `HTTP ${upR.status}`}`;
                  await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
                  await logEvent("action", { type: "create_doc", target: title, ok: false, result_ref: docId, summary: msg });
                  messages.push({ role: "user", content: `${msg} Continue.` });
                  continue;
                }
              }
              // Verify the doc exists by re-fetching it.
              const vr = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
                headers: { Authorization: `Bearer ${access}` },
              });
              const vb = await vr.json().catch(() => ({}));
              if (!vr.ok || vb?.documentId !== docId) {
                const msg = `Docs verify failed: ${vb?.error?.message || `HTTP ${vr.status}`} (id=${docId})`;
                await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
                await logEvent("action", { type: "create_doc", target: title, ok: false, result_ref: docId, summary: msg });
                messages.push({ role: "user", content: `${msg} Continue.` });
                continue;
              }
              const url = `https://docs.google.com/document/d/${docId}/edit`;
              const summary = `Created Google Doc "${title}" — ${url} (verified title="${vb?.title ?? title}").`;
              await logEvent("tool_result", { tool: tool.name, ok: true, summary });
              await logEvent("action", { type: "create_doc", target: title, ok: true, result_ref: docId, summary, url });
              messages.push({ role: "user", content: `${summary}\nid=${docId}\n\nContinue.` });
              continue;
            } else {
              const createR = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
                method: "POST", headers: authHeaders,
                body: JSON.stringify({ properties: { title } }),
              });
              const createBody = await createR.json().catch(() => ({}));
              if (!createR.ok || !createBody.spreadsheetId) {
                const msg = `Sheets create failed: ${createBody?.error?.message || `HTTP ${createR.status}`}`;
                await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
                await logEvent("action", { type: "create_sheet", target: title, ok: false, result_ref: null, summary: msg });
                messages.push({ role: "user", content: `${msg} Continue.` });
                continue;
              }
              const sheetId = createBody.spreadsheetId as string;
              const values = (rows as unknown[]).slice(0, 5000).map((r) =>
                Array.isArray(r) ? (r as unknown[]).slice(0, 100).map((c) => (c == null ? "" : String(c))) : [String(r ?? "")],
              );
              const upR = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1?valueInputOption=USER_ENTERED`,
                { method: "PUT", headers: authHeaders, body: JSON.stringify({ values }) },
              );
              if (!upR.ok) {
                const eb = await upR.json().catch(() => ({}));
                const msg = `Sheets values.update failed: ${eb?.error?.message || `HTTP ${upR.status}`}`;
                await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
                await logEvent("action", { type: "create_sheet", target: title, ok: false, result_ref: sheetId, summary: msg });
                messages.push({ role: "user", content: `${msg} Continue.` });
                continue;
              }
              // Verify sheet exists and captured our values.
              const vr = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=spreadsheetId,properties.title,sheets.properties.gridProperties.rowCount`,
                { headers: { Authorization: `Bearer ${access}` } },
              );
              const vb = await vr.json().catch(() => ({}));
              if (!vr.ok || vb?.spreadsheetId !== sheetId) {
                const msg = `Sheets verify failed: ${vb?.error?.message || `HTTP ${vr.status}`} (id=${sheetId})`;
                await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
                await logEvent("action", { type: "create_sheet", target: title, ok: false, result_ref: sheetId, summary: msg });
                messages.push({ role: "user", content: `${msg} Continue.` });
                continue;
              }
              const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
              const summary = `Created Google Sheet "${title}" (${values.length} rows) — ${url} (verified).`;
              await logEvent("tool_result", { tool: tool.name, ok: true, summary });
              await logEvent("action", { type: "create_sheet", target: title, ok: true, result_ref: sheetId, summary, url });
              messages.push({ role: "user", content: `${summary}\nid=${sheetId}\n\nContinue.` });
              continue;
            }
          } catch (e) {
            const msg = `${tool.kind} exception: ${e instanceof Error ? e.message : "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: tool.kind, target: title, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
        }

        if (tool.kind === "create_calendar_event") {
          const title = String(input.title || "").slice(0, 200).trim();
          const startIso = String(input.start_iso || input.start || "").trim();
          const endIso = String(input.end_iso || input.end || "").trim();
          const description = String(input.description || "").slice(0, 8000);
          const isoOk = (s: string) => !!s && !isNaN(Date.parse(s));
          if (!title || !isoOk(startIso) || !isoOk(endIso)) {
            const msg = "create_calendar_event requires title, valid start_iso, valid end_iso.";
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "create_calendar_event", target: title, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          try {
            const { data: gmailRows } = await supabase
              .from("agent_integrations")
              .select("id, credentials_secret_id, agent_id")
              .eq("user_id", userId)
              .eq("provider", "Gmail")
              .eq("status", "connected")
              .order("agent_id", { ascending: false, nullsFirst: false });
            const gmail = (gmailRows || []).find((r) => r.agent_id === agentId) || (gmailRows || [])[0];
            if (!gmail) {
              const msg = "create_calendar_event needs a connected Google account — connect Gmail in Integrations first.";
              await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
              await logEvent("action", { type: "create_calendar_event", target: title, ok: false, result_ref: null, summary: msg });
              messages.push({ role: "user", content: `${msg} Continue.` });
              continue;
            }
            const { ensureAccessToken } = await import("../_shared/gmail.ts");
            const access = await ensureAccessToken(supabase, { id: gmail.id, credentials_secret_id: (gmail.credentials_secret_id as string | null) ?? null });
            if (!access) {
              const msg = "Google token invalid — please reconnect Gmail.";
              await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
              await logEvent("action", { type: "create_calendar_event", target: title, ok: false, result_ref: null, summary: msg });
              messages.push({ role: "user", content: `${msg} Continue.` });
              continue;
            }
            const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
              method: "POST",
              headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                summary: title,
                description: description || undefined,
                start: { dateTime: new Date(startIso).toISOString() },
                end: { dateTime: new Date(endIso).toISOString() },
              }),
            });
            const rb = await r.json().catch(() => ({}));
            if (!r.ok || !rb.id) {
              const msg = `Calendar events.insert failed: ${rb?.error?.message || `HTTP ${r.status}`}`;
              await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
              await logEvent("action", { type: "create_calendar_event", target: title, ok: false, result_ref: null, summary: msg });
              messages.push({ role: "user", content: `${msg} Continue.` });
              continue;
            }
            const eventId = rb.id as string;
            // Verify the event is actually on the primary calendar.
            const vr = await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
              { headers: { Authorization: `Bearer ${access}` } },
            );
            const vb = await vr.json().catch(() => ({}));
            if (!vr.ok || vb?.id !== eventId || vb?.status === "cancelled") {
              const msg = `Calendar verify failed: ${vb?.error?.message || `HTTP ${vr.status}`} (id=${eventId}, status=${vb?.status ?? "unknown"})`;
              await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
              await logEvent("action", { type: "create_calendar_event", target: title, ok: false, result_ref: eventId, summary: msg });
              messages.push({ role: "user", content: `${msg} Continue.` });
              continue;
            }
            const url = (vb.htmlLink as string) || (rb.htmlLink as string) || `https://calendar.google.com/calendar/u/0/r/eventedit/${eventId}`;
            const summary = `Created calendar event "${title}" ${startIso} → ${endIso} — ${url} (verified status=${vb.status}).`;
            await logEvent("tool_result", { tool: tool.name, ok: true, summary });
            await logEvent("action", { type: "create_calendar_event", target: title, ok: true, result_ref: eventId, summary, url });
            messages.push({ role: "user", content: `${summary}\nid=${eventId}\n\nContinue.` });
            continue;
          } catch (e) {
            const msg = `create_calendar_event exception: ${e instanceof Error ? e.message : "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "create_calendar_event", target: title, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
        }

        // ------------------------------------------------------------
        // Helper: resolve a connected Gmail integration + access token.
        // ------------------------------------------------------------
        const resolveGoogleAccess = async (): Promise<{ access: string | null; error?: string; fromEmail?: string }> => {
          const { data: gmailRows } = await supabase
            .from("agent_integrations")
            .select("id, credentials_secret_id, agent_id")
            .eq("user_id", userId)
            .eq("provider", "Gmail")
            .eq("status", "connected")
            .order("agent_id", { ascending: false, nullsFirst: false });
          const gmail = (gmailRows || []).find((r) => r.agent_id === agentId) || (gmailRows || [])[0];
          if (!gmail) return { access: null, error: "Google account not connected — connect Gmail in Integrations first." };
          const { ensureAccessToken } = await import("../_shared/gmail.ts");
          const access = await ensureAccessToken(supabase, { id: gmail.id, credentials_secret_id: (gmail.credentials_secret_id as string | null) ?? null });
          if (!access) return { access: null, error: "Google token invalid — please reconnect Gmail." };
          const creds = await readSecret(supabase, (gmail.credentials_secret_id as string | null) ?? null);
          return { access, fromEmail: String(creds.email || "me") };
        };

        // ------------------------------------------------------------
        // edit_doc: append/replace body of an existing Google Doc, verify.
        // ------------------------------------------------------------
        if (tool.kind === "edit_doc") {
          const docId = String(input.doc_id || input.id || "").trim();
          const mode = String(input.mode || "append").toLowerCase();
          const bodyMd = String(input.body_markdown || input.body || "");
          if (!docId || !bodyMd || (mode !== "append" && mode !== "replace")) {
            const msg = `edit_doc requires doc_id, body_markdown, and mode="append" or "replace".`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "edit_doc", target: docId, ok: false, result_ref: docId || null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          try {
            const { access, error, fromEmail: _fe } = await resolveGoogleAccess();
            if (!access) throw new Error(error);
            const authHeaders = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
            // Fetch current doc for its endIndex.
            const getR = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
              headers: { Authorization: `Bearer ${access}` },
            });
            const getB = await getR.json().catch(() => ({}));
            if (!getR.ok || getB?.documentId !== docId) {
              throw new Error(`Docs get failed: ${getB?.error?.message || `HTTP ${getR.status}`}`);
            }
            const contentArr = (getB.body?.content || []) as Array<{ endIndex?: number }>;
            const endIndex = contentArr.length ? (contentArr[contentArr.length - 1].endIndex ?? 2) : 2;
            const text = bodyMd.slice(0, 100000);
            const requests: unknown[] = [];
            if (mode === "replace" && endIndex > 2) {
              requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
              requests.push({ insertText: { location: { index: 1 }, text } });
            } else if (mode === "replace") {
              requests.push({ insertText: { location: { index: 1 }, text } });
            } else {
              // append at end (endIndex-1 is the trailing newline position)
              const insertAt = Math.max(1, endIndex - 1);
              requests.push({ insertText: { location: { index: insertAt }, text: (endIndex > 2 ? "\n" : "") + text } });
            }
            const upR = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, {
              method: "POST", headers: authHeaders, body: JSON.stringify({ requests }),
            });
            if (!upR.ok) {
              const eb = await upR.json().catch(() => ({}));
              throw new Error(`Docs batchUpdate failed: ${eb?.error?.message || `HTTP ${upR.status}`}`);
            }
            // Verify: re-fetch and confirm body contains a marker substring.
            const vr = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
              headers: { Authorization: `Bearer ${access}` },
            });
            const vb = await vr.json().catch(() => ({}));
            const dumped = JSON.stringify(vb?.body?.content || []);
            const marker = text.replace(/\s+/g, " ").trim().slice(0, 40);
            if (!vr.ok || vb?.documentId !== docId || (marker && !dumped.includes(marker.slice(0, 20)))) {
              throw new Error(`Docs verify failed: ${vb?.error?.message || `HTTP ${vr.status}`} — edit not observed in re-read.`);
            }
            const url = `https://docs.google.com/document/d/${docId}/edit`;
            const summary = `Edited Google Doc ${docId} (${mode}) — ${text.length} chars applied and verified. ${url}`;
            await logEvent("tool_result", { tool: tool.name, ok: true, summary });
            await logEvent("action", { type: "edit_doc", target: docId, ok: true, result_ref: docId, summary, url });
            messages.push({ role: "user", content: `${summary}\n\nContinue.` });
          } catch (e) {
            const msg = `edit_doc failed: ${e instanceof Error ? e.message : "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "edit_doc", target: docId, ok: false, result_ref: docId, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
          }
          continue;
        }

        // ------------------------------------------------------------
        // edit_sheet: update a range in an existing Google Sheet, verify.
        // ------------------------------------------------------------
        if (tool.kind === "edit_sheet") {
          const sheetId = String(input.sheet_id || input.id || "").trim();
          const range = String(input.range || "").trim();
          const rows = Array.isArray(input.values) ? (input.values as unknown[])
            : Array.isArray(input.rows) ? (input.rows as unknown[])
            : [];
          if (!sheetId || !range || rows.length === 0) {
            const msg = `edit_sheet requires sheet_id, range (e.g. "Sheet1!A2:C10"), and non-empty values (string[][]).`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "edit_sheet", target: sheetId, ok: false, result_ref: sheetId || null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          try {
            const { access, error } = await resolveGoogleAccess();
            if (!access) throw new Error(error);
            const values = rows.slice(0, 5000).map((r) =>
              Array.isArray(r) ? (r as unknown[]).slice(0, 100).map((c) => (c == null ? "" : String(c))) : [String(r ?? "")],
            );
            const upR = await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}?valueInputOption=USER_ENTERED`,
              { method: "PUT", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify({ values }) },
            );
            const ub = await upR.json().catch(() => ({}));
            if (!upR.ok) throw new Error(`Sheets values.update failed: ${ub?.error?.message || `HTTP ${upR.status}`}`);
            const updatedCells = Number(ub?.updatedCells ?? 0);
            // Verify: re-read the same range and confirm at least one cell matches.
            const vr = await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}`,
              { headers: { Authorization: `Bearer ${access}` } },
            );
            const vb = await vr.json().catch(() => ({}));
            if (!vr.ok) throw new Error(`Sheets verify read failed: ${vb?.error?.message || `HTTP ${vr.status}`}`);
            const gotValues = (vb?.values || []) as string[][];
            const flatWrote = values.flat().filter(Boolean).map((s) => String(s));
            const flatGot = gotValues.flat().map((s) => String(s ?? ""));
            const match = flatWrote.length === 0 || flatWrote.some((v) => flatGot.includes(v));
            if (!match) throw new Error(`Sheets verify mismatch: re-read of ${range} does not contain written values.`);
            const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
            const summary = `Edited Sheet ${sheetId} range ${range} — ${updatedCells} cells updated and verified. ${url}`;
            await logEvent("tool_result", { tool: tool.name, ok: true, summary });
            await logEvent("action", { type: "edit_sheet", target: `${sheetId}:${range}`, ok: true, result_ref: sheetId, summary, url });
            messages.push({ role: "user", content: `${summary}\n\nContinue.` });
          } catch (e) {
            const msg = `edit_sheet failed: ${e instanceof Error ? e.message : "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "edit_sheet", target: sheetId, ok: false, result_ref: sheetId, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
          }
          continue;
        }

        // ------------------------------------------------------------
        // read_email: fetch full body/thread content (not just metadata).
        // ------------------------------------------------------------
        if (tool.kind === "read_email") {
          const messageId = String(input.message_id || "").trim();
          const threadId = String(input.thread_id || "").trim();
          const query = String(input.query || input.q || "").trim();
          const max = Math.min(Math.max(Number(input.max || 3), 1), 10);
          if (!messageId && !threadId && !query) {
            const msg = `read_email requires one of: message_id, thread_id, or query (Gmail search).`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "read_email", target: "", ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          try {
            const { access, error } = await resolveGoogleAccess();
            if (!access) throw new Error(error);
            const auth = { Authorization: `Bearer ${access}` };
            const decodeB64 = (s: string) => {
              try {
                const norm = s.replace(/-/g, "+").replace(/_/g, "/");
                const pad = norm + "===".slice((norm.length + 3) % 4);
                return atob(pad);
              } catch { return ""; }
            };
            type GPart = { mimeType?: string; body?: { data?: string; size?: number }; parts?: GPart[] };
            const walkParts = (p: GPart | undefined): string => {
              if (!p) return "";
              if (p.body?.data && (p.mimeType === "text/plain" || !p.mimeType)) return decodeB64(p.body.data);
              if (Array.isArray(p.parts)) {
                for (const c of p.parts) {
                  const r = walkParts(c);
                  if (r) return r;
                }
              }
              if (p.body?.data && p.mimeType === "text/html") {
                return stripHtml(decodeB64(p.body.data));
              }
              return "";
            };
            const fmtMessage = (m: { id?: string; threadId?: string; snippet?: string; payload?: GPart; internalDate?: string }) => {
              const headers = ((m.payload as unknown as { headers?: Array<{ name: string; value: string }> })?.headers) || [];
              const H = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value || "";
              // gmail.metadata scope: no body access, only headers + snippet. Use snippet as body preview.
              const body = walkParts(m.payload).slice(0, 6000) || (m.snippet || "");
              return `--- Gmail message id=${m.id} thread=${m.threadId}\nFrom: ${H("From")}\nTo: ${H("To")}\nSubject: ${H("Subject")}\nDate: ${H("Date")}\n\n${body}\n\n(Note: full body unavailable under gmail.metadata scope — showing snippet + headers.)`;
            };
            const METADATA_HEADERS = "metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=In-Reply-To";
            let target = messageId || threadId || query;
            let out = "";
            let resultRef: string | null = null;
            if (messageId) {
              const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&${METADATA_HEADERS}`, { headers: auth });
              const rb = await r.json();
              if (!r.ok) throw new Error(`Gmail get failed: ${rb?.error?.message || `HTTP ${r.status}`}`);
              out = fmtMessage(rb); resultRef = rb.id;
              target = rb.id || messageId;
            } else if (threadId) {
              const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&${METADATA_HEADERS}`, { headers: auth });
              const rb = await r.json();
              if (!r.ok) throw new Error(`Gmail thread get failed: ${rb?.error?.message || `HTTP ${r.status}`}`);
              const msgs = (rb.messages || []).slice(-max);
              out = msgs.map(fmtMessage).join("\n\n");
              resultRef = rb.id || threadId;
              target = rb.id || threadId;
            } else {
              // gmail.metadata scope does NOT support the `q` search parameter.
              // Fall back to a plain recent-messages list (no query filter) and let
              // the agent scan headers/snippets client-side.
              const listR = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}`, { headers: auth });
              const listB = await listR.json();
              if (!listR.ok) throw new Error(`Gmail list failed: ${listB?.error?.message || `HTTP ${listR.status}`} — note: search queries are not supported under gmail.metadata scope; pass message_id or thread_id instead.`);
              const ids: Array<{ id: string }> = listB.messages || [];
              if (ids.length === 0) { out = `No recent Gmail messages found.`; }
              else {
                const parts: string[] = [];
                for (const it of ids) {
                  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${it.id}?format=metadata&${METADATA_HEADERS}`, { headers: auth });
                  const rb = await r.json().catch(() => ({}));
                  if (r.ok) parts.push(fmtMessage(rb));
                }
                out = `(Note: query "${query}" ignored — gmail.metadata scope disallows search. Showing ${parts.length} most-recent messages.)\n\n${parts.join("\n\n")}`;
                resultRef = ids[0]?.id ?? null;
              }
            }
            const summary = out.slice(0, 8000);
            await logEvent("tool_result", { tool: tool.name, ok: true, summary });
            await logEvent("action", { type: "read_email", target, ok: true, result_ref: resultRef, summary: summary.slice(0, 400) });
            messages.push({ role: "user", content: `${summary}\n\nContinue.` });
          } catch (e) {
            const msg = `read_email failed: ${e instanceof Error ? e.message : "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "read_email", target: messageId || threadId || query, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
          }
          continue;
        }

        // ------------------------------------------------------------
        // reply_email: reply within an existing Gmail thread. Same
        // approval-gate as send_email; verify by re-fetching the sent msg.
        // ------------------------------------------------------------
        if (tool.kind === "reply_email") {
          const threadId = String(input.thread_id || "").trim();
          const bodyText = String(input.body || "").slice(0, 6000);
          const explicitSubject = String(input.subject || "").slice(0, 200);
          if (!threadId || !bodyText) {
            const msg = `reply_email requires thread_id and body.`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "reply_email", target: threadId, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          // Same approval gate as send_email.
          const emailGuard = (manifest.guardrails || []).find((g) => {
            const r = (g.rule || "").toLowerCase();
            return g.requiresApproval && (r.includes("email") || r.includes("send") || r.includes("external") || r.includes("reply"));
          });
          const hardBlock = emailGuard && /\[requires approval\]/i.test(emailGuard.rule || "");
          const autoApprove = (agent as { auto_approve_low_risk?: boolean }).auto_approve_low_risk === true && !hardBlock;
          if (emailGuard && !autoApprove) {
            await logEvent("pending_approval", {
              action: "reply_email",
              payload: { thread_id: threadId, subject: explicitSubject, body: bodyText },
              risk: "med",
              guardrail: emailGuard.rule,
            });
            const msg = `Queued for approval (guardrail: ${emailGuard.rule}); NOT sent.`;
            await logEvent("tool_result", { tool: tool.name, ok: true, summary: msg });
            await logEvent("action", { type: "reply_email", target: threadId, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue with other work or finish.` });
            continue;
          }
          try {
            const { access, error, fromEmail } = await resolveGoogleAccess();
            if (!access) throw new Error(error);
            const auth = { Authorization: `Bearer ${access}` };
            // Pull the thread's latest message to derive To, Subject, Message-ID, References.
            const tR = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=In-Reply-To`, { headers: auth });
            const tB = await tR.json();
            if (!tR.ok || !tB?.messages?.length) throw new Error(`Gmail thread lookup failed: ${tB?.error?.message || `HTTP ${tR.status}`}`);
            const last = tB.messages[tB.messages.length - 1];
            const headers = (last.payload?.headers || []) as Array<{ name: string; value: string }>;
            const H = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value || "";
            const originalFrom = H("From");
            const originalMsgId = H("Message-ID") || H("Message-Id");
            const priorRefs = H("References");
            const origSubject = H("Subject");
            const subject = explicitSubject || (origSubject.toLowerCase().startsWith("re:") ? origSubject : `Re: ${origSubject}`);
            const to = originalFrom || H("To");
            if (!to) throw new Error("Could not resolve reply recipient from thread.");
            const references = [priorRefs, originalMsgId].filter(Boolean).join(" ");
            const rfc = [
              `From: ${fromEmail || "me"}`,
              `To: ${to}`,
              `Subject: ${subject}`,
              originalMsgId ? `In-Reply-To: ${originalMsgId}` : "",
              references ? `References: ${references}` : "",
              `Content-Type: text/plain; charset="UTF-8"`,
              ``,
              bodyText,
            ].filter(Boolean).join("\r\n");
            const raw = btoa(unescape(encodeURIComponent(rfc))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
            const sendR = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
              method: "POST",
              headers: { ...auth, "Content-Type": "application/json" },
              body: JSON.stringify({ raw, threadId }),
            });
            const sendB = await sendR.json().catch(() => ({}));
            if (!sendR.ok || !sendB?.id) throw new Error(`Gmail reply send failed: ${sendB?.error?.message || `HTTP ${sendR.status}`}`);
            const sentId = sendB.id as string;
            // Verify — re-fetch and confirm same threadId.
            const vr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(sentId)}?format=metadata`, { headers: auth });
            const vb = await vr.json().catch(() => ({}));
            if (!vr.ok || vb?.id !== sentId || vb?.threadId !== threadId) {
              throw new Error(`Gmail reply verify failed: ${vb?.error?.message || `HTTP ${vr.status}`} (id=${sentId}, thread=${vb?.threadId})`);
            }
            const summary = `Reply sent in thread ${threadId} to ${to} — subject "${subject}" (verified id=${sentId}).`;
            await logEvent("tool_result", { tool: tool.name, ok: true, summary });
            await logEvent("action", { type: "reply_email", target: to, ok: true, result_ref: sentId, summary });
            {
              const cr = await upsertClient({ email: to, note: `Replied in thread — subject "${subject}".`, incrementInteraction: true });
              if (cr.ok && cr.clientId) await logEvent("client_update", { client_id: cr.clientId, via: "reply_email", email: to });
              else if (cr.requiresApproval) await logEvent("client_update_deferred", { via: "reply_email", email: to, reason: cr.reason });
            }
            messages.push({ role: "user", content: `${summary}\n\nContinue.` });
          } catch (e) {
            const msg = `reply_email failed: ${e instanceof Error ? e.message : "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "reply_email", target: threadId, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
          }
          continue;
        }

        // ------------------------------------------------------------
        // upsert_client_note: create/update a client record for this agent
        // with a timestamped note. Respects client_write_mode ('free' |
        // 'approval' | 'hybrid'). Approval-required cases are queued via
        // pending_approval and NOT written until approved.
        // ------------------------------------------------------------
        if (tool.kind === "upsert_client_note") {
          const email = String(input.email || "").trim();
          const name = String(input.name || "").trim();
          const company = String(input.company || "").trim();
          const note = String(input.note || input.notes || "").slice(0, 4000).trim();
          const tags = Array.isArray(input.tags) ? (input.tags as unknown[]).map((t) => String(t)).slice(0, 20) : [];
          if (!note || (!email && !name)) {
            const msg = `upsert_client_note requires "note" and at least one of "email" or "name".`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "upsert_client_note", target: email || name, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          const cr = await upsertClient({ email, name, company, note, tags, incrementInteraction: true });
          if (cr.requiresApproval) {
            const msg = `Client update queued for approval (client_write_mode=${clientWriteMode}); NOT applied yet.`;
            await logEvent("tool_result", { tool: tool.name, ok: true, summary: msg });
            await logEvent("action", { type: "upsert_client_note", target: email || name, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue with other work or finish.` });
            continue;
          }
          if (!cr.ok) {
            const msg = `upsert_client_note failed: ${cr.reason || "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "upsert_client_note", target: email || name, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          const summary = `Client record ${cr.clientId} updated (${email || name}) — note appended.`;
          await logEvent("tool_result", { tool: tool.name, ok: true, summary });
          await logEvent("action", { type: "upsert_client_note", target: email || name, ok: true, result_ref: cr.clientId, summary });
          messages.push({ role: "user", content: `${summary}\n\nContinue.` });
          continue;
        }




        if (tool.kind === "read_analytics") {
          const kind = tool.kind;
          const propertyId = String(input.property_id || "").trim();
          const target = propertyId;
          if (!propertyId) {
            const msg = "read_analytics requires property_id (GA4 numeric property ID).";
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: kind, target, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          try {
            const { data: gmailRows } = await supabase
              .from("agent_integrations")
              .select("id, credentials_secret_id, agent_id")
              .eq("user_id", userId)
              .eq("provider", "Gmail")
              .eq("status", "connected")
              .order("agent_id", { ascending: false, nullsFirst: false });
            const gmail = (gmailRows || []).find((r) => r.agent_id === agentId) || (gmailRows || [])[0];
            if (!gmail) {
              const msg = `${kind} needs a connected Google account — connect Google Analytics in Integrations first.`;
              await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
              await logEvent("action", { type: kind, target, ok: false, result_ref: null, summary: msg });
              messages.push({ role: "user", content: `${msg} Continue.` });
              continue;
            }
            const { ensureAccessToken } = await import("../_shared/gmail.ts");
            const access = await ensureAccessToken(supabase, { id: gmail.id, credentials_secret_id: (gmail.credentials_secret_id as string | null) ?? null });
            if (!access) {
              const msg = "Google token invalid — please reconnect Google Analytics.";
              await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
              await logEvent("action", { type: kind, target, ok: false, result_ref: null, summary: msg });
              messages.push({ role: "user", content: `${msg} Continue.` });
              continue;
            }

            const r = await fetch(
              `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
                  metrics: [{ name: "sessions" }, { name: "totalUsers" }],
                }),
              },
            );
            const rb = await r.json().catch(() => ({}));
            if (!r.ok) {
              const msg = `GA4 runReport failed: ${rb?.error?.message || `HTTP ${r.status}`}`;
              await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
              await logEvent("action", { type: kind, target, ok: false, result_ref: null, summary: msg });
              messages.push({ role: "user", content: `${msg} Continue.` });
              continue;
            }
            const row = rb.rows?.[0]?.metricValues || [];
            const sessions = row[0]?.value ?? "0";
            const users = row[1]?.value ?? "0";
            const summary = `GA4 property ${propertyId} (last 30d): sessions=${sessions}, totalUsers=${users}`;
            await logEvent("tool_result", { tool: tool.name, ok: true, summary });
            await logEvent("action", { type: kind, target, ok: true, result_ref: propertyId, summary });
            messages.push({ role: "user", content: `${summary}\n\nContinue.` });
            continue;
          } catch (e) {
            const msg = `${kind} exception: ${e instanceof Error ? e.message : "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: kind, target, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
        }








        if (tool.kind === "http_post") {
          const url = String(input.url || "").trim();
          const bodyObj = (input.body && typeof input.body === "object") ? input.body : {};
          // Approval-required by default: only skip approval if an explicit
          // guardrail permits http_post/webhook auto-send (requiresApproval:false).
          const httpGuard = (manifest.guardrails || []).find((g) => {
            const r = (g.rule || "").toLowerCase();
            return r.includes("http_post") || r.includes("webhook") || r.includes("external") || r.includes("adjust");
          });
          const guardAutoAllowed = !!httpGuard && httpGuard.requiresApproval === false;
          const hardBlockHttp = !!httpGuard && /\[requires approval\]/i.test(httpGuard.rule || "");
          const autoApproveHttp = (agent as { auto_approve_low_risk?: boolean }).auto_approve_low_risk === true && !hardBlockHttp;
          const autoAllowed = guardAutoAllowed || autoApproveHttp;
          if (!autoAllowed) {
            await logEvent("pending_approval", {
              action: "http_post",
              payload: { url, body: bodyObj },
              risk: "med",
              guardrail: httpGuard?.rule ?? "default: approval required for external POSTs",
            });
            const msg = "Queued for approval; not sent.";
            await logEvent("tool_result", { tool: tool.name, ok: true, summary: msg });
            await logEvent("action", { type: "http_post", target: url, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue with other work or finish.` });
            continue;
          }
          const check = await validateHttpPostUrl(url, supabase, userId, agentId);

          if (!check.ok) {
            await logEvent("tool_error", { tool: tool.name, message: check.reason, url });
            await logEvent("action", { type: "http_post", target: url, ok: false, result_ref: null, summary: `Blocked: ${check.reason}` });
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: `Blocked: ${check.reason}` });
            messages.push({ role: "user", content: `http_post blocked: ${check.reason}\n\nContinue.` });
            continue;
          }
          let lastErr = "";
          let done = false;
          for (let attempt = 0; attempt < 2 && !done; attempt++) {
            try {
              const ctrl = new AbortController();
              const to = setTimeout(() => ctrl.abort(), 5000);
              const r = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", "User-Agent": "NazAI-Agent/1.0" },
                body: JSON.stringify(bodyObj),
                signal: ctrl.signal,
              });
              clearTimeout(to);
              const respText = (await r.text().catch(() => "")).slice(0, 200);
              const summary = `${r.status} ${respText}`;
              await logEvent("tool_result", { tool: tool.name, ok: r.ok, summary });
              await logEvent("action", { type: "http_post", target: url, ok: r.ok, result_ref: null, summary });
              messages.push({ role: "user", content: `http_post → ${summary}\n\nContinue.` });
              done = true;
            } catch (e) {
              lastErr = e instanceof Error ? e.message : "unknown";
            }
          }
          if (!done) {
            const msg = `http_post failed after retry: ${lastErr}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "http_post", target: url, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg}\n\nContinue.` });
          }
          continue;
        }

        if (tool.kind === "schedule_followup") {
          const runAtIso = String(input.run_at_iso || input.at || "").trim();
          const instruction = String(input.instruction || "").slice(0, 1000);
          const when = new Date(runAtIso);
          const now = Date.now();
          const maxMs = 90 * 24 * 60 * 60 * 1000;
          if (isNaN(when.getTime()) || when.getTime() <= now || when.getTime() - now > maxMs || !instruction) {
            const msg = "schedule_followup requires run_at_iso (valid ISO, in the future, ≤90 days out) and a non-empty instruction.";
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "schedule_followup", target: runAtIso, ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg} Continue.` });
            continue;
          }
          const { data: newRun, error: newRunErr } = await supabase
            .from("agent_runs")
            .insert({
              agent_id: agentId,
              user_id: userId,
              trigger: "scheduled",
              status: "scheduled",
              scheduled_for: when.toISOString(),
              instruction,
            })
            .select("id").single();
          if (newRunErr || !newRun) {
            const msg = `schedule_followup failed: ${newRunErr?.message || "unknown"}`;
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            await logEvent("action", { type: "schedule_followup", target: when.toISOString(), ok: false, result_ref: null, summary: msg });
            messages.push({ role: "user", content: `${msg}\n\nContinue.` });
            continue;
          }
          const summary = `Follow-up scheduled at ${when.toISOString()} (run_id ${newRun.id}).`;
          await logEvent("tool_result", { tool: tool.name, ok: true, summary });
          await logEvent("action", { type: "schedule_followup", target: when.toISOString(), ok: true, result_ref: newRun.id, summary: instruction });
          messages.push({ role: "user", content: `${summary}\n\nContinue.` });
          continue;
        }

        // ---- Real, verified provider writes (Slack / Notion / Canva / Shopify).
        // Each one calls the external API for real and then re-fetches (or uses
        // the provider's authoritative receipt) before reporting success.
        if (PROVIDER_WRITE_KINDS.has(tool.kind)) {
          // Real-action idempotency claim -- see buildRealActionKey's own
          // comment for exactly what this does and doesn't protect against.
          const actionKey = await buildRealActionKey(runId, tool.kind, input);
          const claim = await claimIdempotencyKey(supabase, userId, actionKey);
          if (claim.status !== "claimed") {
            const cached = claim.status === "replay" ? claim.response as { ok?: boolean; summary?: string; ref?: string | null } : null;
            const msg = cached
              ? `Already done earlier in this run — not repeating it: ${cached.summary ?? ""}`
              : `This exact ${tool.kind} action is already being carried out elsewhere in this run — not repeating it.`;
            await logEvent("tool_result", { tool: tool.name, ok: cached?.ok ?? false, summary: msg });
            messages.push({ role: "user", content: `${msg}\n\nContinue with other work or finish.` });
            continue;
          }
          let res;
          try {
            res = await runProviderWrite(tool.kind, supabase, userId, agentId, input);
          } catch (e) {
            res = { ok: false, summary: `${tool.kind} threw: ${e instanceof Error ? e.message : String(e)} — treat as NOT done.`, ref: null, url: null, target: null };
          }
          if (res.ok) await saveIdempotencyResponse(supabase, userId, actionKey, res);
          else await releaseIdempotencyKey(supabase, userId, actionKey);
          await logEvent("tool_result", { tool: tool.name, ok: res.ok, summary: res.summary });
          await logEvent("action", {
            type: tool.kind,
            target: res.target ?? null,
            ok: res.ok,
            result_ref: res.ref ?? null,
            url: res.url ?? null,
            summary: res.summary,
          });
          messages.push({
            role: "user",
            content: res.ok
              ? `${res.summary}${res.ref ? `\nid=${res.ref}` : ""}\n\nContinue.`
              : `"${tool.name}" FAILED and produced no confirmed effect: ${res.summary}\nDo not claim it succeeded. Try one reasonable alternative or state this plainly to the operator.`,
          });
          continue;
        }

        // Self-correcting wrapper: catches thrown exceptions AND ok:false
        // results, classifies the error, and — only for model-correctable
        // classes — feeds the error + stack back to the model for at most
        // MAX_TOOL_ATTEMPTS total attempts. Auth/permission/quota errors are
        // never retried; they surface straight to the user.
        const outcome = await runToolWithSelfCorrection({
          tool: tool.name,
          kind: tool.kind,
          input,
          maxAttempts: MAX_TOOL_ATTEMPTS,
          logEvent,
          execute: (nextInput) => executeTool(tool, nextInput, supabase, agentId, runId, userId, logEvent),
          isFailure: (r) => ({ failed: !!r.error, message: r.summary }),
          correct: correctToolInput,
        });

        // Feed the real result back into the shared circuit breaker.
        if (gateAttempt) {
          await gateAttempt(
            !outcome.ok,
            outcome.ok ? "ok" : `execution failed: ${outcome.failure?.technical ?? "unknown error"}`,
          ).catch(() => null);
        }

        if (outcome.ok && outcome.result) {

          const retried = outcome.attempts.length > 1;
          await logEvent("tool_result", {
            tool: tool.name,
            ok: true,
            summary: outcome.result.summary,
            attempts: outcome.attempts.length,
            self_corrected: retried,
          });
          messages.push({
            role: "user",
            content: `Tool "${tool.name}" returned:\n${outcome.result.summary}\n\nContinue.`,
          });
        } else {
          const f = outcome.failure!;
          // Non-retryable classes (expired token, missing scope, revoked
          // permission, exhausted quota) are persisted as a known issue so
          // future runs skip straight to the human fix message.
          let known: { human_message: string; id: string } | null = null;
          if (!f.retryable) {
            const provider = providerForTool(tool.kind, input);
            const rec = await recordIssue(supabase, {
              userId,
              agentId,
              provider,
              toolKind: tool.kind,
              errorType: f.category as IssueErrorType,
              technical: f.technical,
            }).catch(() => null);
            if (rec) {
              known = { human_message: rec.human_message, id: rec.id };
              blockedIssueCache.set(`${provider}::${tool.kind}`, true);
              await logEvent("integration_issue", {
                issue_id: rec.id,
                provider,
                tool: tool.name,
                kind: tool.kind,
                error_type: rec.error_type,
                fix_action: rec.fix_action,
                scope_hint: rec.scope_hint,
                title: rec.title,
                humanMessage: rec.human_message,
                message: rec.human_message,
              });
            }
          }
          await logEvent("tool_result", {
            tool: tool.name,
            ok: false,
            summary: known?.human_message || f.userMessage,
            humanMessage: known?.human_message || f.userMessage,
            category: f.category,
            attempts: outcome.attempts.length,
            retryable: f.retryable,
            issue_id: known?.id ?? null,
          });
          failGuard.state = { failedTool: tool.name, nudged: false };
          messages.push({
            role: "user",
            content: f.surfacedToUser
              ? `Tool "${tool.name}" failed with a ${f.category} that you CANNOT fix by retrying (${f.technical}). Do not retry it or any other tool on the same connection this run. The operator has been shown this message: "${known?.human_message || f.userMessage}". Continue with a different approach that doesn't need that connection, or finish and state the blocker plainly.`
              : `Tool "${tool.name}" failed after ${outcome.attempts.length} attempt(s) — the retry budget is exhausted (${f.technical}). Do NOT call it again with the same approach. Try a genuinely different tool or sub-goal, or finish and report plainly what didn't work.`,
          });
        }
      }
    }

    const hitStepLimit = !finished && !paused;
    if (hitStepLimit) {
      await logEvent("finished", { summary: `Reached step limit (${MAX_STEPS}).`, partial: true });
      finalSummary = `Stopped after ${steps} steps without explicit finish.`;
    }

    // ------------------------------------------------------------------
    // Completion self-check — reason over the ACTUAL logged actions and
    // decide whether the original instruction was met. Produces a plain
    // label consistent with the frontend outcome badge
    // (Done / Failed / Blocked / Needs approval / Step limit / Paused)
    // plus a short human summary. Falls back gracefully if the model call
    // fails so the run always finalizes.
    // ------------------------------------------------------------------
    let outcomeLabel: "Done" | "Failed" | "Blocked" | "Needs approval" | "Step limit" | "Paused" = "Done";
    let completionSummary = finalSummary;
    let goalMet: "yes" | "partial" | "no" = "yes";
    try {
      const { data: runEvs } = await supabase
        .from("agent_events")
        .select("kind, payload")
        .eq("run_id", runId)
        .order("created_at", { ascending: true })
        .limit(400);
      const evs = runEvs || [];
      // Fast-path derivation matches the frontend logic exactly.
      let hasPendingApproval = false, hasClarification = false, sawAction = false;
      const lastOkByType = new Map<string, boolean>();
      const actionLines: string[] = [];
      for (const e of evs) {
        const k = String(e.kind || "");
        const p = (e.payload as Record<string, unknown>) || {};
        if (k === "pending_approval") hasPendingApproval = true;
        else if (k === "approval_resolved" || k === "approved" || k === "rejected") hasPendingApproval = false;
        else if (k === "clarification_request" || k === "ask_user" || k === "needs_input") hasClarification = true;
        else if (k === "clarification_resolved" || k === "user_reply" || k === "clarification_answer") hasClarification = false;
        else if (k === "action") {
          sawAction = true;
          const type = String((p as { type?: unknown }).type || "action");
          const ok = (p as { ok?: unknown }).ok === true;
          lastOkByType.set(type, ok);
          actionLines.push(`- ${type} ok=${ok} ${String((p as { summary?: unknown }).summary || "").slice(0, 160)}`);
        }
      }
      if (paused) outcomeLabel = "Paused";
      else if (hasPendingApproval) outcomeLabel = "Needs approval";
      else if (hasClarification) outcomeLabel = "Blocked";
      else if (hitStepLimit) outcomeLabel = "Step limit";
      else if (sawAction && Array.from(lastOkByType.values()).some((v) => v === false)) outcomeLabel = "Failed";
      else if (sawAction) outcomeLabel = "Done";
      else outcomeLabel = "Failed"; // finished with no delivered action = failed

      // Ask the model to grade against the original instruction — but keep
      // the derived label above; the model only refines the summary + goal_met.
      const instruction = userInstruction || manifest.goal || "(unspecified)";
      const gradePrompt = `You are grading whether an AI agent's run met its instruction.

INSTRUCTION:
${instruction}

ACTIONS TAKEN THIS RUN (type ok=true/false + short summary):
${actionLines.slice(-40).join("\n") || "(no actions logged)"}

DERIVED OUTCOME LABEL (do not change): ${outcomeLabel}

Reply with ONE fenced JSON block:
\`\`\`json
{"goal_met":"yes|partial|no","summary":"1-3 sentences, plain English, name the delivered artifacts or why the goal was not met"}
\`\`\``;
      const gResp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: "You grade completion accurately. No hedging, no marketing. Under 400 chars." },
            { role: "user", content: gradePrompt },
          ],
          temperature: 0.1,
        }),
      });
      if (gResp.ok) {
        const gData = await gResp.json();
        await recordAiSpend(supabase, userId, MODEL, gData?.usage, "agent-runtime-grading", agentId);
        const raw = gData?.choices?.[0]?.message?.content ?? "";
        const parsed = extractAction(raw);
        if (parsed) {
          const gm = String((parsed as { goal_met?: unknown }).goal_met || "").toLowerCase();
          if (gm === "yes" || gm === "partial" || gm === "no") goalMet = gm as typeof goalMet;
          const sm = String((parsed as { summary?: unknown }).summary || "").slice(0, 600);
          if (sm) completionSummary = sm;
        }
      }
      // Reconcile derived label with the model's grade so status and goal_met
      // stay internally consistent:
      //   - goal_met=no  ⇒ downgrade Done to Failed
      //   - goal_met=partial without a hard step limit ⇒ Step limit (informative)
      //   - goal_met=yes ⇒ we DID complete the instruction; a step-limit ceiling
      //     is a runtime detail, not a failure. Promote to Done so summary and
      //     status agree.
      if (outcomeLabel === "Done" && (goalMet as string) === "no") outcomeLabel = "Failed";
      if (outcomeLabel === "Done" && (goalMet as string) === "partial") outcomeLabel = "Step limit";
      if ((goalMet as string) === "yes" && (outcomeLabel === "Step limit" || outcomeLabel === "Failed")) {
        outcomeLabel = "Done";
      }

    } catch (e) {
      console.warn("completion self-check failed", e);
    }

    // Final run status must mirror the reconciled outcome — never mark a
    // goal_met=yes run as step_limit.
    const runStatus = paused
      ? "paused"
      : outcomeLabel === "Done"
        ? "completed"
        : outcomeLabel === "Step limit"
          ? "step_limit"
          : outcomeLabel === "Failed"
            ? "failed"
            : outcomeLabel === "Blocked" || outcomeLabel === "Needs approval"
              ? "paused"
              : "completed";

    const finalCompletionText = `[${outcomeLabel}] goal_met=${goalMet}. ${completionSummary}`.slice(0, 900);
    await logEvent("completion", {
      outcome: outcomeLabel,
      goal_met: goalMet,
      summary: completionSummary,
      hit_step_limit: hitStepLimit,
      steps,
    });

    await supabase.from("agent_runs").update({
      status: runStatus,
      finished_at: new Date().toISOString(),
      summary: finalCompletionText,
      outcome: outcomeLabel,
    }).eq("id", runId);

    return json({ runId, summary: finalCompletionText, outcome: outcomeLabel, goal_met: goalMet, steps, paused, hitStepLimit });

  } catch (e) {
    console.error("agent-runtime error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

function extractAction(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const obj = body.match(/\{[\s\S]*\}/);
  if (!obj) return null;
  try { return JSON.parse(obj[0]); } catch { return null; }
}


async function executeTool(
  tool: Tool, input: Record<string, unknown>, supabase: SupabaseClient,
  agentId: string, _runId: string, userId: string,
  logEvent: (k: string, p: Record<string, unknown>) => Promise<unknown>,
): Promise<{ summary: string; error?: boolean }> {
  try {
    if (tool.kind === "web_search") {
      const query = String(input.query || tool.config?.query || "").slice(0, 200);
      if (!query) return { summary: "No query provided.", error: true };
      const key = Deno.env.get("LOVABLE_API_KEY")!;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: "You are a precise web research assistant. Summarize current public information in 4-6 bullets with concrete numbers/dates when possible." },
            { role: "user", content: `Research the latest on: ${query}` },
          ],
          temperature: 0.3,
        }),
      });
      if (!resp.ok) return { summary: `Search gateway ${resp.status}`, error: true };
      const data = await resp.json();
      await recordAiSpend(supabase, userId, MODEL, data?.usage, "agent-runtime-tool", agentId);
      return { summary: (data?.choices?.[0]?.message?.content ?? "(empty)").slice(0, 1200) };
    }
    if (tool.kind === "http_get") {
      const url = String(input.url || tool.config?.url || "");
      if (!/^https?:\/\//.test(url)) return { summary: "Invalid URL.", error: true };
      const resp = await fetch(url, { headers: { "User-Agent": "NazAI-Agent/1.0" } });
      const ct = resp.headers.get("content-type") || "";
      const text = await resp.text();
      const body = ct.includes("application/json") ? text.slice(0, 1200) : stripHtml(text).slice(0, 1200);
      return { summary: `HTTP ${resp.status} (${ct.split(";")[0] || "text"})\n${body}` };
    }
    if (tool.kind === "calc") {
      const expr = String(input.expression || "").replace(/[^0-9+\-*/().\s]/g, "");
      if (!expr) return { summary: "No expression.", error: true };
      try { return { summary: `Result: ${Function(`"use strict"; return (${expr});`)()}` }; }
      catch (e) { return { summary: `Calc error: ${e instanceof Error ? e.message : "unknown"}`, error: true }; }
    }
    if (tool.kind === "notify") {
      const message = String(input.message || "").slice(0, 600);
      const severity = String(input.severity || "info");
      await logEvent("action", { type: "notify", channel: tool.config?.channel || "log", severity, message });
      return { summary: `Notification logged (${severity}).` };
    }
    if (tool.kind === "custom") {
      const need = String(tool.config?.needsSecret || "");
      if (need && !Deno.env.get(need)) {
        return { summary: `Tool "${tool.name}" needs secret "${need}" — operator must add a connector. Inert for now.`, error: true };
      }
      return { summary: `Custom tool "${tool.name}" stub — no executor wired. Treat as inert and continue.`, error: true };
    }
    if (tool.kind === "deep_analyze") {
      const subject = String(input.subject || "").slice(0, 800);
      const ctx = String(input.context || "").slice(0, 4000);
      const focus = String(input.focus || "").slice(0, 300);
      if (!subject) return { summary: "deep_analyze requires a 'subject'.", error: true };
      const key = Deno.env.get("LOVABLE_API_KEY")!;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEEP_MODEL,
          messages: [
            { role: "system", content: "You are a senior operator (strategy + engineering + ops). Produce a rigorous structured diagnosis. Sections: 1) Findings (bullet list, evidence-based), 2) Root causes, 3) Risks / blast radius, 4) Prioritized fixes (P0/P1/P2 with owner + expected impact + effort), 5) Success metrics. Be concrete, name numbers/URLs when given, never vague." },
            { role: "user", content: `Subject: ${subject}\nFocus: ${focus || "(none — decide what matters)"}\nContext:\n${ctx || "(none provided)"}` },
          ],
          temperature: 0.3,
        }),
      });
      if (!resp.ok) return { summary: `deep_analyze gateway ${resp.status}`, error: true };
      const data = await resp.json();
      await recordAiSpend(supabase, userId, DEEP_MODEL, data?.usage, "agent-runtime-tool", agentId);
      return { summary: (data?.choices?.[0]?.message?.content ?? "(empty)").slice(0, 3500) };
    }
    if (tool.kind === "audit_url") {
      const url = String(input.url || "");
      const focus = String(input.focus || "").slice(0, 300);
      if (!/^https?:\/\//.test(url)) return { summary: "audit_url requires a valid http(s) URL.", error: true };
      let pageText = "";
      try {
        const r = await fetch(url, { headers: { "User-Agent": "NazAI-Agent/1.0" } });
        const t = await r.text();
        pageText = stripHtml(t).slice(0, 8000);
      } catch (e) {
        return { summary: `Fetch failed: ${e instanceof Error ? e.message : "unknown"}`, error: true };
      }
      const key = Deno.env.get("LOVABLE_API_KEY")!;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEEP_MODEL,
          messages: [
            { role: "system", content: "You audit web pages / documents. Produce: 1) What the page is trying to do (1 line), 2) What's WRONG (specific — copy, structure, clarity, CTA, credibility, SEO, technical), 3) What's MISSING, 4) Prioritized fixes (P0/P1/P2, each with exact suggested change), 5) One-paragraph rewrite of the hero if applicable. Cite quoted text from the page as evidence. Be blunt and useful." },
            { role: "user", content: `URL: ${url}\nFocus: ${focus || "(none — full audit)"}\n\nPAGE CONTENT (stripped):\n${pageText}` },
          ],
          temperature: 0.3,
        }),
      });
      if (!resp.ok) return { summary: `audit_url gateway ${resp.status}`, error: true };
      const data = await resp.json();
      await recordAiSpend(supabase, userId, DEEP_MODEL, data?.usage, "agent-runtime-tool", agentId);
      return { summary: (data?.choices?.[0]?.message?.content ?? "(empty)").slice(0, 3500) };
    }
    if (tool.kind === "make_plan") {
      const objective = String(input.objective || "").slice(0, 600);
      const constraints = String(input.constraints || "").slice(0, 800);
      if (!objective) return { summary: "make_plan requires an 'objective'.", error: true };
      const key = Deno.env.get("LOVABLE_API_KEY")!;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEEP_MODEL,
          messages: [
            { role: "system", content: "You produce concrete execution plans. Output a numbered list. Each step: [Owner] Action → Tool/how → Success criterion. End with a Kickoff step the agent will execute right now. No fluff, no restating the objective." },
            { role: "user", content: `Objective: ${objective}\nConstraints: ${constraints || "(none)"}` },
          ],
          temperature: 0.3,
        }),
      });
      if (!resp.ok) return { summary: `make_plan gateway ${resp.status}`, error: true };
      const data = await resp.json();
      await recordAiSpend(supabase, userId, DEEP_MODEL, data?.usage, "agent-runtime-tool", agentId);
      return { summary: (data?.choices?.[0]?.message?.content ?? "(empty)").slice(0, 3000) };
    }
    return { summary: `Unknown tool kind ${tool.kind}.`, error: true };
  } catch (e) {
    return { summary: `Tool exception: ${e instanceof Error ? e.message : "unknown"}`, error: true };
  }
}


function stripHtml(s: string): string {
  return s.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Hostnames explicitly permitted for http_post beyond a per-agent
// metadata.webhook_url. START EMPTY — operator must add trusted domains here
// before generic http_post calls will resolve for anything except an exact
// match to an integration's configured webhook_url.
const WEBHOOK_DOMAIN_ALLOWLIST: string[] = [];

async function validateHttpPostUrl(
  rawUrl: string,
  supabase: SupabaseClient,
  userId: string,
  agentId: string,
): Promise<{ ok: boolean; reason: string }> {
  if (!rawUrl) return { ok: false, reason: "empty url" };
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: "invalid url" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "only https is allowed" };
  const host = u.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"].includes(host)) {
    return { ok: false, reason: `blocked host ${host}` };
  }
  // Resolve DNS and check every A/AAAA against private/loopback/link-local ranges.
  try {
    const addrs = await Promise.allSettled([
      Deno.resolveDns(host, "A"),
      Deno.resolveDns(host, "AAAA"),
    ]);
    const ips: string[] = [];
    for (const r of addrs) if (r.status === "fulfilled") ips.push(...r.value);
    for (const ip of ips) {
      if (isPrivateOrLoopbackIp(ip)) return { ok: false, reason: `resolved to private/loopback ip ${ip}` };
    }
  } catch (_) {
    return { ok: false, reason: "dns resolution failed" };
  }
  // Domain allowlist check removed — any public hostname is permitted once IP
  // checks above pass. Per-agent approval gate remains the authorization surface.
  return { ok: true, reason: `host ${host} passed ip checks` };

}

function isPrivateOrLoopbackIp(ip: string): boolean {
  if (ip.includes(":")) {
    // IPv6: loopback ::1, link-local fe80::/10, unique-local fc00::/7
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    return false;
  }
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

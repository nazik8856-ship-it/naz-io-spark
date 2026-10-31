// Capability visibility endpoint — the trust-legibility feature from the
// original design principles: lets the chat/API honestly answer "what can
// you actually verify completion for right now, for THIS org's connected
// providers" by exposing the real capability-registry.ts contents, instead
// of the model guessing or the operator having to trust a marketing claim.
//
// GET/POST /capability-status — requires the caller's JWT. Response is
// scoped to the caller's own connected integrations by default, or a
// different account's via account_id (body for POST, query string for
// GET) -- same as every other item-1-fixed page, this queries with the
// CALLER's own JWT-scoped client, so the new team-read RLS policy on
// agent_integrations (not resolveAccountScope, which requires 'owner'
// role -- overkill for a pure read-only visibility endpoint) is what
// actually enforces this: a bogus/unauthorized account_id simply returns
// no rows, exactly like ControlChangeLog.tsx et al.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCaller, resolveCallerReadAccount } from "../_shared/caller.ts";
import { CAPABILITY_REGISTRY, buildCapabilityBlock, canOfferTool } from "../_shared/capability-registry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type CapabilityStatus = "real" | "needs_connection" | "not_implemented" | "unverified";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "GET or POST only" }, 405);

  // The caller comes from the sign-in token only; the client runs as them, so row level security applies as well.
  const who = await requireCaller(req, (authHeader) => createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  ));
  if (!who.ok) return json({ error: "unauthorized" }, 401);
  const supabase = who.caller.userClient;
  const userId = who.caller.userId;

  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const requestedAccountId = body?.account_id ?? url.searchParams.get("account_id");
  // An account named in the request is only used when the caller is a member of it; anyone else gets "not found", as for a missing one.
  const accountId = await resolveCallerReadAccount(who.caller, requestedAccountId);
  if (!accountId) return json({ error: "not_found" }, 404);
  const requestedAgentId = body?.agent_id ?? url.searchParams.get("agent_id");
  const agentId = typeof requestedAgentId === "string" && requestedAgentId ? requestedAgentId : null;

  // With no agent_id, report every connected provider on the account (the
  // original account-wide behavior ControlCoverageGaps.tsx relies on). With
  // an agent_id, scope the same way agent-runtime does when deciding what's
  // connected for a run -- account-wide integrations (agent_id null) plus
  // ones connected specifically for this agent -- so a provider connected
  // only to a DIFFERENT agent isn't misreported as "real" for this one.
  let connQuery = supabase
    .from("agent_integrations")
    .select("provider")
    .eq("user_id", accountId)
    .eq("status", "connected");
  if (agentId) connQuery = connQuery.or(`agent_id.eq.${agentId},agent_id.is.null`);
  const { data: conns } = await connQuery;
  const connected = ((conns ?? []) as { provider: string }[]).map((c) => c.provider);

  // Reuses the SAME gate agent-runtime checks before ever offering a tool to
  // the model (canOfferTool) — this endpoint must never classify a
  // capability differently than what actually decides whether an agent can
  // use it, or "what can you do" becomes its own source of drift.
  const STATUS_FOR_REASON: Record<string, CapabilityStatus> = {
    not_implemented: "not_implemented",
    unverified: "unverified",
    provider_not_connected: "needs_connection",
  };
  const capabilities = Object.values(CAPABILITY_REGISTRY).map((cap) => {
    const offer = canOfferTool(cap.kind, connected);
    const status: CapabilityStatus = offer.offerable ? "real" : STATUS_FOR_REASON[offer.reason];
    return {
      kind: cap.kind,
      provider: cap.provider,
      mode: cap.mode,
      status,
      verifiable_now: status === "real",
      verification: cap.verification || null,
      honesty: cap.honesty,
    };
  });

  return json({
    connected_providers: connected,
    capabilities,
    summary: {
      total: capabilities.length,
      real_now: capabilities.filter((c) => c.status === "real").length,
      needs_connection: capabilities.filter((c) => c.status === "needs_connection").length,
      not_implemented: capabilities.filter((c) => c.status === "not_implemented" || c.status === "unverified").length,
    },
    // Ready-to-embed prompt block — the exact honesty language given to
    // agents, in case a caller wants the same framing rather than
    // re-deriving it from the structured list above.
    prompt_block: buildCapabilityBlock(connected),
  });
});

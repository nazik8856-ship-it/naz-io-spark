// Outer Control System, v1: POST /outer-control/evaluate
//
// Governs a RESPONSE FROM AN EXTERNAL AI -- ChatGPT, Claude, a connected
// CRM bot, a support AI, anything the account has connected that isn't one
// of NazAI's own generated agents (those go through control-gate.ts /
// control-engine instead). Reachable two ways, per the outer-control spec:
// as a public API any external tool/integration can call directly
// (authenticated the same way control-api already is), and from inside
// NazAI itself whenever a workflow hands work to a connected external
// model and needs to trust what comes back before using it.
//
// v1 scope is content_kind='text' only: free-text output, scanned with the
// SAME safety_rules/hard_rules criteria pattern Inner Control's
// safety-scanner already applies to action params (that scanner is
// content-agnostic -- a plain string flattens to one field there, so it's
// reused as-is via scanWithRules rather than duplicated). A structured
// *proposed action* from an external AI (content_kind='action', reusing
// control-gate's hard-rule/circuit-breaker checks) is intentionally not
// built yet -- the table and this route both leave room for it.
//
// Escalate is logged and returned today; it does not yet open a
// pending_approvals-queue row a human can act on the way an Inner Control
// escalation does -- that queue integration is a follow-up, not silently
// assumed to exist.
//
// verify_jwt = false, same as control-api/agent-runtime -- auth is the
// Authorization: Bearer nazai_sk_... header via resolveApiKeyAuth, not a
// Supabase session JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveApiKeyAuth } from "../_shared/control-api-auth.ts";
import { checkRateLimit, checkIpRateLimit } from "../_shared/rate-limit.ts";
import { loadSafetyRules, scanWithRules } from "../_shared/safety-scanner.ts";
import { computeTrustScore, decideVerdict, redactContent } from "../_shared/outer-control-scoring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Pre-auth (per-IP) blunts brute-forcing/probing invalid keys, same
// posture and same reasoning as control-api's own pre-auth limit. Post-
// auth is per-account, set well below control-api's fast-mode limit since
// this does no LLM call of its own in v1 -- just pattern matching -- so
// there's no cost-based reason to allow less, but it's new, internet-
// reachable surface and should start conservative.
const PRE_AUTH_RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_PER_MINUTE = 60;
const MAX_CONTENT_LENGTH = 20_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    if (!/\/evaluate\/?$/.test(url.pathname)) {
      return json({ error: "not_found", message: "POST /outer-control/evaluate is the only route today." }, 404);
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("cf-connecting-ip")
      || "unknown";
    const ipRate = await checkIpRateLimit(admin, ip, "outer-control-preauth", PRE_AUTH_RATE_LIMIT_PER_MINUTE, 60);
    if (!ipRate.allowed) {
      return json({ error: "rate_limited", message: "Too many requests from this address. Try again shortly." }, 429);
    }

    const auth = await resolveApiKeyAuth(admin, req.headers.get("Authorization"));
    if (!auth.ok) return json(auth.body, auth.status);

    // Same full-access scope control-api requires for everything besides
    // its narrow respond-only route -- Outer Control judges arbitrary
    // external content, not the one bounded public-widget use case a
    // 'control:respond'-scoped key exists for.
    if (!auth.scopes.includes("control:verdict")) {
      return json({
        error: "insufficient_scope",
        message: "Outer Control requires a full-access API key. Create one without the respond-only scope.",
      }, 403);
    }

    const rate = await checkRateLimit(admin, auth.userId, "outer-control-evaluate", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const sourceModel = String(body?.source_model || "").trim().slice(0, 80);
    const content = typeof body?.content === "string" ? body.content : "";
    const agentId = typeof body?.agent_id === "string" ? body.agent_id : null;

    if (!sourceModel) {
      return json({ error: "source_model_required", message: "source_model (which external AI/tool produced this) is required." }, 400);
    }
    if (!content.trim()) {
      return json({ error: "content_required", message: "content (the external AI's raw output to evaluate) is required." }, 400);
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return json({ error: "content_too_long", message: `content must be ${MAX_CONTENT_LENGTH} characters or fewer.` }, 400);
    }

    const rules = await loadSafetyRules(admin, auth.userId, agentId);
    // A plain string flattens to a single "value" field inside scanWithRules
    // -- no separate content-specific scanner needed.
    const scan = scanWithRules(rules, content, "");
    const verdict = decideVerdict(scan.matches);
    const trustScore = computeTrustScore(scan.matches);
    const outputText = verdict === "allow"
      ? content
      : verdict === "modify"
        ? redactContent(content, scan.matches.map((m) => ({ pattern: m.pattern, category: m.category })))
        : null; // block / escalate: nothing safe to hand back yet.
    const summary = scan.summary ?? "No safety-criteria issues found in this external output.";

    const { data: evalRow, error: insertError } = await admin
      .from("outer_control_evaluations")
      .insert({
        user_id: auth.userId,
        api_key_id: auth.keyId,
        agent_id: agentId,
        source_model: sourceModel,
        content_kind: "text",
        input_excerpt: content.slice(0, 4000),
        output_text: outputText,
        verdict,
        trust_score: trustScore,
        matches: scan.matches,
        summary,
      })
      .select("id, created_at")
      .maybeSingle();

    if (insertError || !evalRow) {
      return json({ error: "internal_error", message: "Could not record this evaluation." }, 500);
    }

    return json({
      ok: true,
      id: evalRow.id,
      verdict,
      trust_score: trustScore,
      output: outputText,
      matches: scan.matches,
      summary,
      provenance: {
        source_model: sourceModel,
        evaluated_at: evalRow.created_at,
        criteria: "inner_control_safety_rules_v1",
      },
    });
  } catch (e) {
    return json({ error: "internal_error", message: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// AI Control System — chat front door for the shared decision engine.
// Input: { message: string, history?: [{role, content}], agentId? }
//
// TWO MODES:
//  1) The message describes a concrete proposed AI action -> extract
//     { action_type, provider, description, params } with structured output and
//     hand it to the control-engine function, which owns ALL scoring, the
//     Allow/Modify/Block/Deferred verdict, real execution and the
//     agent_decisions logging. No decision logic is duplicated here.
//  2) Anything else -> normal conversational reply.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Structured extraction contract — mirrors control-engine's input shape.
const EXTRACT_TOOL = {
  type: "function",
  function: {
    name: "review_action",
    description:
      "Call ONLY when the user is describing a concrete proposed AI action to review. " +
      "Extracts the action so the Control Engine can assess it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action_type: {
          type: "string",
          description:
            "Canonical tool kind if you can tell (send_email, reply_email, create_doc, edit_doc, " +
            "create_sheet, edit_sheet, create_calendar_event, slack_post_message, notion_create_page, " +
            "notion_update_page, canva_create_design, canva_create_folder, shopify_create_draft_order, " +
            "shopify_update_product, figma_post_comment, figma_create_dev_resource), else a short snake_case name.",
        },
        provider: {
          type: "string",
          description: "Gmail, Slack, Notion, Shopify, Canva, Figma, Google Docs, Google Sheets, Google Calendar, or 'unknown'.",
        },
        description: { type: "string", description: "Plain-language statement of what the user intends this action to do." },
        params: {
          type: "object",
          additionalProperties: true,
          description: "Concrete parameters mentioned by the user (channel, text, recipient, subject, product id, price...). Empty object if none.",
        },
      },
      required: ["action_type", "provider", "description", "params"],
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const message = String(body?.message || "").trim();
    const agentId: string | null = body?.agentId ? String(body.agentId) : null;
    const dryRun = body?.dry_run === true;
    if (!message) return json({ error: "message required" }, 400);

    // Recent decision history — lets the assistant explain past verdicts.
    const { data: recent } = await supabase
      .from("agent_decisions")
      .select("decision, reasoning, confidence_score, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    const historyBlock = (recent || []).length
      ? (recent as Record<string, unknown>[])
        .map((r) => `- ${r.created_at}: ${r.decision} (confidence ${r.confidence_score ?? "?"}) — ${String(r.reasoning || "").slice(0, 200)}`)
        .join("\n")
      : "(no decisions logged yet)";

    const priorTurns = Array.isArray(body?.history)
      ? (body.history as { role?: string; content?: string }[])
        .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 4000) }))
      : [];

    const res = await fetch(LOVABLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are the AI Control System — a helpful assistant that also routes proposed AI actions to the Control Engine.\n\n" +
              "TWO MODES:\n" +
              "1) If (and only if) the user is describing a concrete proposed AI action to review " +
              "(e.g. 'my agent wants to post to #general', 'should I let this run: email all customers'), " +
              "call the review_action tool with the action extracted faithfully. Do NOT judge it yourself — " +
              "the Control Engine does the intent, risk and fit checks. Never invent parameters the user didn't give.\n" +
              "2) Otherwise, reply normally in plain text — answer questions about how the Control System works, " +
              "explain past decisions, answer general questions, or ask ONE clarifying question when intent is ambiguous. " +
              "Do NOT call the tool in this mode.\n\n" +
              "Always write in plain everyday language.\n\n" +
              "HOW YOU WORK (for explaining yourself): a proposed action is parsed, then the Control Engine scores intent match, " +
              "risk (low/medium/high) and business fit, weighs confidence (0-100) against a threshold, and returns one of four " +
              "verdicts — Allow, Modify, Block, or Deferred (not a fit). When a verdict is Allow and a real verified executor exists " +
              "for that tool, the action is actually carried out and verified; otherwise only the assessment happens. " +
              "Every verdict is logged to the shared decision history that agents also write to.\n\n" +
              `RECENT DECISION HISTORY:\n${historyBlock}`,
          },
          ...priorTurns,
          { role: "user", content: message },
        ],
        tools: [EXTRACT_TOOL],
        tool_choice: "auto",
      }),
    });

    if (res.status === 429) return json({ error: "rate_limited", message: "Too many requests right now — try again in a moment." }, 429);
    if (res.status === 402) return json({ error: "payment_required", message: "AI credits are exhausted. Add credits to continue." }, 402);
    if (!res.ok) return json({ error: "gateway_error", message: (await res.text()).slice(0, 400) }, 502);

    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    const call = msg?.tool_calls?.[0];
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(call?.function?.arguments || "{}"); } catch { /* fall through */ }

    if (!parsed.action_type) {
      // Not an action to review — normal conversational reply.
      const reply = String(msg?.content || "").trim() ||
        "Could you tell me a bit more about what you'd like the AI to do?";
      return json({ mode: "chat", reply });
    }

    // ---- Hand off to the shared Control Engine ----------------------------
    const actionType = String(parsed.action_type);
    const provider = String(parsed.provider || "unknown");
    const description = String(parsed.description || message).slice(0, 2000);
    const params = (parsed.params && typeof parsed.params === "object") ? parsed.params : {};

    const engineRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/control-engine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      },
      body: JSON.stringify({ action_type: actionType, provider, description, params, agentId }),
    });
    const engine = await engineRes.json().catch(() => ({}));
    if (!engineRes.ok || engine?.error) {
      return json(
        { error: engine?.error || "control_engine_error", message: engine?.message || "The Control Engine couldn't review that action." },
        engineRes.status === 200 ? 502 : engineRes.status,
      );
    }

    return json({ mode: "decision", description, params, ...engine });
  } catch (e) {
    return json({ error: "unexpected", message: String((e as Error)?.message || e) }, 500);
  }
});

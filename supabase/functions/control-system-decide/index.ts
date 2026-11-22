// AI Control System — chat front door for the shared decision engine.
// Input: { message: string, history?: [{role, content}], agentId? }
//        { action: "run_task", kind, request }   (the person confirmed a task offer: starts it, returns { mode: "task_started", task_id })
//        { action: "clean_text", content, source?, project_id? }   (Clean it: one result that follows the rules and the person's
//        context, returns { mode: "clean_result", ... }; _shared/context-clean.ts)
//        { action: "context_weight", project_id }   (how much of that context a clean reads: lengths only, never the text)
//        { action: "structure_context", text }   (sorts pasted context into Facts, Policies, Tone, Never say; nothing is saved)
//        clean_text also takes format: "as_pasted" | "email" | "short" | "bullets" (_shared/context-format.ts)
//
// A request to DO work ("write…", "research…", "compare…") is answered with a task offer (mode "task_offer": the action, the
// built-in tools, what it costs); nothing starts until the person confirms it with run_task. The Task is an ordinary Outer Control
// Task with NazAI's built-in tools, so the account's rules check every answer (_shared/inner-chat-task.ts).
//
// MODES:
//  1) The message describes a concrete proposed AI action -> extract
//     { action_type, provider, description, params } with structured output and
//     hand it to the control-engine function, which owns ALL scoring, the
//     Allow/Modify/Block/Deferred verdict, real execution and the
//     agent_decisions logging. No decision logic is duplicated here.
//  2) Anything else -> normal conversational reply.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import "../_shared/outbound-guard.ts"; // second: no request carries a NazAI credential to a host it does not belong to
import { parseModelJson } from "../_shared/model-output.ts";
import { object } from "../_shared/schema.ts";
import { readJson } from "../_shared/input.ts";
import { createClient } from "../_shared/encrypted-client.ts"; // encrypts Outer Control content (data encryption, front 3)
import { buildCapabilityBlock } from "../_shared/capability-registry.ts";
import { pickAiGateway, callAiGateway } from "../_shared/ai-gateway.ts";
import { resolveAccountScope } from "../_shared/account-scope.ts";
import { evaluateExternalText } from "../_shared/outer-control-text-review.ts";
import { requireCaller } from "../_shared/caller.ts";
import { INNER_TASK_KINDS, isInnerTaskKind, requestProblem, taskOffer, toolsForKind, workRequestKind, pastedTextToCheck } from "../_shared/inner-chat-task.ts";
import { describeDraft, draftFromArgs, RULE_SCOPES } from "../_shared/inner-chat-rule.ts";
import { ensureStarterTools, STARTER_TASKS, starterTasksUsed } from "../_shared/outer-control-starter.ts";
import { cleanSourceOf, cleanText, contextSizeOf, CONTEXT_READ_CHARS, MAX_CLEAN_CHARS, pasteSourceModel, recheckSourceModel } from "../_shared/context-clean.ts";
import { meteredGatewayJudge } from "../_shared/meaning-judge.ts";
import { cleanFormatOf } from "../_shared/context-format.ts";
import { composeContext, structureContext } from "../_shared/context-structure.ts";
import { hideBeforeSaving } from "../_shared/projects.ts";
import { checkFreeLimit } from "../_shared/free-limits.ts";
import { projectContextFor } from "../_shared/projects.ts";
import { projectReferenceOf } from "../_shared/project-consistency.ts";
import { projectKeysFromEnv } from "../_shared/project-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

// Problem 4 (Control System cannot clean general external text, 2026-10-08):
// Outer Control's own text-review gate (evaluateExternalText, Blueprint
// task #3) already evaluates and repairs a piece of EXTERNAL AI text
// against this exact account's hard/safety rules -- kill switches, hard
// rules, then the safety-rules scan, with real redaction when possible.
// It's already live for agent-runtime's http_post tool and for Outer
// Control API callers. The chat front door just never offered it: its
// system prompt's two on-topic modes were "review a proposed ACTION" and
// "explain the Control System," so a user pasting "here's what ChatGPT
// said, can you check this" fell outside both and got redirected by the
// OFF-TOPIC branch as if it had nothing to do with this account's AI
// governance -- when checking an external AI's output against this
// account's own rules is literally what this system is for. No new
// repair/evaluation logic needed; this just gives the existing chat a
// second tool so it can reach the primitive that already exists.
const REVIEW_TEXT_TOOL = {
  type: "function",
  function: {
    name: "review_external_text",
    description:
      "Call ONLY when the user pastes or quotes text that was GENERATED BY AN EXTERNAL AI (ChatGPT, Claude, a " +
      "connected CRM bot, any AI besides this account's own Generator agents) and wants it checked, cleaned, or " +
      "verified against this account's rules. Do NOT call this for text the user wrote themselves, and do NOT " +
      "call review_action for this -- an external AI's text has no action_type/provider to extract.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: { type: "string", description: "The exact external AI text to review, copied verbatim from what the user pasted or quoted." },
        source_model: { type: "string", description: "Which AI produced this text, if the user said (e.g. 'ChatGPT', 'Claude', 'our CRM bot'), else 'unknown'." },
      },
      required: ["content", "source_model"],
    },
  },
};

function formatTextReviewReply(result: Awaited<ReturnType<typeof evaluateExternalText>>): string {
  const verdictLabel = { allow: "Allow", modify: "Modify", block: "Block", escalate: "Needs approval" }[result.verdict];
  const lines = [`**${verdictLabel}** — trust score ${result.trustScore}/100`, "", result.summary];
  if (result.verdict === "modify" && result.output) {
    lines.push("", "Cleaned version:", "```", result.output, "```");
  }
  if (result.matches.length) {
    lines.push("", `Matched: ${result.matches.map((m) => m.name).join(", ")}.`);
  }
  // Rules in plain words: the words that broke each one, and why (a "remove" rule's quote is never repeated).
  for (const f of result.meaning?.findings ?? []) {
    if (f.shadow) continue;
    lines.push("", `"${f.rule}": ${f.quote ? `"${f.quote}" — ` : ""}${f.why}`);
  }
  // Shadow rules are watched only: they never change the verdict, but the person sees what they would have caught.
  const shadow = [...new Set((result.shadowMatches ?? []).map((m) => m.name))];
  if (shadow.length) lines.push("", `In shadow mode (not enforced), would have matched: ${shadow.join(", ")}.`);
  return lines.join("\n");
}

// "Do this for me": a piece of work to run under the account's rules (Inner Control chat runs tasks).
const RUN_TASK_TOOL = {
  type: "function",
  function: {
    name: "run_task",
    description:
      "Call when the user asks the AI to DO a piece of work for them now: write, draft, research, compare, decide, explain, summarise, " +
      "fact-check. Do NOT call it to review a proposed action (review_action) or to check text an external AI wrote (review_external_text).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string", enum: [...INNER_TASK_KINDS],
          description: "opinions: views on a question; research: findings on a topic; decision: choose between options; compare: the same " +
            "question answered side by side; factcheck: verify a claim; explain: explain simply; keypoints: key points of a text; draft: write something.",
        },
        request: { type: "string", description: "The work to do, in the user's own words, complete enough to run on its own." },
      },
      required: ["kind", "request"],
    },
  },
};

// "Never mention prices": a rule drafted from plain words, shown to the person, saved only when they press Save (never here).
const CREATE_RULE_TOOL = {
  type: "function",
  function: {
    name: "draft_rule",
    description:
      "Call when the user wants a NEW RULE for their AI ('never …', 'always ask me before …', 'block replies that mention …'). " +
      "type 'action' stops or holds an action (sending email, posting to Slack…); type 'text' looks for words in a reply. " +
      "Do NOT call it to review an action or a text, or to run a task.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["action", "text"] },
        text: { type: "string", description: "action: the rule in the user's words, e.g. 'Never email customers on Sundays'." },
        scope: { type: "string", enum: Object.keys(RULE_SCOPES), description: "action: which actions it applies to; '*' for any action." },
        effect: { type: "string", enum: ["always_block", "always_require_approval"], description: "action: block it, or hold it for approval." },
        name: { type: "string", description: "text: a short name for the rule, e.g. 'No prices to customers'." },
        phrases: { type: "array", items: { type: "string" }, description: "text: the words or short phrases to look for (plain words, no patterns), e.g. ['price', 'discount', '€']." },
        action: { type: "string", enum: ["approval", "block", "redact"], description: "text: hold the reply for approval, block it, or remove the matching words." },
      },
      required: ["type"],
    },
  },
};

const toolArguments = object({}, { unknown: "keep" });
const MAX_TOOLS_PER_ACCOUNT = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const gw = pickAiGateway();
    if (!gw) return json({ error: "Missing OPENAI_API_KEY (or LOVABLE_API_KEY)" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authed = await requireCaller(req, (h) => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: h } } }));
    if (!authed.ok) return json({ error: "Not authenticated" }, 401);
    const userId = authed.caller.userId;
    // the caller's own token, passed on to control-engine so it acts as the same person
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

    const inputRead = await readJson(req, { headers: corsHeaders });
    if (!inputRead.ok) return inputRead.response;
    const body = inputRead.value;
    const message = String(body?.message || "").trim();
    const agentId: string | null = body?.agentId ? String(body.agentId) : null;
    const dryRun = body?.dry_run === true;
    const runTask = body?.action === "run_task";
    const cleanRequest = body?.action === "clean_text";
    const weightRequest = body?.action === "context_weight";
    const structureRequest = body?.action === "structure_context";
    if (!message && !runTask && !cleanRequest && !weightRequest && !structureRequest) return json({ error: "message required" }, 400);

    // Was ALWAYS userId regardless of which account was selected via the
    // account switcher on the Control System page -- a delegated team
    // member's "review this action" chat silently reviewed/spent/executed
    // against THEIR OWN account instead of the one they were viewing.
    // control-engine independently resolves + re-verifies this same
    // account_id (never trusts this layer's resolution as authorization on
    // its own); resolving it here too so this function's OWN context
    // (recent decisions, connected integrations) matches the account the
    // decision itself will actually run against.
    const userClient = authed.caller.userClient;
    const requestedAccountId = body?.account_id;
    const accountId = await resolveAccountScope(userClient, userId, requestedAccountId);
    if (!accountId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    // ---- Context weight: how much of the chosen context a clean reads (the indicator next to it). Lengths only. ---------------
    if (weightRequest) {
      const projectId = typeof body?.project_id === "string" && /^[0-9a-f-]{36}$/i.test(body.project_id) ? body.project_id : null;
      if (!projectId) return json({ error: "project_required" }, 400);
      const got = await projectContextFor(supabase, accountId, projectId, await projectKeysFromEnv(), 7_000);
      if (!got.ok) return json({ error: "context_unavailable", message: got.message }, 404);
      const size = contextSizeOf(projectReferenceOf(got.text) ?? "");
      return json({ mode: "context_weight", name: got.name, used: size.used, total: size.total, limit: CONTEXT_READ_CHARS });
    }

    // ---- Structured context: the pasted context sorted into Facts, Policies, Tone, Never say (shown to edit; nothing saved) -----
    if (structureRequest) {
      // Secrets never go to the AI: keys, card numbers and written-out passwords are hidden first, as when a project is saved.
      const hidden = hideBeforeSaving(String(body?.text ?? ""));
      const metered = meteredGatewayJudge(supabase, { userId: accountId, purpose: "context-structure" });
      const out = await structureContext(metered.ai, hidden.text);
      if (!out.ok) return json({ error: "not_structured", message: out.message }, 400);
      return json({ mode: "context_structure", sections: out.sections, text: composeContext(out.sections), discarded: out.discarded, hidden: hidden.hidden, cost_usd: metered.cost.cost_usd });
    }

    // ---- Clean it: pasted text from any AI -> one result that follows the account's rules and the person's context -----------
    if (cleanRequest) {
      const content = String(body?.content ?? "").trim();
      if (!content) return json({ error: "empty", message: "Paste the text you want cleaned." }, 400);
      if (content.length > MAX_CLEAN_CHARS) {
        return json({ error: "too_long", message: `That is ${content.length.toLocaleString("en")} characters; Clean it takes up to ${MAX_CLEAN_CHARS.toLocaleString("en")} at a time.` }, 400);
      }
      const source = cleanSourceOf(body?.source);
      const projectId = typeof body?.project_id === "string" && /^[0-9a-f-]{36}$/i.test(body.project_id) ? body.project_id : null;
      const allowed = await checkFreeLimit(supabase, accountId, "context_clean");
      if (!allowed.ok) return json(allowed.refusal, 402);
      let context: { name: string; text: string; used?: number; total?: number } | null = null;
      if (projectId) {
        const got = await projectContextFor(supabase, accountId, projectId, await projectKeysFromEnv(), 7_000);
        if (!got.ok) return json({ error: "context_unavailable", message: `Your context could not be used: ${got.message}` }, 400);
        const ref = projectReferenceOf(got.text);
        if (ref) context = { name: got.name, text: ref, ...contextSizeOf(ref) };
      }
      const metered = meteredGatewayJudge(supabase, { userId: accountId, purpose: "context-clean" });
      // The person who pasted it is deciding now: a "needs a person" result is shown to them, never queued as an approval.
      const review = (text: string, recheck: boolean) => evaluateExternalText(supabase, {
        userId: accountId, agentId: null, apiKeyId: null, isTest: false,
        sourceModel: recheck ? recheckSourceModel(source) : pasteSourceModel(source), content: text, origin: "external-api",
        meaning: { ai: "gateway", projectId }, personPresent: true,
      });
      const result = await cleanText({ review, ai: metered.ai, context }, content, cleanFormatOf(body?.format));
      const { data: st } = await supabase.rpc("free_limit_status", { _user_id: accountId, _kind: "context_clean" });
      const allowance = st && (st as { limited?: boolean }).limited ? { used: Number((st as { used?: number }).used ?? 0), limit: Number((st as { limit?: number }).limit ?? 0) } : null;
      return json({ mode: "clean_result", ...result, source, allowance, cost_usd: metered.cost.cost_usd });
    }

    // ---- The person confirmed a task offer: start it as an Outer Control Task with the built-in tools -------------------------
    if (runTask) {
      const kind = body?.kind;
      const request = String(body?.request ?? "").trim();
      if (!isInnerTaskKind(kind)) return json({ error: "invalid_kind", message: "That kind of task can not be run from the chat." }, 400);
      const problem = requestProblem(kind, request);
      if (problem) return json({ error: "invalid_request", message: problem }, 400);
      const made = await ensureStarterTools(supabase, accountId, MAX_TOOLS_PER_ACCOUNT);
      if (!made.ok) return json({ error: made.code, message: made.message }, made.status);
      const tools = toolsForKind(kind, made.tools);
      if (!tools.length) return json({ error: "no_tools", message: "NazAI's built-in tools are not available right now." }, 503);
      // The Task engine does the rest, as the same person: the account's rules, the credit (the free Tasks first), the result.
      const driveRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/outer-control-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" },
        body: JSON.stringify({ action: "start_report", task: kind, topic: request, tool_ids: tools.map((t) => t.id), paid_starter: true, confirm_override: true, account_id: accountId }),
      });
      const started = await driveRes.json().catch(() => ({})) as { ok?: boolean; task_id?: string; error?: string; message?: string };
      if (!driveRes.ok || !started.ok || !started.task_id) {
        return json({ error: started.error || "task_not_started", message: started.message || "The task could not be started." }, driveRes.ok ? 502 : driveRes.status);
      }
      return json({ mode: "task_started", task_id: started.task_id, kind, tools: tools.map((t) => t.name) });
    }

    // Recent decision history — lets the assistant explain past verdicts.
    const { data: recent } = await supabase
      .from("agent_decisions")
      .select("decision, reasoning, confidence_score, created_at")
      .eq("user_id", accountId)
      .order("created_at", { ascending: false })
      .limit(10);
    const historyBlock = (recent || []).length
      ? (recent as Record<string, unknown>[])
        .map((r) => `- ${r.created_at}: ${r.decision} (confidence ${r.confidence_score ?? "?"}) — ${String(r.reasoning || "").slice(0, 200)}`)
        .join("\n")
      : "(no decisions logged yet)";

    // Capability visibility — grounds "what can you actually do" answers in
    // the real capability registry instead of the model guessing or
    // over-claiming. Same source of truth agent-runtime uses to decide
    // whether a tool is genuinely offered.
    const { data: connsRows } = await supabase
      .from("agent_integrations")
      .select("provider")
      .eq("user_id", accountId)
      .eq("status", "connected");
    const connectedProviders = ((connsRows ?? []) as { provider: string }[]).map((c) => c.provider);
    const capabilityBlock = buildCapabilityBlock(connectedProviders);

    const priorTurns = Array.isArray(body?.history)
      ? (body.history as { role?: string; content?: string }[])
        .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 4000) }))
      : [];

    // The chat call; `toolChoice` forces one tool when the safety net below asks again.
    const ask = (toolChoice: unknown) => callAiGateway({
        model: gw.model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are the AI Control System — a focused assistant for this account's AI governance: reviewing proposed AI " +
              "actions, reviewing/cleaning text an EXTERNAL AI produced, explaining rules/decisions/incidents, what this " +
              "account's AI can actually do right now, drafting new rules, and RUNNING WORK for this account under its rules " +
              "(writing, drafting, research, comparisons, decisions, summaries, fact-checks). You are not a general chat " +
              "assistant: you never write the work yourself in the chat -- you offer it as a task with the run_task tool.\n\n" +
              "MODES, for on-topic messages only:\n" +
              "R) If the user wants a NEW RULE for their AI ('never …', 'always ask me before …'), call the draft_rule tool; " +
              "the user sees the draft and saves it. Never claim a rule was saved.\n" +
              "0) If the user asks you to DO a piece of work now (write, draft, reply to someone, research, compare, decide, " +
              "summarise, fact-check, explain a topic), call the run_task tool: it runs the work as a task under this account's " +
              "rules. This is ALWAYS on-topic, e.g. 'Draft a polite reply to a customer asking for a refund' -> run_task " +
              "(kind draft); 'Research the best CRM for a 5-person team' -> run_task (kind research).\n" +
              "1) If (and only if) the user is describing a concrete proposed AI action to review " +
              "(e.g. 'my agent wants to post to #general', 'should I let this run: email all customers'), " +
              "call the review_action tool with the action extracted faithfully. Do NOT judge it yourself — " +
              "the Control Engine does the intent, risk and fit checks. Never invent parameters the user didn't give.\n" +
              "2) If the user pastes or quotes text that an EXTERNAL AI produced (ChatGPT, Claude, a connected " +
              "CRM bot, anything besides this account's own Generator agents) and wants it checked, cleaned, or " +
              "verified against this account's rules, call the review_external_text tool with the exact text. " +
              "This is squarely on-topic -- checking an external AI's output against this account's own rules is " +
              "exactly what this system is for, not a request to redirect. A message that is ONLY a piece of text -- " +
              "a sentence, reply, email or post someone might send, with no question or instruction to you (e.g. " +
              "'Your order will arrive by Friday, guaranteed.') -- is text to check: call review_external_text with it.\n" +
              "3) Otherwise, reply normally in plain text — answer questions about how the Control System works, " +
              "explain past decisions, or ask ONE clarifying question when intent is ambiguous. " +
              "Do NOT call any tool in this mode. If asked what you can actually do or verify right now, answer ONLY from " +
              "the CAPABILITY REGISTRY below — never guess or round up, and always say plainly which things need an account " +
              "connected first.\n\n" +
              "A request to write, draft, research, compare, decide, summarise or fact-check something is NEVER off-topic: " +
              "it is mode 0 (run_task).\n" +
              "OFF-TOPIC MESSAGES: if the message is none of the modes above -- general knowledge questions or trivia to " +
              "answer in the chat, coding help unrelated to this product, personal advice, small talk -- do NOT answer it, " +
              "even partially, and do NOT call any tool. Instead reply " +
              "with ONE short, friendly sentence redirecting back to what you actually do here, e.g.: \"That's " +
              "outside what I can help with here -- I'm focused on your AI's actions and rules. Want me to run a task " +
              "for you, review something your AI wants to do, or check a response from an external AI?\" " +
              "Vary the wording naturally, but always steer back to this topic in a single sentence rather than " +
              "engaging with the off-topic request.\n\n" +
              "Always write in plain everyday language.\n\n" +
              "HOW YOU WORK (for explaining yourself): a proposed action is parsed, then the Control Engine scores intent match, " +
              "risk (low/medium/high) and business fit, weighs confidence (0-100) against a threshold, and returns one of four " +
              "verdicts — Allow, Modify, Block, or Deferred (not a fit). When a verdict is Allow and a real verified executor exists " +
              "for that tool, the action is actually carried out and verified; otherwise only the assessment happens. " +
              "Every verdict is logged to the shared decision history that agents also write to.\n\n" +
              `RECENT DECISION HISTORY:\n${historyBlock}` +
              `\n${capabilityBlock}`,
          },
          ...priorTurns,
          { role: "user", content: message },
        ],
        tools: [EXTRACT_TOOL, REVIEW_TEXT_TOOL, RUN_TASK_TOOL, CREATE_RULE_TOOL],
        tool_choice: toolChoice,
    }, gw);
    const res = await ask("auto");

    if (res.status === 429) return json({ error: "rate_limited", message: "Too many requests right now — try again in a moment." }, 429);
    if (res.status === 402) return json({ error: "payment_required", message: "AI credits are exhausted. Add credits to continue." }, 402);
    if (!res.ok) return json({ error: "gateway_error", message: (await res.text()).slice(0, 400) }, 502);

    let data = await res.json();
    // Safety net: a message that plainly asks for work ("Draft a polite reply…") answered with no tool at all is asked once more,
    // with the task offer required. The person still sees an offer and decides; nothing runs without them.
    if (!data?.choices?.[0]?.message?.tool_calls?.length && workRequestKind(message)) {
      const again = await ask({ type: "function", function: { name: "run_task" } });
      if (again.ok) {
        const d2 = await again.json().catch(() => null);
        if (d2?.choices?.[0]?.message?.tool_calls?.length) data = d2;
      }
    }
    const msg = data?.choices?.[0]?.message;
    const call = msg?.tool_calls?.[0];
    let parsed: Record<string, unknown> = {};
    { const r = parseModelJson(call?.function?.arguments || "{}", toolArguments); if (r.ok) parsed = r.value as Record<string, unknown>; } // bounded and cleaned; unusable arguments read as empty, as before

    // ---- "Never …": a drafted rule the page shows; it is saved only when the person presses Save -----------------------------
    if (call?.function?.name === "draft_rule") {
      const d = draftFromArgs(parsed);
      if (!d.ok) return json({ mode: "chat", reply: d.reason });
      return json({ mode: "rule_draft", draft: d.draft, line: describeDraft(d.draft) });
    }

    // ---- "Do this": an offer the person confirms (what runs, with which tools, what it costs). Nothing starts here. ----------
    if (call?.function?.name === "run_task") {
      const kind = isInnerTaskKind(parsed.kind) ? parsed.kind : workRequestKind(message) ?? "opinions";
      const request = String(parsed.request || message).trim().slice(0, 1500);
      const problem = requestProblem(kind, request);
      if (problem) return json({ mode: "chat", reply: problem });
      const made = await ensureStarterTools(supabase, accountId, MAX_TOOLS_PER_ACCOUNT);
      if (!made.ok) return json({ mode: "chat", reply: `I can't run tasks right now: ${made.message}` });
      const tools = toolsForKind(kind, made.tools);
      const used = await starterTasksUsed(supabase, accountId);
      return json({ mode: "task_offer", offer: taskOffer({ kind, request, tools, freeUsed: used, freeTasks: STARTER_TASKS }) });
    }

    // Safety net for the core loop: a message that is only a piece of text ("Your order will arrive by Friday, guaranteed.")
    // answered with no tool at all is checked against the account's rules anyway, exactly as pasted.
    const pasted = call ? null : pastedTextToCheck(message);
    if (call?.function?.name === "review_external_text" || pasted) {
      const content = String(pasted ?? parsed.content ?? "").slice(0, 8000);
      if (!content.trim()) {
        return json({ mode: "chat", reply: "I didn't catch the text to review — paste it and I'll check it against your rules." });
      }
      const result = await evaluateExternalText(supabase, {
        userId: accountId,
        agentId,
        apiKeyId: null,
        isTest: false,
        sourceModel: String(parsed.source_model || "unknown").slice(0, 80),
        content,
        origin: "external-api",
        meaning: { ai: "gateway" }, // the account's rules in plain words, in the same review (metered)
      });
      return json({ mode: "chat", reply: formatTextReviewReply(result) });
    }

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
      body: JSON.stringify({ action_type: actionType, provider, description, params, agentId, dry_run: dryRun, account_id: accountId }),
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

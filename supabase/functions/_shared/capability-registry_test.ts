// GAP 2 (Hard Non-Bypassable Control Gate): real tests for the gating
// classification capability-registry.ts now carries per tool kind.
//
// Run with: deno test --allow-none supabase/functions/_shared/capability-registry_test.ts
import { CAPABILITY_REGISTRY, GATED_TOOL_KINDS, GATE_EXEMPT_TOOL_KINDS } from "./capability-registry.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("every registry kind declares gated as a real boolean (the startup assertion's own invariant, re-checked)", () => {
  for (const [kind, cap] of Object.entries(CAPABILITY_REGISTRY)) {
    assert(typeof cap.gated === "boolean", `${kind} is missing an explicit gated:boolean`);
  }
});

Deno.test("GATED_TOOL_KINDS and GATE_EXEMPT_TOOL_KINDS are a complete, non-overlapping partition of every registry kind", () => {
  const allKinds = Object.keys(CAPABILITY_REGISTRY);
  for (const kind of allKinds) {
    const inGated = GATED_TOOL_KINDS.has(kind);
    const inExempt = GATE_EXEMPT_TOOL_KINDS.has(kind);
    assert(inGated || inExempt, `${kind} is in neither set`);
    assert(!(inGated && inExempt), `${kind} is in BOTH sets`);
  }
  assert(GATED_TOOL_KINDS.size + GATE_EXEMPT_TOOL_KINDS.size === allKinds.length);
});

Deno.test("every real external-effect or self-perpetuating write tool is gated", () => {
  const mustBeGated = [
    "send_email", "reply_email", "compose_and_deliver",
    "create_doc", "edit_doc", "create_sheet", "edit_sheet",
    "create_calendar_event", "upsert_client_note",
    "slack_post_message", "slack_upload_file", "export_google_file",
    "notion_create_page", "notion_update_page",
    "canva_create_design", "canva_create_folder", "canva_export_design",
    "figma_post_comment", "figma_create_dev_resource",
    "shopify_create_draft_order", "shopify_update_product",
    "http_post", "schedule_followup",
  ];
  for (const kind of mustBeGated) {
    assert(GATED_TOOL_KINDS.has(kind), `${kind} must be gated but isn't`);
  }
});

Deno.test("every internal/meta/read-only tool with no real-world effect to judge is exempt", () => {
  const mustBeExempt = [
    "web_search", "http_get", "calc", "remember", "ask_user", "request_approval",
    "deep_analyze", "audit_url", "make_plan", "generate_report",
    "sync_integrations", "integration_query", "notify", "custom",
    "read_email", "read_analytics", "canva_list_designs",
  ];
  for (const kind of mustBeExempt) {
    assert(GATE_EXEMPT_TOOL_KINDS.has(kind), `${kind} must be exempt but isn't`);
  }
});

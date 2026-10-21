// What happens after an approval reaches its quorum. One copy is shared by the pages and the edge functions so they can not
// disagree: src/lib/approval-run.ts and supabase/functions/_shared/approval-run.ts. A test fails when they differ.
//
// Only a real write to a connected service (an email, a doc, a Slack post …) is carried out by "Run it" (control-engine's
// /approvals/:id/execute). Every other approval only lets something that is waiting go on, and that waiting thing picks it up by
// itself: an Outer Control session (first contact, a contact rule) or the agent run that asked. There is nothing to run for those.

/** The actions "Run it" carries out itself. */
export const PROVIDER_WRITE_KINDS = new Set([
  "send_email",
  "compose_and_deliver",
  "create_doc",
  "edit_doc",
  "create_sheet",
  "edit_sheet",
  "create_calendar_event",

  "slack_post_message",
  "slack_upload_file",
  "export_google_file",
  "notion_create_page",
  "notion_update_page",
  "canva_create_design",
  "canva_list_designs",
  "canva_create_folder",
  "canva_export_design",
  "shopify_create_draft_order",
  "shopify_update_product",
  "figma_post_comment",
  "figma_create_dev_resource",
]);

/** run: "Run it" carries it out. outer_control: the waiting Outer Control session goes on by itself. agent_run: the agent run does. */
export type ApprovalRunMode = "run" | "outer_control" | "agent_run";

export function approvalRunMode(actionType: string | null | undefined): ApprovalRunMode {
  const t = String(actionType ?? "");
  if (PROVIDER_WRITE_KINDS.has(t)) return "run";
  if (t.startsWith("outer_control")) return "outer_control";
  return "agent_run";
}

/** Plain words for an approved item that has nothing to run. */
export function nothingToRunMessage(actionType: string | null | undefined): string {
  return approvalRunMode(actionType) === "outer_control"
    ? "Nothing to run: Outer Control picks this approval up by itself and carries on."
    : "Nothing to run here: the agent run that asked for this approval carries it out itself once it is approved.";
}

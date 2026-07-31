// Central Zod schema registry for every agent tool call.
//
// Every tool kind that the agent engine can execute declares an explicit input
// schema here. `validateToolInput` is called at the single dispatch point in
// agent-runtime BEFORE any executor runs; on failure the tool is NOT executed
// and a structured error payload is returned to the model so it can see exactly
// which field failed and why.
import { z } from "https://esm.sh/zod@3.23.8";

const str = z.string();
const nonEmpty = (label: string) => z.string().trim().min(1, `${label} is required`);
const url = z.string().trim().url("must be a valid absolute URL").refine(
  (u) => /^https?:\/\//i.test(u),
  "must start with http:// or https://",
);
const iso = z.string().trim().refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO 8601 datetime");
const rows = z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])));

// Schemas are passthrough: unknown extra keys are tolerated, declared keys are enforced.
export const TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  web_search: z.object({ query: nonEmpty("query").max(400) }).passthrough(),
  http_get: z.object({ url }).passthrough(),
  http_post: z.object({ url, body: z.union([z.record(z.unknown()), z.array(z.unknown())]) }).passthrough(),
  calc: z.object({ expression: nonEmpty("expression").max(200) }).passthrough(),
  notify: z.object({
    message: nonEmpty("message").max(2000),
    severity: z.enum(["info", "warn", "alert"]).optional(),
  }).passthrough(),
  remember: z.object({ key: nonEmpty("key").max(120), value: nonEmpty("value").max(4000) }).passthrough(),
  ask_user: z.object({
    question: nonEmpty("question").max(1000),
    options: z.array(str).max(8).optional(),
  }).passthrough(),
  request_approval: z.object({
    action: nonEmpty("action").max(300),
    payload: z.record(z.unknown()).optional(),
    risk: z.enum(["low", "med", "high"]).optional(),
  }).passthrough(),
  sync_integrations: z.object({ provider: str.optional() }).passthrough(),
  integration_query: z.object({ provider: nonEmpty("provider") }).passthrough(),
  deep_analyze: z.object({
    subject: nonEmpty("subject").max(2000),
    context: str.optional(),
    focus: str.optional(),
  }).passthrough(),
  audit_url: z.object({ url, focus: str.optional() }).passthrough(),
  make_plan: z.object({ objective: nonEmpty("objective").max(2000), constraints: str.optional() }).passthrough(),
  send_email: z.object({
    to: z.string().trim().email("must be a valid email address"),
    subject: nonEmpty("subject").max(300),
    body: nonEmpty("body").max(50000),
  }).passthrough(),
  reply_email: z.object({
    thread_id: nonEmpty("thread_id"),
    body: nonEmpty("body").max(50000),
    subject: str.optional(),
  }).passthrough(),
  read_email: z.object({
    message_id: str.optional(),
    thread_id: str.optional(),
    query: str.optional(),
    max: z.number().int().min(1).max(50).optional(),
  }).passthrough().refine(
    (v) => !!(v.message_id || v.thread_id || v.query),
    { message: "provide at least one of message_id, thread_id or query" },
  ),
  generate_report: z.object({
    title: nonEmpty("title").max(300),
    kind: z.enum(["report", "digest", "audit", "plan"]),
    body_markdown: nonEmpty("body_markdown"),
  }).passthrough(),
  create_doc: z.object({
    title: nonEmpty("title").max(300),
    body_markdown: nonEmpty("body_markdown"),
  }).passthrough(),
  edit_doc: z.object({
    doc_id: nonEmpty("doc_id"),
    mode: z.enum(["append", "replace"]),
    body_markdown: nonEmpty("body_markdown"),
  }).passthrough(),
  create_sheet: z.object({ title: nonEmpty("title").max(300), rows }).passthrough(),
  edit_sheet: z.object({
    sheet_id: nonEmpty("sheet_id"),
    range: nonEmpty("range").regex(/.+![A-Z]+\d*(:[A-Z]+\d*)?$/i, 'must look like "Sheet1!A2:C10"'),
    values: rows,
  }).passthrough(),
  create_calendar_event: z.object({
    title: nonEmpty("title").max(300),
    start_iso: iso,
    end_iso: iso,
    description: str.optional(),
  }).passthrough().refine(
    (v) => Date.parse(v.end_iso) > Date.parse(v.start_iso),
    { message: "end_iso must be after start_iso", path: ["end_iso"] },
  ),
  read_analytics: z.object({ property_id: nonEmpty("property_id") }).passthrough(),
  schedule_followup: z.object({
    run_at_iso: iso,
    instruction: nonEmpty("instruction").max(2000),
  }).passthrough(),
  upsert_client_note: z.object({
    email: z.string().trim().email("must be a valid email address").optional(),
    name: str.optional(),
    company: str.optional(),
    note: nonEmpty("note").max(8000),
    tags: z.array(str).max(12).optional(),
  }).passthrough().refine(
    (v) => !!(v.email || v.name || v.company),
    { message: "provide at least one identifier: email, name or company" },
  ),
  // Free-form executors: accept any object, but keep them in the registry so
  // dispatch stays explicit rather than silently unvalidated.
  custom: z.record(z.unknown()),
};

export type ToolValidationIssue = { field: string; message: string; code: string };

export type ToolValidationResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: "validation_error"; tool: string; details: ToolValidationIssue[]; message: string };

export function validateToolInput(
  kind: string,
  toolName: string,
  input: unknown,
): ToolValidationResult {
  const schema = TOOL_SCHEMAS[kind] ?? z.record(z.unknown());
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const parsed = schema.safeParse(value);
  if (parsed.success) return { success: true, data: parsed.data as Record<string, unknown> };
  const details: ToolValidationIssue[] = parsed.error.issues.map((i) => ({
    field: i.path.length ? i.path.join(".") : "(root)",
    message: i.message,
    code: i.code,
  }));
  return {
    success: false,
    error: "validation_error",
    tool: toolName,
    details,
    message: details.map((d) => `${d.field}: ${d.message}`).join("; "),
  };
}

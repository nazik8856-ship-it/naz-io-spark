// User & data isolation, front 1: how every edge function decides who is calling. src/test/function-access.test.ts checks that
// every function is listed here and that its code matches its entry (docs/data-isolation.md).
//
//   user     the caller is a signed-in user, identified from their sign-in token (auth.getUser), or the function runs the query
//            as that user so row level security applies (the caller's Authorization header on the client)
//   api_key  the caller is identified by a NazAI API key (api-key-auth.ts / control-api-auth.ts); the account comes from the key
//   system   scheduled jobs and server-to-server calls only: the request must carry the server key
//   public   reachable without signing in, on purpose; `reason` says why and what protects it
//
// `checkedBy` names the function the caller's token is passed on to, which verifies it (the test checks both).
// `gap` records a known problem; the test fails when a gap is fixed but still listed, or a new one appears. (None are open since front 3.)
export type FunctionAccess = { access: "user" | "api_key" | "system" | "public"; reason?: string; checkedBy?: string; gap?: string };

const USER: FunctionAccess = { access: "user" };
const SYSTEM: FunctionAccess = { access: "system" };

export const FUNCTION_ACCESS: Record<string, FunctionAccess> = {
  // Signed-in users (some also accept the server key, for scheduled or internal calls)
  "account-invite": USER,
  "account-invite-accept": USER,
  "agent-approval": USER,
  "agent-runtime": { access: "user", reason: "also runs scheduled agents for agent-scheduler (scheduler-caller.ts)" },
  "agent-think-tank": USER,
  "analyze-inputs": USER,
  "analyze-org-insights": USER,
  "api-keys": USER,
  "audit-integrity-sweep": { access: "user", reason: "also runs weekly as a scheduled job with the server key" },
  "business-context-researcher": USER,
  "canva-oauth-start": USER,
  "capability-status": USER,
  "compile-agent-manifest": USER,
  "compile-website-manifest": USER,
  "control-engine": USER,
  "control-incidents": USER,
  "control-self-audit": { access: "user", reason: "also runs weekly as a scheduled job with the server key" },
  "control-system-decide": USER,
  "control-test-suite": {
    access: "user", checkedBy: "control-engine",
    reason: "passes the caller's token on to control-engine for every scenario; also runs as an internal check with the server key",
  },
  "delete-project": USER,
  "encrypted-write": { access: "user", reason: "runs the write as the signed-in user, so row level security decides" },
  "figma-oauth-start": USER,
  "final-assembly-check": USER,
  "generate-business-plan": USER,
  "generate-site-images": { access: "user", reason: "also called by site-images-backfill-sweep with the server key" },
  "gmail-oauth-start": USER,
  "integration-connect": USER,
  "integration-sync": USER,
  "mcp": { access: "user", reason: "every tool runs with the caller's own token (Lovable MCP bundle)" },
  "notion-oauth-start": USER,
  "outer-control-drive": USER,
  "outer-control-read": { access: "user", reason: "runs the read as the signed-in user, so row level security decides" },
  "process-mission": USER,
  "projects": USER,
  "purchase-credits": USER,
  "rule-simulator": USER,
  "shopify-oauth-start": USER,
  "simulate-scenario": USER,
  "slack-oauth-start": USER,
  "swift-service": USER,
  "webhooks-create": USER,

  // NazAI API keys
  "control-api": { access: "api_key" },
  "outer-control": { access: "api_key" },

  // Scheduled jobs and server-to-server calls
  "agent-scheduler": SYSTEM,
  "approval-escalation-sweep": SYSTEM,
  "auto-resolution-share-sweep": SYSTEM,
  "calibrate-confidence": SYSTEM,
  "content-gap-backlog-sweep": SYSTEM,
  "content-gap-triage-sweep": SYSTEM,
  "control-api-abuse-sweep": SYSTEM,
  "control-digest-email": SYSTEM,
  "control-monthly-report-email": SYSTEM,
  "control-weekly-trend-email": SYSTEM,
  "cron-correlated-failures": SYSTEM,
  "cron-health-check": SYSTEM,
  "cross-account-precedent-sweep": SYSTEM,
  "data-deletion-sweep": SYSTEM,
  "decision-embedding-backfill-sweep": SYSTEM,
  "generation-canary": SYSTEM,
  "governance-backup-export": SYSTEM,
  "incident-escalation-sweep": SYSTEM,
  "integration-revocation-sweep": SYSTEM,
  "knowledge-base-auto-draft-sweep": SYSTEM,
  "measure-decision-outcomes": SYSTEM,
  "outcome-quality-sweep": SYSTEM,
  "outer-control-session-sweep": SYSTEM,
  "precedent-pipeline-health-sweep": SYSTEM,
  "preview-transactional-email": SYSTEM,
  "process-email-queue": SYSTEM,
  "readiness-webhook-sweep": SYSTEM,
  "recurring-assembly-sweep": SYSTEM,
  "retention-sweep": SYSTEM,
  "rule-auto-draft-sweep": SYSTEM,
  "site-images-backfill-sweep": SYSTEM,
  "site-images-cleanup-sweep": SYSTEM,
  "stuck-approval-sweep": SYSTEM,
  "webhook-retry-sweep": SYSTEM,

  // Reachable without signing in, on purpose
  "agent-intake": { access: "public", reason: "suggests clarifying questions for a prompt in the public try-before-signup flow; reads and stores no account data" },
  "generate-ai-agent": { access: "public", reason: "public try-before-signup generator; no account data; rate limited per IP address" },
  "nazai-chat": { access: "public", reason: "public try-before-signup chat; no account data; rate limited per IP address" },
  "identity-providers-lookup": { access: "public", reason: "the sign-in screen asks which sign-in methods an email has; returns only provider names (see its migration)" },
  "integration-account-search": { access: "public", reason: "looks up a public handle on a third-party platform; reads no NazAI account data" },
  "canva-oauth-callback": { access: "public", reason: "OAuth provider redirect; trusted only with the one-time state created for the signed-in user" },
  "figma-oauth-callback": { access: "public", reason: "OAuth provider redirect; trusted only with the one-time state created for the signed-in user" },
  "gmail-oauth-callback": { access: "public", reason: "OAuth provider redirect; trusted only with the one-time state created for the signed-in user" },
  "notion-oauth-callback": { access: "public", reason: "OAuth provider redirect; trusted only with the one-time state created for the signed-in user" },
  "shopify-oauth-callback": { access: "public", reason: "OAuth provider redirect; trusted only with the one-time state created for the signed-in user" },
  "slack-oauth-callback": { access: "public", reason: "OAuth provider redirect; trusted only with the one-time state created for the signed-in user" },
  "resend-events": { access: "public", reason: "Resend's delivery webhook; accepted only with a valid Svix signature" },
  "handle-email-unsubscribe": { access: "public", reason: "the unsubscribe link in an email; acts only on the one-time token in the link" },
  "handle-email-suppression": { access: "public", reason: "retired: answers 410 Gone to everything, touches no data" },
  "send-welcome-resend": { access: "public", reason: "sends the welcome email right after sign-up, before a session exists; fixed template" },
  "send-transactional-email": { access: "public", reason: "sends a fixed email template; callers without the server key are rate limited per IP address" },
  "website-form-submit": { access: "public", reason: "visitors submitting a form on a published site; stored for that site's owner only, rate limited" },
  "outer-control-stub-tool": { access: "public", reason: "a scripted stand-in tool for tests; needs a fixed test token, holds and returns no data" },
};

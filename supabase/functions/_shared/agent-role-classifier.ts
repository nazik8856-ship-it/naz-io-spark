// Classifies a free-text agent plan into one of the ROLE_LIBRARY roles used
// by compile-agent-manifest. Extracted from compile-agent-manifest/index.ts
// so it can carry real test coverage (agent-role-classifier_test.ts) --
// previously a private inline function, which is how a real regression
// (plural keyword forms never matching, then a fix for that introducing a
// new false-positive collision) shipped twice in one night before either
// was caught by anything but manual live-testing.
export const AGENT_ROLES = ["sales_ops", "support", "marketing", "ops_finance", "custom"] as const;
export type AgentRole = typeof AGENT_ROLES[number];

export function pickRole(plan: string, hinted?: string): AgentRole {
  if (hinted && (AGENT_ROLES as readonly string[]).includes(hinted)) return hinted as AgentRole;
  const p = plan.toLowerCase();
  // Plain singular-only keyword lists silently missed plural forms --
  // "invoices" never matched "invoice", so a clearly financial prompt fell
  // through to "custom" (wrong default schedule + generic boilerplate
  // automations unrelated to the actual request). Each keyword now
  // optionally matches a trailing "s". "post"/"posts" was deliberately
  // dropped rather than pluralized: live-tested and found it's generic
  // enough ("posts a summary to Slack") to false-positive-match financial
  // and ops prompts ahead of ops_finance's own, more specific keywords in
  // this if/else chain -- content/blog/social/brand/campaign/seo/mention
  // already cover real marketing prompts without that collision.
  if (/\b(support|tickets?|inbox(?:es)?|helpdesk|customer service|complaints?)\b/.test(p)) return "support";
  if (/\b(sales|leads?|prospects?|outreach|sdr|crm|pipelines?|cold emails?)\b/.test(p)) return "sales_ops";
  if (/\b(markets?|content|seo|socials?|blogs?|brands?|campaigns?|mentions?)\b/.test(p)) return "marketing";
  if (/\b(finances?|invoices?|kpis?|reports?|anomal(?:y|ies)|revenue|metrics?|dashboards?|ops|operations?)\b/.test(p)) return "ops_finance";
  return "custom";
}

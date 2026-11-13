// Drift check of 2026-11-13: nine functions are deployed with the gateway JWT check off (each checks its caller itself) but supabase/config.toml
// did not say so. A CLI deploy from the repo would have switched the check on and broken the OAuth callback and the sweeps. These checks keep
// every function that is deployed with the check off listed in config.toml, and nothing else changed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const toml = readFileSync(join(__dirname, "../../supabase/config.toml"), "utf8");
const entries = new Map<string, string>();
for (const m of toml.matchAll(/\[functions\.([a-z0-9-]+)\]\s*\nverify_jwt\s*=\s*(true|false)/g)) entries.set(m[1], m[2]);

// Deployed with verify_jwt = false (what supabase list_edge_functions reports), at the time of the drift check.
const DEPLOYED_JWT_OFF = [
  "agent-runtime", "canva-oauth-callback", "canva-oauth-start", "control-api", "control-api-abuse-sweep", "control-incidents",
  "figma-oauth-callback", "figma-oauth-start", "generate-ai-agent", "generation-canary", "gmail-oauth-callback", "handle-email-suppression",
  "handle-email-unsubscribe", "integration-account-search", "integration-sync", "mcp", "nazai-chat", "notion-oauth-callback", "notion-oauth-start",
  "outcome-quality-sweep", "outer-control", "outer-control-session-sweep", "outer-control-stub-tool", "preview-transactional-email", "resend-events",
  "send-welcome-resend", "shopify-oauth-callback", "shopify-oauth-start", "slack-oauth-callback", "slack-oauth-start", "stuck-approval-sweep",
  "webhooks-create", "website-form-submit",
];

describe("config.toml matches the functions deployed without the gateway JWT check", () => {
  it("lists every one of them as verify_jwt = false", () => {
    const missing = DEPLOYED_JWT_OFF.filter((f) => entries.get(f) !== "false");
    expect(missing).toEqual([]);
  });

  it("does not switch the check off for anything else", () => {
    const extra = [...entries].filter(([f, v]) => v === "false" && !DEPLOYED_JWT_OFF.includes(f)).map(([f]) => f);
    expect(extra).toEqual([]);
  });
});

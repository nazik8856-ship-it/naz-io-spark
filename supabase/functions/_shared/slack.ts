// Shared Slack OAuth v2 helpers. Slack's oauth.v2.access endpoint uses
// form-encoded client_id/client_secret (NOT Basic auth) and returns a bot
// token plus team info. Tokens are long-lived unless the workspace admin
// enables token rotation, so we don't ship a refresh loop here.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getRotatableClientSecret, withClientSecretRotation } from "./oauth-secret-rotation.ts";

// Bot scope groups shown on NazAI's pre-consent screen. User checks which
// capabilities to grant; only those scopes are forwarded to Slack.
export const SLACK_SCOPE_GROUPS: Record<string, string[]> = {
  channels_read: ["channels:read"],
  channels_history: ["channels:history"],
  groups_read: ["groups:read"],
  groups_history: ["groups:history"],
  users_read: ["users:read"],
  chat_write: ["chat:write"],
};

export const SLACK_DEFAULT_GROUPS = Object.keys(SLACK_SCOPE_GROUPS);

export function scopesForGroups(groups: string[]): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    for (const s of SLACK_SCOPE_GROUPS[g] || []) out.add(s);
  }
  return [...out];
}

export const SLACK_REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/slack-oauth-callback`;

export function isConfigured(): boolean {
  return !!(Deno.env.get("SLACK_CLIENT_ID") && Deno.env.get("SLACK_CLIENT_SECRET"));
}

export function buildAuthUrl(state: string, botScopes: string[]): string {
  const clientId = Deno.env.get("SLACK_CLIENT_ID") || "";
  // Slack expects scopes comma-separated in the `scope` param for v2 bot scopes.
  const params = [
    `client_id=${encodeURIComponent(clientId)}`,
    `scope=${botScopes.map(encodeURIComponent).join(",")}`,
    `redirect_uri=${encodeURIComponent(SLACK_REDIRECT_URI)}`,
    `state=${encodeURIComponent(state)}`,
  ].join("&");
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export type SlackTokenResponse = {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id?: string; name?: string };
  enterprise?: { id?: string; name?: string } | null;
  authed_user?: { id?: string; access_token?: string; scope?: string; token_type?: string };
};

export async function exchangeCode(code: string): Promise<SlackTokenResponse> {
  const clientId = Deno.env.get("SLACK_CLIENT_ID") || "";
  const secrets = getRotatableClientSecret("SLACK_CLIENT_SECRET");
  const { r, data } = await withClientSecretRotation(
    secrets,
    async (clientSecret) => {
      const res = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: SLACK_REDIRECT_URI,
        }),
      });
      return { r: res, data: await res.json().catch(() => ({} as SlackTokenResponse)) };
    },
    // Slack documents a specific machine-readable error for this case,
    // unlike most of the other five providers -- no 401-status guessing
    // needed here.
    ({ data }) => data?.error === "bad_client_secret",
  );
  if (!r.ok || !data?.ok) {
    throw new Error(data?.error || `Slack token exchange failed (${r.status})`);
  }
  return data as SlackTokenResponse;
}

export async function fetchTeamInfo(access_token: string, teamId?: string) {
  try {
    const url = teamId
      ? `https://slack.com/api/team.info?team=${encodeURIComponent(teamId)}`
      : "https://slack.com/api/team.info";
    const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
    const d = await r.json().catch(() => ({}));
    if (d?.ok && d.team) return d.team as { id?: string; name?: string; domain?: string; icon?: Record<string, string> };
  } catch { /* ignore */ }
  return null;
}

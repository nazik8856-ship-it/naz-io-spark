// Shared Notion OAuth helpers. Notion's public integration flow uses Basic
// auth (base64 of client_id:client_secret) to exchange the code for a token.
// Capabilities are fixed per integration in Notion's dashboard, so there is
// no scope parameter and no NazAI pre-consent screen.
import { getRotatableClientSecret, withClientSecretRotation } from "./oauth-secret-rotation.ts";

export const NOTION_REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notion-oauth-callback`;

export function isConfigured(): boolean {
  return !!(Deno.env.get("NOTION_CLIENT_ID") && Deno.env.get("NOTION_CLIENT_SECRET"));
}

export function buildAuthUrl(state: string): string {
  const clientId = Deno.env.get("NOTION_CLIENT_ID") || "";
  const params = [
    `client_id=${encodeURIComponent(clientId)}`,
    `redirect_uri=${encodeURIComponent(NOTION_REDIRECT_URI)}`,
    `response_type=code`,
    `owner=user`,
    `state=${encodeURIComponent(state)}`,
  ].join("&");
  return `https://api.notion.com/v1/oauth/authorize?${params}`;
}

export type NotionTokenResponse = {
  access_token: string;
  token_type?: string;
  bot_id?: string;
  workspace_id: string;
  workspace_name?: string | null;
  workspace_icon?: string | null;
  owner?: Record<string, unknown>;
  duplicated_template_id?: string | null;
  request_id?: string;
};

export async function exchangeCode(code: string): Promise<NotionTokenResponse> {
  const clientId = Deno.env.get("NOTION_CLIENT_ID") || "";
  const secrets = getRotatableClientSecret("NOTION_CLIENT_SECRET");
  const { r, data } = await withClientSecretRotation(
    secrets,
    async (clientSecret) => {
      const basic = btoa(`${clientId}:${clientSecret}`);
      const res = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: NOTION_REDIRECT_URI,
        }),
      });
      return { r: res, data: await res.json().catch(() => ({} as Record<string, unknown>)) };
    },
    // A bad Basic-auth client secret conventionally comes back as a plain
    // 401 -- Notion doesn't document a separate machine-readable code for
    // "the client itself was rejected" the way RFC 6749's invalid_client
    // does, same caveat as Shopify above.
    ({ r }) => r.status === 401,
  );
  if (!r.ok) {
    const err = (data as { error?: string; error_description?: string }).error_description
      || (data as { error?: string }).error
      || `Notion token exchange failed (${r.status})`;
    throw new Error(err);
  }
  return data as NotionTokenResponse;
}

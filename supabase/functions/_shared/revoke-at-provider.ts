// Secrets handling, front 3: disconnecting an integration also cancels its token at the provider, so a copy of the token that
// leaked before the disconnect stops working too. Called before the stored copy is deleted; whatever the provider answers, the
// stored copy is deleted afterwards (a provider that is down must not keep a token alive in NazAI). Plain function, network passed
// in, so it is tested without the network.
//
//   Gmail (Google)  POST https://oauth2.googleapis.com/revoke, token=refresh token (ends the whole grant) or access token
//   Slack           POST https://slack.com/api/auth.revoke with the token as Bearer
//   Notion          POST https://api.notion.com/v1/oauth/revoke, client id and secret as Basic auth
//   Canva           POST https://api.canva.com/rest/v1/oauth/revoke, client id and secret as Basic auth, token=refresh token
//   Shopify         DELETE https://{shop}/admin/api_permissions/current.json with the token (uninstalls the app from the shop)
//   Figma           no revoke endpoint: its tokens expire on their own
// Any other provider holds a key the customer pasted; NazAI can not cancel it, only forget it.

export type Creds = Record<string, unknown>;
export type RevokeOutcome = {
  /** revoked: the provider confirmed. failed: it refused or could not be reached. unsupported: the provider has no way to revoke. none: nothing to revoke. */
  outcome: "revoked" | "failed" | "unsupported" | "none";
  detail: string | null;
};
export type RevokeDeps = { fetchImpl: typeof fetch; env: (name: string) => string | undefined; timeoutMs?: number };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const basic = (id: string, secret: string) => `Basic ${btoa(`${id}:${secret}`)}`;
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

async function call(deps: RevokeDeps, url: string, init: RequestInit): Promise<{ status: number; body: string } | { error: string }> {
  try {
    const res = await deps.fetchImpl(url, { ...init, signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000) });
    return { status: res.status, body: (await res.text().catch(() => "")).slice(0, 300) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function judged(r: { status: number; body: string } | { error: string }, ok: (status: number, body: string) => boolean): RevokeOutcome {
  if ("error" in r) return { outcome: "failed", detail: `The provider could not be reached: ${r.error}` };
  return ok(r.status, r.body) ? { outcome: "revoked", detail: null } : { outcome: "failed", detail: `The provider answered HTTP ${r.status}: ${r.body}` };
}

export async function revokeAtProvider(provider: string, creds: Creds, deps: RevokeDeps): Promise<RevokeOutcome> {
  const access = str(creds.access_token) ?? str(creds.token) ?? str(creds.bot_token);
  const refresh = str(creds.refresh_token);
  switch (provider.toLowerCase()) {
    case "gmail":
    case "google": {
      const token = refresh ?? access;
      if (!token) return { outcome: "none", detail: null };
      const r = await call(deps, "https://oauth2.googleapis.com/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString(),
      });
      // A token Google already considers invalid is as good as revoked.
      return judged(r, (s, b) => s === 200 || (s === 400 && /invalid_token/.test(b)));
    }
    case "slack": {
      if (!access) return { outcome: "none", detail: null };
      const r = await call(deps, "https://slack.com/api/auth.revoke", { method: "POST", headers: { Authorization: `Bearer ${access}` } });
      return judged(r, (s, b) => s === 200 && (/"revoked"\s*:\s*true/.test(b) || /"error"\s*:\s*"(invalid_auth|token_revoked|account_inactive)"/.test(b)));
    }
    case "notion": {
      if (!access) return { outcome: "none", detail: null };
      const id = deps.env("NOTION_CLIENT_ID"), secret = deps.env("NOTION_CLIENT_SECRET");
      if (!id || !secret) return { outcome: "failed", detail: "Notion's client credentials are not configured." };
      const r = await call(deps, "https://api.notion.com/v1/oauth/revoke", {
        method: "POST", headers: { Authorization: basic(id, secret), "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
        body: JSON.stringify({ token: access }),
      });
      return judged(r, (s) => s === 200);
    }
    case "canva": {
      const token = refresh ?? access;
      if (!token) return { outcome: "none", detail: null };
      const id = deps.env("CANVA_CLIENT_ID"), secret = deps.env("CANVA_CLIENT_SECRET");
      if (!id || !secret) return { outcome: "failed", detail: "Canva's client credentials are not configured." };
      const r = await call(deps, "https://api.canva.com/rest/v1/oauth/revoke", {
        method: "POST", headers: { Authorization: basic(id, secret), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
      return judged(r, (s) => s === 200);
    }
    case "shopify": {
      const shop = str(creds.shop_domain);
      if (!access || !shop) return { outcome: "none", detail: null };
      if (!SHOP.test(shop)) return { outcome: "failed", detail: "The stored shop address is not a myshopify.com address." };
      const r = await call(deps, `https://${shop}/admin/api_permissions/current.json`, { method: "DELETE", headers: { "X-Shopify-Access-Token": access } });
      // 401: the token no longer works, which is the goal.
      return judged(r, (s) => s === 200 || s === 401);
    }
    case "figma":
      return { outcome: "unsupported", detail: "Figma has no way to revoke a token; it expires on its own." };
    default:
      return { outcome: "unsupported", detail: "A key you pasted: NazAI has deleted its copy. Revoke the key itself in that service if it may have leaked." };
  }
}

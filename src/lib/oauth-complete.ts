// Finishing a tool connection (user & data isolation, front 4). The provider sends the browser to our public callback, which hands it
// back to /oauth/complete with the same parameters. This page finishes the connection with a request signed in as the person in THIS
// browser; the server refuses unless that person is the one who started it. Pure helpers live here so they can be tested.
export const OAUTH_PROVIDERS = ["slack", "gmail", "notion", "canva", "figma", "shopify"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const providerFrom = (value: string | null): OAuthProvider | null =>
  (OAUTH_PROVIDERS as readonly string[]).includes(value ?? "") ? (value as OAuthProvider) : null;

export const providerLabel = (p: OAuthProvider) => p.charAt(0).toUpperCase() + p.slice(1);

/** Every parameter the provider sent, unchanged (Shopify signs them all), without the one we added. */
export function forwardedQuery(params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of params) if (k !== "provider") q.append(k, v);
  return q.toString();
}

export type CompletionResult = { ok: boolean; message: string; message_to_app: Record<string, unknown> };

/** What the connection screen expects (same shape the old popup page posted): source, ok, message and the provider's extras. */
export function appMessage(provider: OAuthProvider, body: Record<string, unknown> | null, fallbackOk: boolean, fallbackMessage: string): Record<string, unknown> {
  const { source, ok, message, title: _title, ...extras } = body ?? {};
  return {
    source: typeof source === "string" ? source : `nazai-${provider}-oauth`,
    ok: typeof ok === "boolean" ? ok : fallbackOk,
    message: typeof message === "string" ? message : fallbackMessage,
    ...extras,
  };
}

export async function finishConnection(opts: {
  provider: OAuthProvider; search: URLSearchParams; accessToken: string; baseUrl: string; anonKey: string; fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const { provider, search, accessToken, baseUrl, anonKey } = opts;
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f(`${baseUrl.replace(/\/+$/, "")}/functions/v1/${provider}-oauth-callback?${forwardedQuery(search)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, apikey: anonKey },
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return appMessage(provider, body, res.ok, res.ok ? `${providerLabel(provider)} connected.` : `${providerLabel(provider)} could not be connected.`);
  } catch {
    return appMessage(provider, null, false, `${providerLabel(provider)} could not be connected. Check your connection and try again.`);
  }
}

/** The provider said no (the person cancelled): nothing to finish, only to tell the app. */
export const cancelledMessage = (provider: OAuthProvider, reason: string | null) =>
  appMessage(provider, null, false, reason ? `${providerLabel(provider)} connection cancelled (${reason}).` : `${providerLabel(provider)} connection cancelled.`);

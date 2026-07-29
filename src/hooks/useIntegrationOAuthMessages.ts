import { useEffect } from "react";

/**
 * Shared listener for OAuth popup postMessage events. Every integration
 * callback (Google/Gmail bundle, Figma, Canva, and any future provider that
 * follows the same `nazai-<provider>-oauth` convention) routes through here so
 * every consumer gets instant UI updates automatically.
 *
 * Callback receives `{ provider, service, ok, raw }` where:
 *  - `provider` is the canonical provider name (e.g. "Canva", "Figma", "Gmail")
 *  - `service`  is the sub-service for the Google bundle (drive/calendar/analytics)
 *  - `raw`      is the raw message payload for callers that need more context
 */
export type OAuthSuccessInfo = {
  provider: "Gmail" | "Figma" | "Canva" | "Notion" | "Slack" | "Shopify";
  service?: string;
  ok: boolean;
  message?: string;
  raw: Record<string, unknown>;
};

const SOURCE_TO_PROVIDER: Record<string, OAuthSuccessInfo["provider"]> = {
  "nazai-gmail-oauth": "Gmail",
  "nazai-figma-oauth": "Figma",
  "nazai-canva-oauth": "Canva",
  "nazai-notion-oauth": "Notion",
  "nazai-slack-oauth": "Slack",
  "nazai-shopify-oauth": "Shopify",
};

export function useIntegrationOAuthMessages(
  onSuccess: (info: OAuthSuccessInfo) => void,
) {
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const p = ev.data as
        | { source?: string; ok?: boolean; service?: string; message?: string }
        | null;
      if (!p || typeof p.source !== "string") return;
      const provider = SOURCE_TO_PROVIDER[p.source];
      if (!provider) return;
      if (!p.ok) return;
      onSuccess({
        provider,
        service: typeof p.service === "string" ? p.service : undefined,
        ok: true,
        message: typeof p.message === "string" ? p.message : undefined,
        raw: p as Record<string, unknown>,
      });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onSuccess]);
}

/**
 * Expand a provider + optional Google sub-service into every catalogue label
 * that should visibly flip to "Connected" the instant the popup posts back.
 * Returned in BOTH PascalCase catalogue-name form and lowercase provider-key
 * form so consumers that key off either can use the same set.
 */
export function expandConnectedKeys(info: OAuthSuccessInfo): string[] {
  const keys: string[] = [];
  const push = (k: string) => {
    keys.push(k);
    keys.push(k.toLowerCase());
  };
  if (info.provider === "Gmail") {
    const svc = (info.service || "").toLowerCase();
    if (svc === "drive") push("Google Drive");
    else if (svc === "calendar") push("Google Calendar");
    else if (svc === "analytics") push("Google Analytics");
    else push("Gmail");
  } else {
    push(info.provider);
  }
  return keys;
}

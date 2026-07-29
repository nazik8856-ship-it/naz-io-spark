import { useEffect, useRef } from "react";
import {
  subscribeToIntegrationOAuthMessages,
  type OAuthMessageInfo,
} from "@/components/integrations/IntegrationOAuthMessageBridge";

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
export type OAuthSuccessInfo = OAuthMessageInfo & { ok: true };

export function useIntegrationOAuthMessages(
  onSuccess: (info: OAuthSuccessInfo) => void,
  onFailure?: (info: OAuthMessageInfo) => void,
) {
  const successRef = useRef(onSuccess);
  const failureRef = useRef(onFailure);
  successRef.current = onSuccess;
  failureRef.current = onFailure;

  useEffect(() => {
    return subscribeToIntegrationOAuthMessages((info) => {
      if (info.ok) successRef.current(info as OAuthSuccessInfo);
      else failureRef.current?.(info);
    });
  }, []);
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

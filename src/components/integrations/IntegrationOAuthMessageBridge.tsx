import { useEffect, useRef } from "react";

export type OAuthMessageInfo = {
  provider: string;
  service?: string;
  ok: boolean;
  message?: string;
  source: string;
  raw: Record<string, unknown>;
};

type OAuthMessageSubscriber = (info: OAuthMessageInfo) => void;

const SOURCE_TO_PROVIDER: Record<string, string> = {
  "nazai-gmail-oauth": "Gmail",
  "nazai-figma-oauth": "Figma",
  "nazai-canva-oauth": "Canva",
  "nazai-notion-oauth": "Notion",
  "nazai-slack-oauth": "Slack",
  "nazai-shopify-oauth": "Shopify",
};

const subscribers = new Set<OAuthMessageSubscriber>();

function providerFromSource(source: string): string | null {
  const known = SOURCE_TO_PROVIDER[source];
  if (known) return known;

  const match = /^nazai-([a-z0-9-]+)-oauth$/i.exec(source);
  if (!match?.[1]) return null;
  return match[1]
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function parseIntegrationOAuthMessage(data: unknown): OAuthMessageInfo | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  if (typeof payload.source !== "string" || typeof payload.ok !== "boolean") return null;

  const provider = providerFromSource(payload.source);
  if (!provider) return null;

  return {
    provider,
    service: typeof payload.service === "string" ? payload.service : undefined,
    ok: payload.ok,
    message: typeof payload.message === "string" ? payload.message : undefined,
    source: payload.source,
    raw: payload,
  };
}

export function subscribeToIntegrationOAuthMessages(subscriber: OAuthMessageSubscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

/**
 * The only browser `message` listener used by integration OAuth. Mount once at
 * the app root; catalogues and the active connection modal subscribe to this
 * in-memory bus and therefore receive the same callback synchronously.
 */
export default function IntegrationOAuthMessageBridge() {
  const listenerAttached = useRef(false);

  useEffect(() => {
    if (listenerAttached.current) return;
    listenerAttached.current = true;

    const handler = (event: MessageEvent) => {
      const info = parseIntegrationOAuthMessage(event.data);
      if (!info) return;
      subscribers.forEach((subscriber) => subscriber(info));
    };

    window.addEventListener("message", handler);
    return () => {
      listenerAttached.current = false;
      window.removeEventListener("message", handler);
    };
  }, []);

  return null;
}
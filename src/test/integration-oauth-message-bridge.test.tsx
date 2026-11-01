import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import IntegrationOAuthMessageBridge, { isTrustedOAuthOrigin } from "@/components/integrations/IntegrationOAuthMessageBridge";
import { useIntegrationOAuthMessages } from "@/hooks/useIntegrationOAuthMessages";

const SOURCES = [
  ["nazai-gmail-oauth", "Gmail", "drive"],
  ["nazai-canva-oauth", "Canva"],
  ["nazai-slack-oauth", "Slack"],
  ["nazai-figma-oauth", "Figma"],
  ["nazai-shopify-oauth", "Shopify"],
  ["nazai-future-crm-oauth", "Future Crm"],
] as const;

function CatalogueProbe() {
  const [connected, setConnected] = useState<string[]>([]);
  useIntegrationOAuthMessages((info) => {
    setConnected((previous) => [...previous, `${info.provider}:${info.service || ""}`]);
  });
  return <output data-testid="connected">{connected.join("|")}</output>;
}

const BACKEND_ORIGIN = "https://project.supabase.test";

describe("IntegrationOAuthMessageBridge", () => {
  beforeAll(() => { vi.stubEnv("VITE_SUPABASE_URL", BACKEND_ORIGIN); });
  afterAll(() => { vi.unstubAllEnvs(); });

  it("accepts a message only from our own backend's origin", () => {
    expect(isTrustedOAuthOrigin(BACKEND_ORIGIN, "https://project.supabase.test")).toBe(true);
    expect(isTrustedOAuthOrigin(BACKEND_ORIGIN, "https://project.supabase.test/")).toBe(true);
    expect(isTrustedOAuthOrigin("https://evil.example", "https://project.supabase.test")).toBe(false);
    expect(isTrustedOAuthOrigin("https://project.supabase.test.evil.example", "https://project.supabase.test")).toBe(false);
    expect(isTrustedOAuthOrigin("", "https://project.supabase.test")).toBe(false);
    expect(isTrustedOAuthOrigin(BACKEND_ORIGIN, "")).toBe(false);
    expect(isTrustedOAuthOrigin(BACKEND_ORIGIN, "not a url")).toBe(false);
  });

  it("ignores a connected message from any other window", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<><IntegrationOAuthMessageBridge /><CatalogueProbe /></>); });
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { source: "nazai-slack-oauth", ok: true }, origin: "https://evil.example" })); });
    expect(container.querySelector('[data-testid="connected"]')!.textContent).toBe("");
    act(() => root.unmount());
    container.remove();
  });

  it("uses one browser listener and synchronously broadcasts every OAuth source", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <>
          <IntegrationOAuthMessageBridge />
          <CatalogueProbe />
          <CatalogueProbe />
        </>,
      );
    });

    expect(addEventListener.mock.calls.filter(([type]) => type === "message")).toHaveLength(1);

    SOURCES.forEach(([source, provider, service]) => {
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { source, ok: true, service },
          origin: BACKEND_ORIGIN,
        }));
      });
      container.querySelectorAll('[data-testid="connected"]').forEach((probe) => {
        expect(probe.textContent).toContain(`${provider}:${service || ""}`);
      });
    });

    act(() => root.unmount());
    container.remove();
  });
});
import { render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import IntegrationOAuthMessageBridge from "@/components/integrations/IntegrationOAuthMessageBridge";
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

describe("IntegrationOAuthMessageBridge", () => {
  it("uses one browser listener and synchronously broadcasts every OAuth source", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const view = render(
      <>
        <IntegrationOAuthMessageBridge />
        <CatalogueProbe />
        <CatalogueProbe />
      </>,
    );

    expect(addEventListener.mock.calls.filter(([type]) => type === "message")).toHaveLength(1);

    SOURCES.forEach(([source, provider, service]) => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { source, ok: true, service },
      }));
      view.getAllByTestId("connected").forEach((probe) => {
        expect(probe.textContent).toContain(`${provider}:${service || ""}`);
      });
    });
  });
});
import { describe, expect, it, vi } from "vitest";
import { appMessage, cancelledMessage, finishConnection, forwardedQuery, providerFrom, OAUTH_PROVIDERS } from "@/lib/oauth-complete";
import { isTrustedOAuthOrigin } from "@/components/integrations/IntegrationOAuthMessageBridge";

describe("finishing a tool connection", () => {
  it("knows exactly the six providers and nothing else (the provider decides which function is called)", () => {
    expect([...OAUTH_PROVIDERS].sort()).toEqual(["canva", "figma", "gmail", "notion", "shopify", "slack"]);
    expect(providerFrom("slack")).toBe("slack");
    expect(providerFrom("../admin")).toBeNull();
    expect(providerFrom("slack-oauth-callback/../x")).toBeNull();
    expect(providerFrom(null)).toBeNull();
  });

  it("forwards every parameter the provider sent, in order, without the one we added", () => {
    const q = forwardedQuery(new URLSearchParams("provider=shopify&shop=a.myshopify.com&code=c&hmac=h&state=s&timestamp=1"));
    expect(q).toBe("shop=a.myshopify.com&code=c&hmac=h&state=s&timestamp=1");
  });

  it("calls the provider's own callback as a POST, signed in as the person in this browser", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ source: "nazai-slack-oauth", ok: true, message: "Connected to Acme.", title: "Slack connected", team: "T1" }), { status: 200 }));
    const out = await finishConnection({ provider: "slack", search: new URLSearchParams("provider=slack&code=c&state=s"), accessToken: "tok", baseUrl: "https://p.supabase.co/", anonKey: "anon", fetchImpl: f as unknown as typeof fetch });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://p.supabase.co/functions/v1/slack-oauth-callback?code=c&state=s");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(out).toEqual({ source: "nazai-slack-oauth", ok: true, message: "Connected to Acme.", team: "T1" });
  });

  it("tells the app exactly what the server said when it refuses (a different account started it)", async () => {
    const f = async () => new Response(JSON.stringify({ ok: false, message: "This connection was started from a different NazAI account." }), { status: 403 });
    const out = await finishConnection({ provider: "gmail", search: new URLSearchParams("code=c&state=s"), accessToken: "t", baseUrl: "https://p", anonKey: "a", fetchImpl: f as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    expect(out.source).toBe("nazai-gmail-oauth");
    expect(String(out.message)).toContain("different NazAI account");
  });

  it("never says connected when the call itself fails", async () => {
    const f = async () => { throw new Error("network"); };
    const out = await finishConnection({ provider: "notion", search: new URLSearchParams("code=c&state=s"), accessToken: "t", baseUrl: "https://p", anonKey: "a", fetchImpl: f as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    const garbled = await finishConnection({ provider: "notion", search: new URLSearchParams("code=c&state=s"), accessToken: "t", baseUrl: "https://p", anonKey: "a", fetchImpl: (async () => new Response("<html>", { status: 500 })) as unknown as typeof fetch });
    expect(garbled.ok).toBe(false);
  });

  it("a cancelled connection is reported as failed with the provider's reason, and the extras never override the verdict", () => {
    const m = cancelledMessage("figma", "access_denied");
    expect(m).toMatchObject({ source: "nazai-figma-oauth", ok: false });
    expect(String(m.message)).toContain("access_denied");
    expect(appMessage("slack", { ok: false, message: "no", team: "T" }, true, "x")).toEqual({ source: "nazai-slack-oauth", ok: false, message: "no", team: "T" });
  });

  it("the connection screen accepts the finishing page's own origin, our backend's older popup, and nobody else", () => {
    expect(isTrustedOAuthOrigin("https://nazai.net", "https://p.supabase.co", "https://nazai.net")).toBe(true);
    expect(isTrustedOAuthOrigin("https://p.supabase.co", "https://p.supabase.co", "https://nazai.net")).toBe(true);
    expect(isTrustedOAuthOrigin("https://evil.example", "https://p.supabase.co", "https://nazai.net")).toBe(false);
    expect(isTrustedOAuthOrigin("", "https://p.supabase.co", "https://nazai.net")).toBe(false);
  });
});

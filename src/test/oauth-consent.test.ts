// The consent screen is the only gate when any MCP app may register itself (Supabase dynamic client registration), so it must show
// where the app really sends the person, not only the name the app chose for itself.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostOf } from "@/lib/oauth-consent";

describe("consent screen", () => {
  it("reads the host of an address and refuses anything that is not a web address", () => {
    expect(hostOf("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(hostOf("http://localhost:6274/cb")).toBe("localhost:6274");
    expect(hostOf("javascript:alert(1)")).toBeNull();
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });

  it("shows the redirect host and the warning, and keeps Approve and Deny", () => {
    const src = readFileSync(join(__dirname, "../pages/OAuthConsent.tsx"), "utf8");
    expect(src).toContain("consent-origin");
    expect(src).toContain("hostOf(details.redirect_uri)");
    expect(src).toContain("Approve only if you started this connection yourself");
    expect(src).toContain("approveAuthorization");
    expect(src).toContain("denyAuthorization");
  });
});

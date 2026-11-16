// Two-step sign-in covers every page (src/components/MfaGate.tsx): a signed-in session that still owes its authenticator code sees
// the code screen on Control, API keys and the dashboard too, not an empty-looking account.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const auth = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, loading: false, levels: { currentLevel: "aal1", nextLevel: "aal2" } as { currentLevel: string; nextLevel: string } | null, fail: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user, loading: auth.loading, signOut: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { mfa: { getAuthenticatorAssuranceLevel: async () => (auth.fail ? { data: null, error: { message: "x" } } : { data: auth.levels, error: null }), listFactors: async () => ({ data: { totp: [] }, error: null }) } } },
}));
vi.mock("@/components/MfaChallenge", () => ({ MfaChallenge: () => <div data-testid="mfa-challenge">Enter the code</div> }));
import { MfaGate } from "@/components/MfaGate";

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><MfaGate><div data-testid="page">page</div></MfaGate></MemoryRouter>);

describe("two-step sign-in on every page", () => {
  beforeEach(() => { auth.user = { id: "u1" }; auth.loading = false; auth.levels = { currentLevel: "aal1", nextLevel: "aal2" }; auth.fail = false; });

  it("a session that owes its code is asked for it on API keys, Control and the dashboard, and the page is not shown", async () => {
    for (const p of ["/control-system/api-keys", "/control-system/outer", "/dashboard/home"]) {
      const { unmount } = at(p);
      expect(await screen.findByTestId("mfa-challenge")).toBeTruthy();
      expect(screen.queryByTestId("page")).toBeNull();
      unmount();
    }
  });

  it("a session that used its code, or a person without an authenticator app, sees the page", async () => {
    auth.levels = { currentLevel: "aal2", nextLevel: "aal2" };
    const a = at("/control-system/api-keys"); expect(await screen.findByTestId("page")).toBeTruthy(); a.unmount();
    auth.levels = { currentLevel: "aal1", nextLevel: "aal1" };
    at("/control-system/api-keys"); expect(await screen.findByTestId("page")).toBeTruthy();
  });

  it("signed-out visitors and the pages a sign-in needs are left alone", async () => {
    auth.user = null;
    const a = at("/control-system"); expect(screen.getByTestId("page")).toBeTruthy(); a.unmount();
    auth.user = { id: "u1" };
    at("/auth/callback"); expect(screen.getByTestId("page")).toBeTruthy();
  });

  it("nothing of the page shows while the check runs; a check that fails does not lock the person out", async () => {
    auth.fail = true;
    at("/control-system/api-keys");
    expect(screen.queryByTestId("page")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("page")).toBeTruthy());
  });
});

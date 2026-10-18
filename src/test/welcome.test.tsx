import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { isFirstVisit } from "@/lib/welcome";

const state = vi.hoisted(() => ({ user: null as unknown, updateUser: vi.fn(async () => ({ data: {}, error: null })) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: vi.fn(), updateUser: state.updateUser } } }));
import Dashboard from "@/pages/Dashboard";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe("isFirstVisit", () => {
  it("is true for a recent account that has not chosen yet", () => {
    expect(isFirstVisit({ created_at: ago(0.01), user_metadata: {} }, NOW)).toBe(true);
    expect(isFirstVisit({ created_at: ago(3) }, NOW)).toBe(true);
  });
  it("is false once the person chose, for an older account, and with no user or bad data", () => {
    expect(isFirstVisit({ created_at: ago(1), user_metadata: { welcome_seen: true } }, NOW)).toBe(false);
    expect(isFirstVisit({ created_at: ago(30), user_metadata: {} }, NOW)).toBe(false);
    expect(isFirstVisit(null, NOW)).toBe(false);
    expect(isFirstVisit({ created_at: "nope" }, NOW)).toBe(false);
    expect(isFirstVisit({}, NOW)).toBe(false);
  });
});

const renderPage = () => render(
  <MemoryRouter initialEntries={["/dashboard"]}>
    <Routes>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/generator-home" element={<div>generator page</div>} />
      <Route path="/control-system" element={<div>control page</div>} />
    </Routes>
  </MemoryRouter>,
);

describe("Welcome screen", () => {
  beforeEach(() => { state.updateUser.mockClear(); });

  it("a returning user sees the subtitle and both cards, with no first-time labels", () => {
    state.user = { email: "a@b.c", created_at: ago(40), user_metadata: {} };
    renderPage();
    expect(screen.getByTestId("welcome-subtitle").textContent).toMatch(/Generator.*AI Control System/);
    expect(screen.getByTestId("card-generator").textContent).toMatch(/Describe an agent/);
    expect(screen.getByTestId("card-control-system").textContent).toMatch(/require approval/);
    expect(screen.queryAllByTestId("first-time-badge")).toHaveLength(0);
    expect(screen.queryAllByTestId("first-time-when")).toHaveLength(0);
  });

  it("a new user sees a badge and a 'choose this when' line on each card", () => {
    state.user = { email: "a@b.c", created_at: new Date().toISOString(), user_metadata: {} };
    renderPage();
    expect(screen.getAllByTestId("first-time-badge").map((e) => e.textContent)).toEqual(["Start here", "Next step"]);
    expect(screen.getAllByTestId("first-time-when").map((e) => e.textContent)).toEqual([
      expect.stringMatching(/create something new/), expect.stringMatching(/already runs/),
    ]);
  });

  it("choosing a card routes as before and, on a first visit, remembers it on the account", () => {
    state.user = { email: "a@b.c", created_at: new Date().toISOString(), user_metadata: {} };
    renderPage();
    fireEvent.click(screen.getByTestId("card-generator"));
    expect(screen.getByText("generator page")).toBeTruthy();
    expect(state.updateUser).toHaveBeenCalledWith({ data: { welcome_seen: true } });
  });

  it("a returning user's choice routes without touching the account", () => {
    state.user = { email: "a@b.c", created_at: ago(40), user_metadata: {} };
    renderPage();
    fireEvent.click(screen.getByTestId("card-control-system"));
    expect(screen.getByText("control page")).toBeTruthy();
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});

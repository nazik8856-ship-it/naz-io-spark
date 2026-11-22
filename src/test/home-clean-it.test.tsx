// Context Day 2: the homepage says what NazAI is now (control for the AI you already use) and its main action is Clean it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));
vi.mock("@/lib/context-clean", () => ({ FREE_CLEANS_PER_DAY: 15 }));
vi.mock("@/components/AuthModal", () => ({
  default: ({ open, onSuccess }: { open: boolean; onSuccess: () => void }) => open ? <button data-testid="fake-sign-in" onClick={onSuccess}>sign in</button> : null,
}));
vi.mock("@/components/AuthTransition", () => ({
  default: ({ active, onComplete }: { active: boolean; onComplete: () => void }) => active ? <button data-testid="fake-transition-done" onClick={onComplete}>done</button> : null,
}));
vi.mock("@/components/mission/MissionWorkspace", () => ({ default: () => null }));
vi.mock("@/components/interactions/CursorTrail", () => ({ default: () => null }));
vi.mock("@/components/interactions/NeuralFeedback", () => ({ default: () => null }));
vi.mock("@/components/interactions/SubscriptionVacuum", () => ({ default: () => null }));

import Workflower, { CLEAN_IT_PATH } from "@/pages/Workflower";

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }
const renderHome = () => render(
  <MemoryRouter initialEntries={["/"]}>
    <Routes><Route path="/" element={<Workflower />} /><Route path="*" element={<Where />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  auth.user = null;
  // jsdom has no IntersectionObserver (used by the page's scroll animations)
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
});

describe("Homepage: control for the AI you already use", () => {
  it("says what NazAI is, shows a before/after clean, and offers Clean it free", async () => {
    renderHome();
    expect(screen.getByTestId("home-eyebrow").textContent).toContain("AI Control Layer");
    expect(screen.getAllByRole("heading", { level: 1 }).some((h) => /Control the AI\s*You Already Use\./.test(h.textContent ?? ""))).toBe(true);
    const demo = screen.getByTestId("home-clean-demo");
    expect(within(demo).getByTestId("home-demo-before").textContent).toContain("guaranteed");
    expect(within(demo).getByTestId("home-demo-after").textContent).toContain("within 30 days of delivery");
    fireEvent.click(within(demo).getByRole("tab", { name: "Gemini" }));
    await waitFor(() => expect(within(demo).getByTestId("home-demo-before").textContent).toContain("4242"));
    expect(screen.getByTestId("home-clean-cta").textContent).toContain("Clean it — free");
    expect(screen.getByText(/15 free cleans a day/)).toBeTruthy();
  });

  it("signed in: Clean it goes straight to Outer Control's first screen", () => {
    auth.user = { id: "u1" };
    renderHome();
    fireEvent.click(screen.getByTestId("home-clean-cta"));
    expect(screen.getByTestId("where").textContent).toBe(CLEAN_IT_PATH);
    expect(CLEAN_IT_PATH).toBe("/control-system/outer");
  });

  it("signed out: sign in first, then Clean it; the business-task link still leads to the dashboard", () => {
    const first = renderHome();
    fireEvent.click(screen.getByTestId("home-nav-clean"));
    fireEvent.click(screen.getByTestId("fake-sign-in"));
    fireEvent.click(screen.getByTestId("fake-transition-done"));
    expect(screen.getByTestId("where").textContent).toBe("/control-system/outer");
    first.unmount();
    renderHome();
    fireEvent.click(screen.getByTestId("home-mission-link"));
    fireEvent.click(screen.getByTestId("fake-sign-in"));
    fireEvent.click(screen.getByTestId("fake-transition-done"));
    expect(screen.getByTestId("where").textContent).toBe("/dashboard");
  });
});

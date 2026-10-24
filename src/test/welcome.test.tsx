import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { isFirstVisit } from "@/lib/welcome";

const state = vi.hoisted(() => ({ user: null as unknown, updateUser: vi.fn(async () => ({ data: {}, error: null })), projects: [] as unknown[] }));
vi.mock("@/hooks/useProjectList", () => ({ useProjectList: () => ({ items: state.projects, count: state.projects.length, loading: false, reload: vi.fn() }) }));
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
      <Route path="/projects" element={<div>projects page</div>} />
    </Routes>
  </MemoryRouter>,
);

describe("Welcome screen", () => {
  beforeEach(() => { state.updateUser.mockClear(); state.projects = []; });

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

  it("shows a preview inside each card, labelled as an illustration, for every user", () => {
    state.user = { email: "a@b.c", created_at: ago(40), user_metadata: {} };
    renderPage();
    expect(screen.getByTestId("card-generator").querySelector("[data-testid=preview-generator]")).toBeTruthy();
    expect(screen.getByTestId("card-control-system").textContent).toMatch(/Refund over \$500.*Approval/);
    expect(screen.getByTestId("welcome-illustration-note").textContent).toMatch(/illustrations with sample content, not your data/);
    expect(screen.getByTestId("welcome-link").textContent).toMatch(/Build → Control/);
  });

  it("with no project there is no Projects card: two cards, as before", () => {
    state.user = { email: "a@b.c", created_at: ago(40), user_metadata: {} };
    renderPage();
    expect(screen.queryByTestId("card-projects")).toBeNull();
    expect(screen.getByTestId("welcome-link").textContent).toBe("Build → Control");
    expect(screen.getByTestId("welcome-illustration-note").textContent).toMatch(/^Previews are illustrations/);
  });

  it("with a project the third card appears in the same style, shows the real projects, and opens Projects", () => {
    state.user = { email: "a@b.c", created_at: ago(40), user_metadata: {} };
    state.projects = [
      { key: "imported:p1", id: "p1", name: "Brand guide", origin: "imported", kind: "imported", updated_at: "2026-10-24", href: "/projects/p1", imported: { source_mode: "linked", source_kind: "notion", sync_error: null, write_back: false, last_synced_at: null, created_at: "2026-10-24" } },
      { key: "imported:p2", id: "p2", name: "Launch notes", origin: "imported", kind: "imported", updated_at: "2026-10-23", href: "/projects/p2", imported: { source_mode: "snapshot", source_kind: "paste", sync_error: null, write_back: false, last_synced_at: null, created_at: "2026-10-23" } },
      { key: "agent:a1", id: "a1", name: "Support agent", origin: "generated", kind: "agent", updated_at: "2026-10-20", href: "/generated/agent/a1" },
    ];
    renderPage();
    const card = screen.getByTestId("card-projects");
    expect(card.textContent).toMatch(/WORKSPACE[\s\S]*Projects[\s\S]*imported and generated projects/);
    expect(screen.getAllByTestId("preview-project").map((e) => e.textContent)).toEqual(["Brand guideLinked", "Launch notesSnapshot", "Support agentGenerated"]);
    expect(screen.getByTestId("preview-projects-status").textContent).toBe("● 3 projects · all under control");
    expect(screen.getByTestId("welcome-link-3").textContent).toBe("Build → Control → Projects");
    expect(screen.queryByTestId("welcome-link")).toBeNull();
    expect(screen.getByTestId("welcome-illustration-note").textContent).toMatch(/Projects shows your real projects/);
    fireEvent.click(card);
    expect(screen.getByText("projects page")).toBeTruthy();
  });

  it("a project whose sync failed is counted as needing attention on the card", () => {
    state.user = { email: "a@b.c", created_at: ago(40), user_metadata: {} };
    state.projects = [{ key: "imported:p1", id: "p1", name: "Brand guide", origin: "imported", kind: "imported", updated_at: "x", href: "/projects/p1", imported: { source_mode: "linked", source_kind: "notion", sync_error: "Notion refused", write_back: false, last_synced_at: null, created_at: "x" } }];
    renderPage();
    expect(screen.getByTestId("preview-projects-status").textContent).toBe("● 1 project · 1 needs attention");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within, configure } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The page loads the project list first and then that project's data, so a slow runner needs longer than the 1 s default.
configure({ asyncUtilTimeout: 5000 });

const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  invoke: vi.fn(),
  updates: [] as { table: string; patch: unknown }[],
  approvals: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "in", "order", "limit", "gte"]) q[m] = () => q;
    q.update = (patch: unknown) => { state.updates.push({ table, patch }); return q; };
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: state.tables[table] ?? [], error: null }).then(res);
    return q;
  };
  return { supabase: { from: result, rpc: async () => ({ error: null }), functions: { invoke: (...a: unknown[]) => state.invoke(...a) } } };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useActiveAccount", () => ({ useActiveAccount: () => ({ accountId: "u1", role: "self", permissions: null }) }));
vi.mock("@/hooks/useSpendSafetyStatus", () => ({ useSpendSafetyStatus: () => ({ loading: false, capIsCustom: true }) }));
vi.mock("@/hooks/usePendingApprovalsFeed", () => ({ usePendingApprovalsFeed: () => ({ approvals: state.approvals, resolvingId: null, executingId: null, resolve: vi.fn(), execute: vi.fn() }) }));
vi.mock("@/components/control/ProjectSwitcher", () => ({ default: () => null }));
vi.mock("@/components/governance/GovernanceHealthDot", () => ({ default: () => null }));
vi.mock("@/hooks/useControlDashboardData", () => ({
  useControlDashboardData: () => ({
    loading: false, coveragePct: 50, coverageGapCount: 1, coverageTotal: 2, coverageCells: [], healthPct: 99,
    spend: { today: 0.5, cap: 5, capIsCustom: true, series: [] }, incidents: { openCount: 0, series: [] },
    efficiency: { autonomousPct: null, series: [] }, pendingApprovalsCount: 0,
    setup: { hardRules: true, safetyRules: false, spendCapCustom: true, agentDeployed: true, pct: 75 },
    days: [], accountTrustScore: null, accountHealth: null, trustScoreValue: null, refetch: () => {},
  }),
}));

import ControlSystem from "@/pages/ControlSystem";

Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const renderPage = () => render(<MemoryRouter><ControlSystem /></MemoryRouter>);

const hardRule = { id: "h1", rule_text: "Never email more than 1 person", action_type_pattern: "send_email", effect: "always_block", enabled: true, shadow_mode: false, agent_id: null, required_approvals: null, created_at: "2026-10-01T00:00:00Z" };
const decision = { id: "d1", created_at: new Date().toISOString(), decision: "block", source: "hard_rule", action_type: "send_email", description: "Send email to all customers", reasoning: "A hard rule always blocks this.", hard_rule_id: "h1", escalated: false };

const AGENT = { id: "a1", name: "Support agent", created_at: "2026-10-12T00:00:00Z" };
const WEBSITE = { id: "w1", name: "Lisbon Yoga Studio", title: "Lisbon Yoga Studio", created_at: "2026-10-11T00:00:00Z", generation_notes: ["A price was not in your brief."], trust_score: 80 };

describe("Inner Control page", () => {
  beforeEach(() => {
    sessionStorage.clear();
    state.updates = [];
    state.approvals = [];
    state.invoke = vi.fn();
    state.tables = { hard_rules: [hardRule], safety_rules: [], agents: [AGENT], websites: [], project_time: [], agent_decisions: [decision] };
  });

  it("puts setup & status first, then your rules, then recent activity, then the detail cards", async () => {
    renderPage();
    const status = await screen.findByTestId("setup-status");
    await screen.findByTestId("rule-row-hard:h1");
    const order = ["setup-status", "your-rules", "recent-activity"].map((id) => screen.getByTestId(id));
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(status.querySelector("[data-testid=status-line]")?.textContent).toBe("1 rule active – Coverage 50%");
    const coverage = screen.getByLabelText("Rule coverage and system health");
    expect(order[2].compareDocumentPosition(coverage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("with no rules, shows the primary template button and the rules empty state", async () => {
    state.tables = { hard_rules: [], safety_rules: [], agents: [AGENT], websites: [], project_time: [], agent_decisions: [] };
    renderPage();
    expect(await screen.findByRole("button", { name: /Start from a Policy Template/ })).toBeTruthy();
    expect(screen.getByTestId("rules-empty")).toBeTruthy();
    expect(screen.getByTestId("activity-empty")).toBeTruthy();
    expect(screen.queryByTestId("status-line")).toBeNull();
  });

  it("Disable writes enabled=false on the rule's own table", async () => {
    renderPage();
    const row = await screen.findByTestId("rule-row-hard:h1");
    fireEvent.click(within(row).getByRole("button", { name: /^Disable rule/ }));
    await waitFor(() => expect(state.updates).toContainEqual({ table: "hard_rules", patch: { enabled: false } }));
  });

  it("an activity row jumps to its rule and can put its question in the chat", async () => {
    renderPage();
    const act = await screen.findByTestId("activity-row");
    fireEvent.click(within(act).getByRole("button", { name: /Rule: Never email/ }));
    expect(screen.getByTestId("rule-row-hard:h1").className).toMatch(/ring-2/);
    fireEvent.click(within(act).getByRole("button", { name: /Ask the chat/ }));
    const box = screen.getAllByLabelText("Message AI Control System")[0] as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe('Why was "Send email to all customers" blocked?'));
    expect(state.invoke).not.toHaveBeenCalled();
  });

  it("shows the first 5 rules and expands to all of them", async () => {
    state.tables = { hard_rules: Array.from({ length: 7 }, (_, i) => ({ ...hardRule, id: `h${i + 1}`, rule_text: `Rule number ${i + 1}` })), safety_rules: [], agents: [AGENT], websites: [], project_time: [], agent_decisions: [] };
    renderPage();
    await screen.findByTestId("rule-row-hard:h1");
    expect(screen.getAllByTestId(/^rule-row-/)).toHaveLength(5);
    fireEvent.click(screen.getByTestId("rules-expand"));
    expect(screen.getAllByTestId(/^rule-row-/)).toHaveLength(7);
    expect(screen.getByTestId("rules-expand").textContent).toMatch(/Show fewer/);
    fireEvent.click(screen.getByTestId("rules-expand"));
    expect(screen.getAllByTestId(/^rule-row-/)).toHaveLength(5);
  });

  it("with 5 rules or fewer there is nothing to expand", async () => {
    renderPage();
    await screen.findByTestId("rule-row-hard:h1");
    expect(screen.queryByTestId("rules-expand")).toBeNull();
    expect(screen.queryByTestId("activity-expand")).toBeNull();
  });

  it("shows the first 5 decisions and expands to all of them", async () => {
    state.tables = { hard_rules: [hardRule], safety_rules: [], agents: [AGENT], websites: [], project_time: [], agent_decisions: Array.from({ length: 8 }, (_, i) => ({ ...decision, id: `d${i}`, description: `Action ${i}` })) };
    renderPage();
    await screen.findAllByTestId("activity-row");
    expect(screen.getAllByTestId("activity-row")).toHaveLength(5);
    fireEvent.click(screen.getByTestId("activity-expand"));
    expect(screen.getAllByTestId("activity-row")).toHaveLength(8);
  });

  it("pending approvals are not shown in the chat panel; the Approvals button carries their count", async () => {
    state.approvals = [{ id: "a1", action_type: "send_email", description: "Refund the customer", risk_level: "high", status: "pending", created_at: new Date().toISOString() }];
    renderPage();
    await screen.findByTestId("rule-row-hard:h1");
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.queryByText("Refund the customer")).toBeNull();
    expect(screen.getByTestId("approvals-count").textContent).toBe("1");
  });

  it("shows live status while a task runs, then the answer", async () => {
    let finish: (v: unknown) => void = () => {};
    state.invoke = vi.fn(() => new Promise((res) => { finish = res; }));
    renderPage();
    await screen.findByTestId("rule-row-hard:h1");
    const box = screen.getAllByLabelText("Message AI Control System")[0];
    fireEvent.change(box, { target: { value: "Which rules are active?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Message sent to the Control System")).toBeTruthy();
    expect(screen.getByText("Checking 1 active rule and scoring risk")).toBeTruthy();
    finish({ data: { mode: "chat", reply: "One hard rule is active." }, error: null });
    expect(await screen.findByText("One hard rule is active.")).toBeTruthy();
    expect(screen.queryByText("Checking 1 active rule and scoring risk")).toBeNull();
  });

  it("Add rule opens the rule editor in a closable window", async () => {
    renderPage();
    await screen.findByTestId("rule-row-hard:h1");
    expect(screen.queryByTestId("rule-editor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add rule/ }));
    expect(await screen.findByTestId("rule-editor")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("rule-editor"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("rule-editor")).toBeNull());
  });
});

describe("Inner Control chat extras", () => {
  it("has the + and sliders buttons in the chat box, with no tone picker", async () => {
    state.tables = { hard_rules: [hardRule], safety_rules: [], agents: [AGENT], websites: [], project_time: [], agent_decisions: [] };
    renderPage();
    await screen.findByTestId("rule-row-hard:h1");
    const composer = screen.getAllByTestId("chat-composer")[0];
    expect(within(composer).getByTitle("Attach")).toBeTruthy();
    fireEvent.click(within(composer).getByTitle("Tune"));
    expect(await screen.findByText("Pull data from integration")).toBeTruthy();
    expect(screen.queryByText("Tone")).toBeNull();
  });

  it("sends an attached link along with the message and shows only its name in the chat", async () => {
    state.tables = { hard_rules: [hardRule], safety_rules: [], agents: [AGENT], websites: [], project_time: [], agent_decisions: [] };
    state.invoke = vi.fn(() => Promise.resolve({ data: { mode: "chat", reply: "ok" }, error: null }));
    renderPage();
    await screen.findByTestId("rule-row-hard:h1");
    const composer = screen.getAllByTestId("chat-composer")[0];
    fireEvent.click(within(composer).getByTitle("Attach"));
    fireEvent.change(await screen.findByPlaceholderText("Paste URL…"), { target: { value: "https://x.test/policy" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const box = within(composer).getByLabelText("Message AI Control System");
    fireEvent.change(box, { target: { value: "Can I act on this?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(state.invoke).toHaveBeenCalled());
    const body = (state.invoke.mock.calls[0] as unknown[])[1] as { body: { message: string } };
    expect(body.body.message).toContain("Can I act on this?");
    expect(body.body.message).toContain("https://x.test/policy");
    expect(await screen.findByText(/📎 URL · https:\/\/x.test\/policy/)).toBeTruthy();
  });
});


describe("Inner Control always shows one existing project", () => {
  beforeEach(() => {
    sessionStorage.clear();
    state.updates = []; state.approvals = []; state.invoke = vi.fn();
    state.tables = { hard_rules: [hardRule, { ...hardRule, id: "h2", rule_text: "Only for another agent", agent_id: "someone-else" }], safety_rules: [], agents: [AGENT], websites: [WEBSITE], project_time: [], agent_decisions: [decision] };
  });

  it("opens on the project the person has spent the most time on, and says which one it is", async () => {
    state.tables.project_time = [{ kind: "website", project_id: "w1", seconds: 4000 }, { kind: "agent", project_id: "a1", seconds: 60 }];
    renderPage();
    expect((await screen.findByTestId("project-heading")).textContent).toMatch(/Lisbon Yoga Studio.*website/);
    expect(screen.getByLabelText("Choose the project Inner Control shows").getAttribute("data-value")).toBe("website:w1");
  });

  it("with no time recorded opens on the newest project", async () => {
    renderPage();
    expect((await screen.findByTestId("project-heading")).textContent).toMatch(/Support agent.*agent/);
  });

  it("changing the project changes what the page is about", async () => {
    renderPage();
    await screen.findByTestId("project-heading");
    fireEvent.click(screen.getByLabelText("Choose the project Inner Control shows"));
    fireEvent.click(screen.getByTestId("project-option-website:w1"));
    await waitFor(() => expect(screen.getByTestId("project-heading").textContent).toMatch(/Lisbon Yoga Studio/));
    expect(screen.getByTestId("website-check")).toBeTruthy();
    expect(sessionStorage.getItem("nazai_inner_project:u1")).toBe("website:w1");
  });

  it("shows only the rules that belong to the project: another agent's rule is left out", async () => {
    renderPage();
    await screen.findByTestId("rule-row-hard:h1");
    expect(screen.queryByTestId("rule-row-hard:h2")).toBeNull();
  });

  it("a website shows how it was checked, no decisions of its own, and the rules for all agents", async () => {
    state.tables.project_time = [{ kind: "website", project_id: "w1", seconds: 100 }];
    renderPage();
    const check = await screen.findByTestId("website-check");
    fireEvent.click(within(check).getByRole("button"));
    expect(check.textContent).toMatch(/price was not in your brief/);
    expect((await screen.findByTestId("activity-empty")).textContent).toMatch(/takes no actions of its own/);
    expect(screen.getByTestId("setup-status").textContent).toMatch(/Website generated/);
    await screen.findByTestId("rule-row-hard:h1");
  });

  it("an account with no agent or website shows no dashboard of unrelated numbers, only how to get a project", async () => {
    state.tables.agents = []; state.tables.websites = [];
    renderPage();
    expect(await screen.findByTestId("no-projects")).toBeTruthy();
    expect(screen.queryByTestId("setup-status")).toBeNull();
    expect(screen.queryByTestId("your-rules")).toBeNull();
    expect(screen.getByTestId("project-picker-empty")).toBeTruthy();
  });

  it("a saved choice that no longer exists falls back to an existing project", async () => {
    sessionStorage.setItem("nazai_inner_project:u1", "agent:deleted");
    renderPage();
    expect((await screen.findByTestId("project-heading")).textContent).toMatch(/Support agent/);
  });
});

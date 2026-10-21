import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ approvals: [] as unknown[], invoke: vi.fn(), auth: { user: { id: "u1" } }, account: { accountId: "u1", role: "owner", permissions: null } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useActiveAccount", () => ({ useActiveAccount: () => state.account }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const data = table === "pending_approvals" ? state.approvals : [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "not", "in", "or", "order", "limit", "gte", "lte"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null, count: data.length }).then(res);
    return q;
  };
  return { supabase: { from, rpc: () => ({ maybeSingle: async () => ({ data: null, error: null }), then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r) }), functions: { invoke: state.invoke } } };
});

import ControlApprovals from "@/pages/ControlApprovals";
import { toast } from "@/hooks/use-toast";

const row = (over: Record<string, unknown>) => ({
  id: "a1", user_id: "u1", agent_id: null, decision_id: null, action_type: "outer_control_first_contact", provider: "ChatGPT (OpenAI)",
  description: 'First contact with the external tool "ChatGPT (OpenAI)" (api.openai.com).', reason: "Outer Control has never contacted this destination before.",
  risk_tier: "high", status: "approved", created_at: "2026-10-21T01:46:45Z", resolved_at: "2026-10-21T01:47:06Z", resolved_by: "u1",
  approvals: [{ at: "2026-10-21T01:47:06Z", by: "u1" }], required_approvals: 1, executed_at: null, execution_error: null, execution_summary: null,
  comment: null, assigned_to: null, escalated_at: null, origin: "external-api", params: {}, ...over,
});
const renderPage = () => render(<MemoryRouter><ControlApprovals /></MemoryRouter>);

describe("an approved item with nothing to run never offers Run it", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("the reported case: an approved Outer Control first contact says it carries on by itself, with no Run it button", async () => {
    state.approvals = [row({})];
    renderPage();
    expect((await screen.findByTestId("nothing-to-run")).textContent).toMatch(/Outer Control picks this approval up by itself/);
    expect(screen.queryByText("Run it")).toBeNull();
    expect(screen.getByText("Open Outer Control")).toBeTruthy();
  });

  it("an approval an agent run waits on says so, with no Run it button", async () => {
    state.approvals = [row({ action_type: "refund_customer", agent_id: "ag1" })];
    renderPage();
    expect((await screen.findByTestId("nothing-to-run")).textContent).toMatch(/agent run that asked/);
    expect(screen.queryByText("Run it")).toBeNull();
  });

  it("a real write still has Run it, and a reply that there was nothing to run is not shown as an error", async () => {
    state.approvals = [row({ action_type: "send_email" })];
    state.invoke.mockResolvedValue({ data: { ok: true, executed: false, nothing_to_run: true, message: "Nothing to run here." }, error: null });
    renderPage();
    fireEvent.click(await screen.findByText("Run it"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Nothing to run", description: "Nothing to run here." }));
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const inserted: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const data: Record<string, unknown> = {
    safety_rules: [],
    agents: [{ id: "agent-1", name: "Support agent" }],
    api_keys: [{ id: "key-1", name: "Zendesk bot" }],
    profiles: { require_dual_control_for_policy: false },
  };
  const chain = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, is: () => q, order: () => q, gte: () => q,
      maybeSingle: () => Promise.resolve({ data: data[table], error: null }),
      insert: (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve({ error: null }); },
      update: () => q, delete: () => q,
      then: (res: any, rej: any) => Promise.resolve({ data: data[table], error: null }).then(res, rej),
    };
    return q;
  };
  return { supabase: { from: chain, rpc: () => Promise.resolve({ error: null }) } };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/hooks/useActiveAccount", () => ({ useActiveAccount: () => ({ accountId: "user-1", role: "owner", permissions: [] }) }));
vi.mock("@/lib/account-switcher", () => ({ hasPermission: () => true }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import ControlSafetyRules from "@/pages/ControlSafetyRules";

const renderPage = () => render(<MemoryRouter><ControlSafetyRules /></MemoryRouter>);

describe("safety rule form (Outer Control options)", () => {
  beforeEach(() => { inserted.length = 0; });

  it("offers 'remove the matched text' and an API key scope", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Applies to")).toBeTruthy());
    expect(screen.getByText(/Remove the matched text/)).toBeTruthy();
    expect(screen.getByText("API key: Zendesk bot")).toBeTruthy();
  });

  it("saves a remove-text rule scoped to one API key: block severity + redact, key id set, agent id null", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Applies to")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/What it catches/), { target: { value: "Project codename" } });
    fireEvent.change(screen.getByPlaceholderText(/Pattern/), { target: { value: "project\\s+falcon" } });
    fireEvent.change(screen.getByLabelText("What a match does"), { target: { value: "redact" } });
    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "key:key-1" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    await waitFor(() => expect(inserted.length).toBe(1));
    expect(inserted[0]).toMatchObject({ severity: "block", redact: true, api_key_id: "key-1", agent_id: null, category: "custom", name: "Project codename" });
  });

  it("a plain approval rule never sets redact, and agent scope never sets a key id", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Applies to")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/What it catches/), { target: { value: "Competitors" } });
    fireEvent.change(screen.getByPlaceholderText(/Pattern/), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "agent:agent-1" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    await waitFor(() => expect(inserted.length).toBe(1));
    expect(inserted[0]).toMatchObject({ severity: "require_approval", redact: false, agent_id: "agent-1", api_key_id: null });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));
vi.mock("@/hooks/useActiveAccount", () => ({ useActiveAccount: () => ({ accountId: "acct" }) }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const rows = () => (state.tables[table] ?? []) as Record<string, unknown>[];
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let single = false;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; };
    q.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; };
    q.in = (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; };
    for (const m of ["order", "limit", "neq"]) q[m] = () => q;
    q.maybeSingle = () => { single = true; return q; };
    q.then = (res: (v: unknown) => unknown) => {
      const out = rows().filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: single ? out[0] ?? null : out, error: null }).then(res);
    };
    return q;
  };
  return { supabase: { from, auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } }, SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1", SUPABASE_ANON: "anon" };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Projects from "@/pages/Projects";
import ProjectView from "@/pages/ProjectView";
import ImportProjectDialog from "@/components/projects/ImportProjectDialog";
import ProjectPicker from "@/components/control/ProjectPicker";
import { projectStatus, projectType, sourceBadge, type ImportedProject } from "@/lib/projects";
import { toast } from "sonner";

const base: ImportedProject = {
  id: "p1", user_id: "acct", name: "Brand guide", source_mode: "linked", source_kind: "notion", source_ref: "0123456789abcdef0123456789abcdef", source_label: "Notion",
  content_type: "markdown", files: [], content_sha256: "a".repeat(64), last_check: { at: "2026-10-24T10:00:00Z", rules: 7, matches: [] },
  write_back: false, write_back_enabled_at: null, last_synced_at: new Date(Date.now() - 2 * 60_000).toISOString(), sync_error: null,
  created_at: "2026-10-23T10:00:00Z", updated_at: "2026-10-24T10:00:00Z", archived_at: null, content: "## Voice\n\nShort sentences.",
};
const snapshot: ImportedProject = { ...base, id: "p2", name: "Launch notes", source_mode: "snapshot", source_kind: "paste", source_ref: null, source_label: "Pasted text", content_type: "html", content: "<script>alert(1)</script><p>Hello</p>", updated_at: "2026-10-22T10:00:00Z", last_synced_at: null };
const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
const at = (path: string, el: JSX.Element, extra: JSX.Element[] = []) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/projects" element={el} />
      <Route path="/projects/:id" element={el} />
      <Route path="/dashboard" element={<div>dashboard page</div>} />
      <Route path="/control-system/outer" element={<div>outer page</div>} />
      <Route path="/generated/:kind/:id" element={<div>generated page</div>} />
      {extra}
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  state.tables = {};
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
});

describe("source, status and type: one place decides what every view says", () => {
  it("snapshot, linked and generated", () => {
    const now = Date.parse("2026-10-24T10:05:00Z");
    expect(sourceBadge(snapshot, now)).toMatchObject({ label: "Snapshot", tone: "snapshot", detail: "One-time copy · imported 23 Oct. Changes to the original are not reflected." });
    expect(sourceBadge({ ...base, last_synced_at: "2026-10-24T10:03:00Z" }, now)).toMatchObject({ label: "Linked · Notion", detail: "Linked to the original · last synced 2 min ago" });
    expect(sourceBadge(null)).toMatchObject({ label: "Generated", tone: "generated" });
    expect(projectStatus(base)).toEqual({ label: "Under NazAI control", tone: "ok" });
    expect(projectStatus({ ...base, write_back: true }).label).toBe("Under NazAI control · write-back on");
    expect(projectStatus({ ...base, sync_error: "Notion refused" })).toEqual({ label: "Sync failed: Notion refused", tone: "warn" });
    expect(projectType({ key: "", id: "", name: "", origin: "imported", kind: "imported", updated_at: "", href: "", imported: snapshot })).toBe("Imported · HTML");
    expect(projectType({ key: "", id: "", name: "", origin: "generated", kind: "agent", updated_at: "", href: "" })).toBe("Generated · Agent");
  });
});

describe("Projects list", () => {
  it("lists imported and generated projects with name, source, status and type; a row opens the project", async () => {
    state.tables = { imported_projects: [base, snapshot], agents: [{ id: "a1", user_id: "acct", name: "Support agent", created_at: "2026-10-20T00:00:00Z" }], websites: [] };
    at("/projects", <Projects />);
    await waitFor(() => expect(screen.getAllByTestId("project-row").length).toBe(3));
    const rows = screen.getAllByTestId("project-row");
    expect(rows.map((r) => r.querySelector('[data-testid="project-name"]')!.textContent)).toEqual(["Brand guide", "Launch notes", "Support agent"]);
    expect(rows[0].textContent).toMatch(/Linked · Notion[\s\S]*Under NazAI control[\s\S]*Imported · Markdown/);
    expect(rows[1].textContent).toMatch(/Snapshot[\s\S]*Under NazAI control[\s\S]*Imported · HTML/);
    expect(rows[2].textContent).toMatch(/Generated[\s\S]*Generated · Agent/);
    fireEvent.click(screen.getByRole("tab", { name: "generated" }));
    expect(screen.getAllByTestId("project-row").map((r) => r.getAttribute("data-kind"))).toEqual(["agent"]);
    fireEvent.click(screen.getAllByTestId("project-row")[0]);
    expect(screen.getByText("generated page")).toBeTruthy();
  });

  it("with no project there is no Projects page: it goes back to the dashboard", async () => {
    state.tables = { imported_projects: [], agents: [], websites: [] };
    at("/projects", <Projects />);
    await waitFor(() => expect(screen.getByText("dashboard page")).toBeTruthy());
    expect(screen.queryByText(/No projects/)).toBeNull();
  });
});

describe("Project view", () => {
  it("shows identity with source and control always visible, the content as text (never run), the check, and the actions", async () => {
    state.tables = { imported_projects: [base, snapshot], project_rules: [], outer_control_workflows: [], agents: [], websites: [] };
    at("/projects/p2", <ProjectView />);
    await screen.findByTestId("project-identity");
    expect(screen.getByTestId("project-title").textContent).toBe("Launch notes");
    expect(screen.getByTestId("project-identity").textContent).toMatch(/Snapshot[\s\S]*One-time copy[\s\S]*Under NazAI control/);
    expect(screen.getByTestId("project-text").textContent).toBe("<script>alert(1)</script><p>Hello</p>");
    expect(document.querySelector('[data-testid="project-text"] script')).toBeNull();
    expect(screen.getByTestId("project-check").textContent).toMatch(/Checked against 7 rules: no matches\./);
    expect(screen.getByTestId("project-no-write-back").textContent).toMatch(/never writes to the original/);
    expect(screen.queryByTestId("project-refresh")).toBeNull();
    fireEvent.click(screen.getByTestId("project-start-task"));
    expect(screen.getByText("outer page")).toBeTruthy();
  });

  it("a rule for this project is added through the projects function and listed", async () => {
    state.tables = { imported_projects: [base], project_rules: [], outer_control_workflows: [], agents: [], websites: [] };
    at("/projects/p1", <ProjectView />);
    await screen.findByTestId("project-control");
    fireEvent.change(screen.getByLabelText("Rule name"), { target: { value: "Hide the codename" } });
    fireEvent.change(screen.getByLabelText("Words to catch"), { target: { value: "Falcon" } });
    fireEvent.click(screen.getByTestId("project-add-rule"));
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "add_rule", project_id: "p1", name: "Hide the codename", words: "Falcon", rule_action: "remove" }));
  });

  it("write-back for a linked project: off by default; turning it on needs the name typed; then a write asks for an approval", async () => {
    state.tables = { imported_projects: [base], project_rules: [], outer_control_workflows: [], agents: [], websites: [] };
    at("/projects/p1", <ProjectView />);
    await screen.findByTestId("project-write-back");
    expect(screen.getByTestId("project-refresh")).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Allow NazAI to edit the original" }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    const enable = (await screen.findByTestId("write-back-enable")) as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type the project name"), { target: { value: "Brand guide" } });
    state.tables.imported_projects = [{ ...base, write_back: true }]; // what the server stores when it accepts the change
    fireEvent.click(enable);
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "set_write_back", project_id: "p1", enabled: true, confirm_name: "Brand guide" }));
    await waitFor(() => expect(screen.getByTestId("project-write")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Text to add to the original"), { target: { value: "New section" } });
    fireEvent.click(screen.getByTestId("project-write"));
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "write_back", project_id: "p1", text: "New section" }));
    await waitFor(() => expect((toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toMatch(/Waiting for your approval/));
  });
});

describe("Import dialog", () => {
  it("paste: imports, then says it is under NazAI control, what the check found, and offers the next steps", async () => {
    state.tables = { agent_integrations: [], external_tools: [{ id: "t1", user_id: "acct", enabled: true, removed_at: null, endpoint_url: "https://api.example.com" }] };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true, project: snapshot, check: { at: "x", rules: 7, matches: [{ name: "API key or secret in payload", action: "remove_text" }] } }) }));
    at("/projects", <ImportProjectDialog open onOpenChange={() => {}} />);
    expect(screen.queryByTestId("import-tab-notion")).toBeNull();
    expect(screen.getByTestId("import-notion-off").textContent).toMatch(/Connect Notion/);
    fireEvent.click(screen.getByTestId("import-tab-paste"));
    fireEvent.change(screen.getByLabelText("Text to import"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByTestId("import-submit"));
    await screen.findByTestId("import-done");
    expect(calls()[0]).toEqual({ action: "import_paste", text: "Hello" });
    expect(screen.getByTestId("import-done").textContent).toMatch(/Under NazAI control[\s\S]*Launch notes[\s\S]*Snapshot/);
    expect(screen.getByTestId("import-check").textContent).toMatch(/Checked against 7 rules: 1 match \(API key or secret in payload\)\. That text is removed before any tool receives the project\./);
    await waitFor(() => expect(screen.getByTestId("import-ready").textContent).toMatch(/Ready for Outer Control/));
    fireEvent.click(screen.getByTestId("import-start-task"));
    expect(screen.getByText("outer page")).toBeTruthy();
  });

  it("a refused link says why and stores nothing; with Notion connected its tab appears", async () => {
    state.tables = { agent_integrations: [{ id: "n1", user_id: "acct", provider: "Notion", status: "connected" }], external_tools: [] };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: false, json: async () => ({ ok: false, error: "address_not_allowed", message: "That link can't be imported: blocked address." }) }));
    at("/projects", <ImportProjectDialog open onOpenChange={() => {}} />);
    await screen.findByTestId("import-tab-notion");
    fireEvent.change(screen.getByLabelText("Link to import"), { target: { value: "https://10.0.0.1" } });
    fireEvent.click(screen.getByTestId("import-submit"));
    expect((await screen.findByTestId("import-problem")).textContent).toBe("That link can't be imported: blocked address.");
    expect(screen.queryByTestId("import-done")).toBeNull();
  });
});

describe("Inner Control picker", () => {
  it("lists imported projects under Imported; choosing one opens its own view", () => {
    const onOpen = vi.fn();
    const agents = [{ key: "agent:a1", id: "a1", kind: "agent", name: "Support agent", created_at: "" }, { key: "website:w1", id: "w1", kind: "website", name: "Shop", created_at: "" }] as never[];
    render(<ProjectPicker projects={agents} selected={agents[0]} loading={false} onSelect={() => {}} onCreate={() => {}} imported={[{ id: "p1", name: "Brand guide", mode: "linked" }]} onOpenImported={onOpen} />);
    fireEvent.click(screen.getByTestId("project-picker"));
    expect(screen.getByTestId("picker-imported").textContent).toMatch(/Imported\s*1\s*Brand guide\s*Linked/);
    fireEvent.click(screen.getByTestId("imported-option-p1"));
    expect(onOpen).toHaveBeenCalledWith("p1");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, role: "self" as string }));
vi.mock("@/hooks/useActiveAccount", () => ({ useActiveAccount: () => ({ accountId: "acct", role: state.role, permissions: null }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "acct" } }) }));
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
import { liveCheckLine, liveCheckSteps, projectStatus, projectType, sourceBadge, type ImportedProject, type LiveApproval } from "@/lib/projects";
import { toast } from "sonner";

const base: ImportedProject = {
  id: "p1", user_id: "acct", name: "Brand guide", source_mode: "linked", source_kind: "notion", source_ref: "0123456789abcdef0123456789abcdef", source_label: "Notion",
  content_type: "markdown", files: [], content_sha256: "a".repeat(64), last_check: { at: "2026-10-24T10:00:00Z", rules: 7, matches: [] },
  write_back: false, write_back_enabled_at: null, last_synced_at: new Date(Date.now() - 2 * 60_000).toISOString(), sync_error: null,
  created_at: "2026-10-23T10:00:00Z", updated_at: "2026-10-24T10:00:00Z", archived_at: null, content: "## Voice\n\nShort sentences.",
};
const snapshot: ImportedProject = { ...base, id: "p2", name: "Launch notes", source_mode: "snapshot", source_kind: "paste", source_ref: null, source_label: "Pasted text", content_type: "html", content: "<script>alert(1)</script><p>Hello</p>", updated_at: "2026-10-22T10:00:00Z", last_synced_at: null };
const allCalls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
// Every project view reads its (encrypted) text through the server first; the other calls are what a test checks.
const calls = () => allCalls().filter((c) => c.action !== "read");
/** The projects function: "read" answers with the stored row's text, everything else with ok. */
const server = (other: (body: Record<string, unknown>) => Record<string, unknown> = () => ({ ok: true })) => vi.fn(async (_u: string, init: RequestInit) => {
  const body = JSON.parse(init.body as string);
  if (body.action === "read") {
    const row = (state.tables.imported_projects ?? []).find((r) => (r as { id: string }).id === body.project_id) as { content?: string } | undefined;
    return { ok: !!row, json: async () => (row ? { ok: true, content: row.content ?? "", files: [] } : { ok: false, message: "That project was not found." }) };
  }
  const out = other(body);
  return { ok: out.ok !== false, json: async () => out };
});
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
  state.role = "self";
  vi.stubGlobal("fetch", server());
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

  it("with no project the page still opens and offers the import (and the Generator)", async () => {
    state.tables = { imported_projects: [], agents: [], websites: [] };
    at("/projects", <Projects />, [<Route key="g" path="/generator-home" element={<div>generator page</div>} />]);
    const empty = await screen.findByTestId("projects-empty");
    expect(empty.textContent).toMatch(/No projects yet[\s\S]*link, files, pasted text or a Notion page/);
    expect(screen.queryByText("dashboard page")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByTestId("projects-empty-import"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("with no project, the Generator is one press away too", async () => {
    state.tables = { imported_projects: [], agents: [], websites: [] };
    at("/projects", <Projects />, [<Route key="g" path="/generator-home" element={<div>generator page</div>} />]);
    fireEvent.click(await screen.findByTestId("projects-empty-generate"));
    expect(screen.getByText("generator page")).toBeTruthy();
  });
});

describe("Project view", () => {
  it("shows identity with source and control always visible, the content as text (never run), the check, and the actions", async () => {
    state.tables = { imported_projects: [base, snapshot], project_rules: [], outer_control_workflows: [], agents: [], websites: [] };
    at("/projects/p2", <ProjectView />);
    await screen.findByTestId("project-identity");
    expect(screen.getByTestId("project-title").textContent).toBe("Launch notes");
    expect(allCalls()[0]).toEqual({ action: "read", project_id: "p2", account_id: "acct" });
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
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "add_rule", project_id: "p1", account_id: "acct", name: "Hide the codename", words: "Falcon", rule_action: "remove" }));
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
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "set_write_back", project_id: "p1", account_id: "acct", enabled: true, confirm_name: "Brand guide" }));
    await waitFor(() => expect(screen.getByTestId("project-write")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Text to add to the original"), { target: { value: "New section" } });
    fireEvent.click(screen.getByTestId("project-write"));
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "write_back", project_id: "p1", account_id: "acct", text: "New section" }));
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
    expect(calls()[0]).toEqual({ action: "import_paste", text: "Hello", account_id: "acct" });
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

  it("the Notion tab lists the shared pages at once and explains how to share more", async () => {
    state.tables = { agent_integrations: [{ id: "n1", user_id: "acct", provider: "Notion", status: "connected" }], external_tools: [] };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true, pages: [{ id: "0123456789abcdef0123456789abcdef", title: "Brand guide", last_edited: "2026-10-20T00:00:00Z", icon: null }] }) }));
    at("/projects", <ImportProjectDialog open onOpenChange={() => {}} />);
    fireEvent.click(await screen.findByTestId("import-tab-notion"));
    expect((await screen.findByTestId("notion-pages")).textContent).toMatch(/Brand guide/);
    expect(calls()[0]).toEqual({ action: "notion_search", query: "", account_id: "acct" });
    expect(screen.getByTestId("notion-help").textContent).toMatch(/only the pages you shared[\s\S]*Connections[\s\S]*add NazAI/);
  });
});

describe("Protection", () => {
  const protectedRow: ImportedProject = {
    ...base, last_check: { at: "x", rules: 7, matches: [], protected: true, hidden: [{ name: "API key", count: 1 }],
      injection: { severity: "strong", signals: [{ label: "Tries to override earlier instructions", sample: "Ignore all previous instructions" }] } },
  };
  const events = [
    { id: "e2", project_id: "p1", project_name: "Brand guide", actor_id: "teammate", action: "rule_added", detail: { name: "Hide codename" }, created_at: "2026-10-24T11:00:00Z" },
    { id: "e1", project_id: "p1", project_name: "Brand guide", actor_id: "acct", action: "imported", detail: { hidden: 1, flagged: true }, created_at: "2026-10-24T10:00:00Z" },
  ];

  it("a protected project: the shield chip, what was hidden, the AI-instruction warning and its history", async () => {
    state.tables = { imported_projects: [protectedRow], project_rules: [], outer_control_workflows: [], project_events: events, agents: [], websites: [] };
    at("/projects/p1", <ProjectView />);
    await screen.findByTestId("project-identity");
    expect(screen.getByTestId("protected-badge").textContent).toMatch(/Protected/);
    expect(screen.getByTestId("project-hidden").textContent).toBe(" 1 secret hidden before saving");
    expect(screen.getByTestId("project-injection").textContent).toMatch(/tries to instruct an AI[\s\S]*reference material only[\s\S]*Tries to override earlier instructions — “Ignore all previous instructions”/);
    expect(screen.getAllByTestId("project-event").map((e) => e.textContent)).toEqual([
      expect.stringMatching(/^Rule added: "Hide codename" · A team member · 24 Oct/),
      expect.stringMatching(/^Imported · 1 secret hidden · AI instructions flagged · You · 24 Oct/),
    ]);
    expect(screen.getByTestId("project-content").textContent).toMatch(/stored encrypted/);
  });

  it("a team member who is not an owner sees everything but can change nothing: View only", async () => {
    state.role = "viewer";
    state.tables = { imported_projects: [protectedRow], project_rules: [{ id: "r1", project_id: "p1", name: "Hide codename", pattern: "x", severity: "block", redact: true, enabled: true, created_at: "x" }], outer_control_workflows: [], project_events: [], agents: [], websites: [] };
    at("/projects/p1", <ProjectView />);
    await screen.findByTestId("project-identity");
    expect(screen.getByTestId("view-only-badge")).toBeTruthy();
    expect(screen.getByTestId("project-text").textContent).toBe("## Voice\n\nShort sentences.");
    expect(screen.getByTestId("project-rules").textContent).toMatch(/Hide codename/);
    for (const id of ["project-refresh", "project-archive", "project-delete", "project-add-rule"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.queryByLabelText("Rename")).toBeNull();
    expect(screen.queryByLabelText("Remove rule Hide codename")).toBeNull();
    expect((screen.getByRole("switch", { name: "Allow NazAI to edit the original" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("delete: permanent, next to Archive, only after the name is typed", async () => {
    state.tables = { imported_projects: [base], project_rules: [], outer_control_workflows: [], project_events: [], agents: [], websites: [] };
    vi.stubGlobal("fetch", server((b) => (b.action === "delete" ? { ok: true, deleted: true } : { ok: true })));
    render(
      <MemoryRouter initialEntries={["/projects/p1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectView />} />
          <Route path="/projects" element={<div>projects list</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId("project-delete"));
    const go = (await screen.findByTestId("delete-confirm-button")) as HTMLButtonElement;
    expect(screen.getByTestId("delete-confirm").textContent).toMatch(/can not be brought back[\s\S]*original[\s\S]*is not touched[\s\S]*Archive instead/);
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type the project name to delete it"), { target: { value: "Brand guide" } });
    fireEvent.click(go);
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "delete", project_id: "p1", account_id: "acct", confirm_name: "Brand guide" }));
    await waitFor(() => expect(screen.getByText("projects list")).toBeTruthy());
  });

  it("when the text can not be read, the page says so instead of showing nothing", async () => {
    state.tables = { imported_projects: [base], project_rules: [], outer_control_workflows: [], project_events: [], agents: [], websites: [] };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ ok: false, message: "This project's text could not be read: it does not match the storage key. Nothing was changed." }) })));
    at("/projects/p1", <ProjectView />);
    expect((await screen.findByTestId("project-text-problem")).textContent).toMatch(/does not match the storage key/);
  });

  it("the import confirmation says it is stored encrypted, what was hidden, and flags AI instructions", async () => {
    state.tables = { agent_integrations: [], external_tools: [] };
    vi.stubGlobal("fetch", server(() => ({ ok: true, project: protectedRow, check: protectedRow.last_check })));
    at("/projects", <ImportProjectDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId("import-tab-paste"));
    fireEvent.change(screen.getByLabelText("Text to import"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByTestId("import-submit"));
    await screen.findByTestId("import-done");
    expect(screen.getByTestId("import-done").querySelector('[data-testid="protected-badge"]')).toBeTruthy();
    expect(screen.getByTestId("import-protected").textContent).toBe("Stored encrypted. 1 secret hidden before saving.");
    expect(screen.getByTestId("import-injection").textContent).toMatch(/tries to instruct an AI \(tries to override earlier instructions\)/);
  });
});

describe("Live check (Notion import and write-back, for real)", () => {
  const line = liveCheckLine(new Date("2026-10-25T10:22:00Z"));
  const approval = (extra: Partial<LiveApproval> = {}): LiveApproval => ({ id: "ap1", status: "pending", executed_at: null, execution_error: null, params: { project_id: "p1", append_markdown: line }, created_at: "2026-10-25T10:22:00Z", ...extra });
  const states = (r: ReturnType<typeof liveCheckSteps>) => r.steps.map((x) => `${x.key}:${x.state}`).join(" ");

  it("each step is read from what happened, up to the line found in the page read back", () => {
    expect(line).toBe("NazAI live check · 2026-10-25 10:22 UTC");
    let r = liveCheckSteps(base, [], base.content!);
    expect(states(r)).toBe("connected:done read:done write_back:todo sent:todo run:todo landed:todo");
    expect(r.next!.key).toBe("write_back");
    const on = { ...base, write_back: true };
    r = liveCheckSteps(on, [approval()], base.content!);
    expect(states(r)).toBe("connected:done read:done write_back:done sent:done run:waiting landed:todo");
    r = liveCheckSteps(on, [approval({ executed_at: "2026-10-25T10:25:00Z" })], base.content!);
    expect(r.next!.key).toBe("landed"); expect(r.next!.state).toBe("waiting");
    r = liveCheckSteps(on, [approval({ executed_at: "2026-10-25T10:25:00Z" })], `${base.content}\n\n${line}`);
    expect(r.next).toBeNull(); expect(r.done).toBe(6);
  });

  it("a failed run, a rejection or a sync error is a failed step with the reason; another project's approval does not count", () => {
    const on = { ...base, write_back: true };
    expect(liveCheckSteps(on, [approval({ execution_error: "Notion content append failed: Insufficient permissions" })], "").steps[4]).toMatchObject({ state: "failed", detail: "Notion content append failed: Insufficient permissions" });
    expect(liveCheckSteps(on, [approval({ status: "rejected" })], "").steps[4].state).toBe("failed");
    expect(liveCheckSteps({ ...on, sync_error: "Notion refused" }, [], "").steps[1]).toMatchObject({ state: "failed", detail: "Notion refused" });
    expect(liveCheckSteps(on, [approval({ params: { project_id: "other", append_markdown: line } })], "").steps[3].state).toBe("todo");
  });

  it("on the project page: the next step has its button; sending the test line asks for an approval", async () => {
    state.tables = { imported_projects: [{ ...base, write_back: true }], project_rules: [], outer_control_workflows: [], project_events: [], pending_approvals: [], agents: [], websites: [] };
    at("/projects/p1", <ProjectView />, [<Route key="a" path="/control-system/approvals" element={<div>approvals page</div>} />]);
    expect((await screen.findByTestId("live-check-summary")).textContent).toBe("3 of 6 steps · next: A test line waits for approval");
    state.tables.pending_approvals = [{ ...approval(), user_id: "acct", origin: "projects" }]; // what the server stores for the write
    fireEvent.click(screen.getByTestId("live-step-action"));
    await waitFor(() => expect(calls().at(-1)).toMatchObject({ action: "write_back", project_id: "p1", account_id: "acct", text: expect.stringMatching(/^NazAI live check · \d{4}-\d\d-\d\d \d\d:\d\d UTC$/) }));
    await waitFor(() => expect(screen.getByTestId("live-check-summary").textContent).toBe("4 of 6 steps · next: Approved and run"));
    fireEvent.click(screen.getByTestId("live-step-action"));
    expect(screen.getByText("approvals page")).toBeTruthy();
  });

  it("not shown for a snapshot or to someone who can only view", async () => {
    state.tables = { imported_projects: [snapshot], project_rules: [], outer_control_workflows: [], project_events: [], agents: [], websites: [] };
    at("/projects/p2", <ProjectView />);
    await screen.findByTestId("project-identity");
    expect(screen.queryByTestId("live-check")).toBeNull();
  });
});

describe("More import sources", () => {
  it("a GitHub repository link offers the private option; the token goes with this import only", async () => {
    state.tables = { agent_integrations: [], external_tools: [] };
    vi.stubGlobal("fetch", server(() => ({ ok: true, project: snapshot, check: { at: "x", rules: 7, matches: [] } })));
    at("/projects", <ImportProjectDialog open onOpenChange={() => {}} />);
    expect(screen.queryByTestId("github-private")).toBeNull();
    fireEvent.change(screen.getByLabelText("Link to import"), { target: { value: "https://github.com/acme/secret-app" } });
    fireEvent.click(screen.getByLabelText("This repository is private"));
    expect(screen.getByTestId("github-private").textContent).toMatch(/Used once for this import and never stored/);
    fireEvent.change(screen.getByLabelText("GitHub token"), { target: { value: "github_pat_abc123abc123abc123abc123" } });
    fireEvent.click(screen.getByTestId("import-submit"));
    await screen.findByTestId("import-done");
    expect(calls()[0]).toEqual({ action: "import_link", url: "https://github.com/acme/secret-app", github_token: "github_pat_abc123abc123abc123abc123", account_id: "acct" });
  });
});

describe("Try a rule before turning it on", () => {
  it("shows what the rule would have done to recent replies, with the words around each match; changing the rule clears it", async () => {
    state.tables = { imported_projects: [base], project_rules: [], meaning_rules: [], outer_control_workflows: [], project_events: [], agents: [], websites: [] };
    vi.stubGlobal("fetch", server((b) => (b.action === "test_rule"
      ? { ok: true, kind: "words", rule_action: "block", checked: 40, matched: 3, hits: [{ tool: "ChatGPT", at: "2026-10-24T09:00:00Z", before: "It arrives by ", match: "Friday", after: " at noon." }] }
      : { ok: true })));
    at("/projects/p1", <ProjectView />);
    await screen.findByTestId("project-control");
    fireEvent.change(screen.getByLabelText("Rule name"), { target: { value: "No days" } });
    fireEvent.change(screen.getByLabelText("Words to catch"), { target: { value: "Friday" } });
    fireEvent.change(screen.getByLabelText("What the rule does"), { target: { value: "block" } });
    fireEvent.click(screen.getByTestId("project-try-rule"));
    expect((await screen.findByTestId("rule-trial-summary")).textContent).toBe("It would have blocked 3 of your last 40 replies (8%).");
    expect(screen.getByTestId("rule-trial-hit").textContent).toBe("ChatGPT · 24 Oct: …It arrives by Friday at noon.…");
    expect(calls().at(-1)).toEqual({ action: "test_rule", project_id: "p1", account_id: "acct", words: "Friday", rule_action: "block" });
    expect(screen.getByTestId("project-add-rule").textContent).toMatch(/Turn it on/);
    fireEvent.change(screen.getByLabelText("Words to catch"), { target: { value: "Friday, Monday" } });
    await waitFor(() => expect(screen.queryByTestId("rule-trial")).toBeNull());
  });
});

describe("Meaning rules on a project", () => {
  it("a rule in plain words is added through the projects function, listed with its Meaning badge, and removed by kind", async () => {
    state.tables = { imported_projects: [base], project_rules: [], meaning_rules: [{ id: "m1", project_id: "p1", name: "No delivery promises", description: "Promising a delivery date", action: "approval", enabled: true, created_at: "x" }], outer_control_workflows: [], project_events: [], agents: [], websites: [] };
    at("/projects/p1", <ProjectView />);
    expect((await screen.findByTestId("meaning-rule")).textContent).toMatch(/Meaning\s*No delivery promises · needs approval\s*Promising a delivery date/);
    fireEvent.click(screen.getByRole("tab", { name: "Meaning · AI judge" }));
    expect(screen.getByTestId("meaning-help").textContent).toMatch(/must quote the words[\s\S]*a person decides/);
    fireEvent.change(screen.getByLabelText("Rule name"), { target: { value: "No medical advice" } });
    fireEvent.change(screen.getByLabelText("What it should catch"), { target: { value: "Telling someone which medicine to take" } });
    fireEvent.click(screen.getByTestId("project-add-rule"));
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "add_rule", project_id: "p1", account_id: "acct", kind: "meaning", name: "No medical advice", description: "Telling someone which medicine to take", rule_action: "block" }));
    fireEvent.click(screen.getByLabelText("Remove rule No delivery promises"));
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "remove_rule", project_id: "p1", account_id: "acct", rule_id: "m1", kind: "meaning" }));
  });
});

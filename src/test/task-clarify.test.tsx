import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ tools: [] as unknown[], sessions: [] as unknown[], workflows: [] as unknown[], imported: [] as unknown[], records: [] as unknown[], route: null as Record<string, unknown> | null, routeFails: false }));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const data = table === "external_tools" ? state.tools : table === "outer_control_sessions" ? state.sessions : table === "outer_control_workflows" ? state.workflows : table === "imported_projects" ? state.imported : table === "outer_control_tool_record" ? state.records : [];
    const q: Record<string, unknown> = {};
    let single = false;
    for (const m of ["select", "eq", "neq", "not", "is", "in", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = () => { single = true; return q; };
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: single ? (data as unknown[])[0] ?? null : data, error: null }).then(res);
    return q;
  };
  return { supabase: { from: result, auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } }, SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1", SUPABASE_ANON: "anon" };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const saved = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fail: false }));
vi.mock("@/lib/encrypted-write", () => ({ ocWrite: (table: string) => ({ insert: async (row: Record<string, unknown>) => { saved.rows.push({ table, ...row }); return { error: saved.fail ? { message: "denied" } : null }; } }) }));

import ActiveSessionsCard from "@/components/control/outer/ActiveSessionsCard";
import { forgetReadings, SECOND_OFFER } from "@/components/control/outer/TaskPanel";
import { toast } from "sonner";

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const good = (id: string, name: string) => ({ id, name, endpoint_url: `https://${id}.example.com/chat`, request_format: "generic_json", approved_at: ago(500), last_ok_at: ago(3), last_checked_at: ago(3), last_error: null });
const writer = { id: "rw", name: "NazAI report writer", endpoint_url: "nazai-internal://report", request_format: "generic_json", approved_at: ago(500), last_ok_at: ago(3), last_checked_at: ago(3), last_error: null };
const render_ = () => render(<MemoryRouter><ActiveSessionsCard accountId="u1" /></MemoryRouter>);
const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));


const QUESTIONS = [
  { id: "stage", label: "Stage of the business", question: "What stage is the business at?", why: "Advice differs.", placeholder: "e.g. idea only" },
  { id: "audience", label: "Who it is for", question: "Who is it for?", why: "So it speaks to your buyers.", placeholder: "e.g. gift buyers" },
  { id: "constraint", label: "Main limit", question: "What is the main limit: money, time or people?", why: "So it fits.", placeholder: "e.g. 300 EUR a month" },
];

describe("the clarifying step before a Task runs", () => {
  beforeEach(() => {
    // Two connected tools: with only one, Start a task offers NazAI's second perspective instead (tested below).
    state.tools = [good("a", "ChatGPT"), good("z", "Perplexity"), writer]; state.sessions = []; state.workflows = []; state.imported = []; state.records = []; state.routeFails = false;
    state.route = { kind: "research", questions: QUESTIONS }; saved.rows = []; saved.fail = false; forgetReadings();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.action === "route_task") return { ok: true, json: async () => ({ ok: true, text: body.request, background: "", labels: [], count: 0, question: "", source: "ai", ...state.route }) };
      return { ok: true, json: async () => ({ ok: true, task_id: "w1" }) };
    }));
  });
  const open = async (request = "How do I find more customers?") => {
    render(<MemoryRouter><ActiveSessionsCard accountId="u1" /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.change(screen.getByLabelText("Describe the task"), { target: { value: request } });
    await screen.findByTestId("task-plan-line", {}, { timeout: 3000 });
    fireEvent.click(screen.getByLabelText("Ask ChatGPT"));
  };
  const lastStart = () => calls().filter((c) => c.action === "start_report").at(-1);

  it("asks the questions NazAI returned, all optional: starting without answers works and saves nothing", async () => {
    await open();
    expect(screen.getByTestId("task-clarify").textContent).toMatch(/A few details make the answer fit you\s*\(optional\)/);
    for (const q of QUESTIONS) expect(screen.getByLabelText(q.question)).toBeTruthy();
    expect(screen.queryByTestId("task-clarify-remember")).toBeNull();
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "research", topic: "How do I find more customers?", tool_ids: ["a"] }));
    expect(saved.rows).toEqual([]);
  });

  it("answers reach every tool in the background, and are kept as knowledge entries for later Tasks", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Who is it for?"), { target: { value: "  gift buyers   in Germany " } });
    fireEvent.change(screen.getByLabelText("What is the main limit: money, time or people?"), { target: { value: "300 EUR a month" } });
    const remember = screen.getByLabelText(/Remember these for my next Tasks/) as HTMLInputElement;
    expect(remember.checked).toBe(true);
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()?.background).toBe("Who it is for: gift buyers in Germany\nMain limit: 300 EUR a month"));
    await waitFor(() => expect(saved.rows.length).toBe(2));
    expect(saved.rows[0]).toEqual({ table: "knowledge_base_entries", user_id: "u1", entry_text: "Who it is for: gift buyers in Germany", action_type_pattern: "*", enabled: true, pending_review: false, auto_drafted: false });
    expect((toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe("Your answers are saved in your Knowledge base for your next Tasks.");
  });

  it("with 'remember' off the answers are used for this Task only and nothing is saved", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("What stage is the business at?"), { target: { value: "first 10 customers" } });
    fireEvent.click(screen.getByLabelText(/Remember these for my next Tasks/));
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()?.background).toBe("Stage of the business: first 10 customers"));
    expect(saved.rows).toEqual([]);
  });

  it("a save that is refused does not stop the Task and says why", async () => {
    saved.fail = true;
    await open();
    fireEvent.change(screen.getByLabelText("Who is it for?"), { target: { value: "yoga teachers" } });
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()?.background).toBe("Who it is for: yoga teachers"));
    await waitFor(() => expect((toast.info as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toMatch(/used for this Task, but they could not be saved/));
  });

  it("NazAI read another action, the person picks Research by hand: the questions still show; a rewrite still asks none", async () => {
    state.route = { kind: "opinions", questions: QUESTIONS, question_kinds: ["opinions", "research", "compare", "decision", "multistep", "delegate"] };
    await open();
    expect(screen.getByTestId("task-clarify")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Change the action"), { target: { value: "research" } });
    expect(screen.getByTestId("task-clarify")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Who is it for?"), { target: { value: "small business owners" } });
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()).toMatchObject({ task: "research", background: "Who it is for: small business owners" }));
    state.route = { kind: "explain", questions: QUESTIONS, question_kinds: ["opinions", "research"] }; forgetReadings();
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.change(screen.getByLabelText("Describe the task"), { target: { value: "Explain simply: what is churn?" } });
    await screen.findByTestId("task-plan-line", {}, { timeout: 3000 });
    expect(screen.queryByTestId("task-clarify")).toBeNull();
  });

  it("the goal question (asked when the request is vague) goes to the tools but is never kept for later Tasks", async () => {
    state.route = { kind: "opinions", questions: [{ id: "goal", label: "What I want from it", question: "What result do you want from this?", why: "So it aims at your result.", placeholder: "e.g. a plan" }, QUESTIONS[1]] };
    await open("Help me with marketing");
    fireEvent.change(screen.getByLabelText("What result do you want from this?"), { target: { value: "20 bookings a week" } });
    expect(screen.queryByTestId("task-clarify-remember")).toBeNull();
    fireEvent.change(screen.getByLabelText("Who is it for?"), { target: { value: "yoga students in Vienna" } });
    expect(screen.getByTestId("task-clarify-remember")).toBeTruthy();
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()?.background).toBe("What I want from it: 20 bookings a week\nWho it is for: yoga students in Vienna"));
    await waitFor(() => expect(saved.rows.length).toBe(1));
    expect(saved.rows[0].entry_text).toBe("Who it is for: yoga students in Vienna");
  });

  it("no questions when NazAI returned none, or when another action is chosen by hand", async () => {
    state.route = { kind: "research", questions: [] };
    await open();
    expect(screen.queryByTestId("task-clarify")).toBeNull();
    state.route = { kind: "research", questions: QUESTIONS }; forgetReadings();
    fireEvent.change(screen.getByLabelText("Describe the task"), { target: { value: "How do I find more buyers?" } });
    await waitFor(() => expect(screen.queryByTestId("task-clarify")).toBeTruthy(), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText("Change the action"), { target: { value: "rewrite" } });
    expect(screen.queryByTestId("task-clarify")).toBeNull();
  });
});

describe("the research challenger in the plan", () => {
  beforeEach(() => {
    state.tools = [good("a", "ChatGPT"), good("b", "Claude"), writer]; state.sessions = []; state.workflows = []; state.imported = []; state.records = []; state.routeFails = false;
    state.route = { kind: "research" }; forgetReadings(); vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.action === "route_task") return { ok: true, json: async () => ({ ok: true, text: body.request, background: "", labels: [], count: 0, question: "", source: "ai", ...state.route }) };
      return { ok: true, json: async () => ({ ok: true, task_id: "w1" }) };
    }));
  });

  it("says which tool challenges the answers: the second tool, or the only one; not for other actions", async () => {
    render(<MemoryRouter><ActiveSessionsCard accountId="u1" /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.change(screen.getByLabelText("Describe the task"), { target: { value: "Ways to evaluate AI safety" } });
    await screen.findByTestId("task-plan-line", {}, { timeout: 3000 });
    expect(screen.queryByTestId("task-challenger")).toBeNull();
    fireEvent.click(screen.getByLabelText("Ask ChatGPT"));
    expect(screen.getByTestId("task-challenger").textContent).toMatch(/^Then ChatGPT challenges the answers for your situation/);
    fireEvent.click(screen.getByLabelText("Ask Claude"));
    expect(screen.getByTestId("task-challenger").textContent).toMatch(/^Then Claude challenges the answers/);
    fireEvent.change(screen.getByLabelText("Change the action"), { target: { value: "opinions" } });
    expect(screen.queryByTestId("task-challenger")).toBeNull();
  });
});

// Day 3 (#157): a goal Task from Start a task. "Keep going until it is done" turns the Task into one that asks the tools in turn
// until the done criteria are met; everything else (questions, background, tools) is the same panel.
describe("Start a task: keep going until it is done", () => {
  beforeEach(() => {
    state.tools = [good("a", "ChatGPT"), good("b", "Claude"), good("c", "Gemini"), good("d", "Mistral"), writer]; state.sessions = []; state.workflows = []; state.imported = []; state.records = [];
    state.route = { kind: "opinions", questions: [QUESTIONS[2]], question_kinds: ["opinions"] }; saved.rows = []; saved.fail = false; forgetReadings(); vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.action === "route_task") return { ok: true, json: async () => ({ ok: true, text: body.request, background: "", labels: [], count: 0, question: "", source: "ai", ...state.route }) };
      return { ok: true, json: async () => ({ ok: true, task_id: "w1" }) };
    }));
  });
  const lastGoal = () => calls().filter((c) => c.action === "start_goal").at(-1);

  it("starts a goal Task with the request, the criteria, the most rounds, up to 3 tools and the answers as context", async () => {
    render(<MemoryRouter><ActiveSessionsCard accountId="u1" /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.change(screen.getByLabelText("Describe the task"), { target: { value: "Write a launch checklist for a small online shop" } });
    await screen.findByTestId("task-plan-line", {}, { timeout: 3000 });
    expect(screen.queryByLabelText("Done criteria")).toBeNull();
    fireEvent.click(screen.getByLabelText("Keep going until it is done"));
    fireEvent.change(screen.getByLabelText("Done criteria"), { target: { value: "Has exactly 5 numbered points\nMentions setting up payments\n\nMentions shipping costs" } });
    fireEvent.change(screen.getByLabelText("Most rounds"), { target: { value: "3" } });
    for (const n of ["ChatGPT", "Claude", "Gemini", "Mistral"]) fireEvent.click(screen.getByLabelText(`Ask ${n}`));
    fireEvent.change(screen.getByLabelText("What is the main limit: money, time or people?"), { target: { value: "launch in 2 weeks" } });
    expect(screen.getByTestId("task-start").textContent).toBe("Start · keep going until done");
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastGoal()).toEqual({
      action: "start_goal", goal: "Write a launch checklist for a small online shop",
      criteria: ["Has exactly 5 numbered points", "Mentions setting up payments", "Mentions shipping costs"],
      tool_ids: ["a", "b", "c"], max_rounds: 3, context: "Main limit: launch in 2 weeks",
    }));
    expect(calls().some((c) => c.action === "start_report")).toBe(false);
  });

  it("without criteria it still starts (the basic check); too many criteria are refused before anything starts", async () => {
    render(<MemoryRouter><ActiveSessionsCard accountId="u1" /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.change(screen.getByLabelText("Describe the task"), { target: { value: "Summarise our refund policy" } });
    await screen.findByTestId("task-plan-line", {}, { timeout: 3000 });
    fireEvent.click(screen.getByLabelText("Keep going until it is done"));
    fireEvent.click(screen.getByLabelText("Ask ChatGPT"));
    fireEvent.change(screen.getByLabelText("Done criteria"), { target: { value: "a\nb\nc\nd\ne\nf" } });
    expect((screen.getByTestId("task-start") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Done criteria"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastGoal()).toMatchObject({ goal: "Summarise our refund policy", tool_ids: ["a"], max_rounds: 4 }));
    expect(lastGoal().criteria).toBeUndefined();
  });
});

// Single-tool suggestion: exactly one connected tool, an action a second answer makes fuller. NazAI offers its own second
// controlled perspective for this Task; the person can decline it or connect another tool instead.
describe("Start a task with exactly one connected tool: NazAI offers a second perspective", () => {
  beforeEach(() => {
    state.tools = [good("a", "ChatGPT"), writer]; state.sessions = []; state.workflows = []; state.imported = []; state.records = [];
    state.route = { kind: "opinions", questions: [] }; saved.rows = []; forgetReadings(); vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.action === "route_task") return { ok: true, json: async () => ({ ok: true, text: body.request, background: "", labels: [], count: 0, question: "", source: "ai", ...state.route }) };
      return { ok: true, json: async () => ({ ok: true, task_id: "w1" }) };
    }));
  });
  const lastStart = () => calls().filter((c) => c.action === "start_report").at(-1);
  const openWith = async (request: string) => {
    render(<MemoryRouter><ActiveSessionsCard accountId="u1" /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.change(screen.getByLabelText("Describe the task"), { target: { value: request } });
    await screen.findByTestId("task-plan-line", {}, { timeout: 3000 });
    fireEvent.click(screen.getByLabelText("Ask ChatGPT"));
  };

  it("shows the offer word for word; 'Generate a NazAI tool for this task' runs the same Task with both", async () => {
    await openWith("Should a small bakery open on Sundays?");
    const offer = screen.getByTestId("task-second-offer");
    expect(offer.textContent).toContain(SECOND_OFFER);
    expect(screen.queryByTestId("task-start")).toBeNull();
    fireEvent.click(screen.getByTestId("task-second-generate"));
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "opinions", topic: "Should a small bakery open on Sundays?", tool_ids: ["a"], nazai_second: true }));
  });

  it("'Continue with one tool' runs it with the connected tool only; no NazAI tool is asked for", async () => {
    await openWith("Should a small bakery open on Sundays?");
    fireEvent.click(screen.getByTestId("task-second-one"));
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "opinions", topic: "Should a small bakery open on Sundays?", tool_ids: ["a"] }));
  });

  it("compare needs two answers: the NazAI perspective makes it possible; one tool alone can not start it", async () => {
    state.route = { kind: "compare", questions: [] };
    await openWith("Etsy or Shopify for hand-made candles?");
    expect((screen.getByTestId("task-second-one") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("task-second-generate"));
    await waitFor(() => expect(lastStart()).toMatchObject({ task: "compare", tool_ids: ["a"], nazai_second: true }));
  });

  it("not offered with two connected tools, for an action that adds nothing from a second answer, or when keeping going", async () => {
    state.route = { kind: "rewrite", questions: [], labels: ["Formal"] };
    await openWith("Rewrite: our shop opens at nine.");
    expect(screen.queryByTestId("task-second-offer")).toBeNull();
    fireEvent.change(screen.getByLabelText("Change the action"), { target: { value: "opinions" } });
    expect(screen.getByTestId("task-second-offer")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Keep going until it is done"));
    expect(screen.queryByTestId("task-second-offer")).toBeNull();
  });

  it("'Connect another tool instead' opens the connectors; after a connection the same Task continues with both tools", async () => {
    await openWith("Should a small bakery open on Sundays?");
    fireEvent.click(screen.getByTestId("task-second-connect"));
    await waitFor(() => expect(screen.queryByTestId("task-second-offer")).toBeNull());
    expect(document.body.textContent).toMatch(/Connect/);
  });
});

describe("a tool connected for the Task joins it", () => {
  it("is ticked next to the one already chosen, the offer gives way, and the panel says to continue with both", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return { ok: true, json: async () => ({ ok: true, text: body.request, background: "", labels: [], count: 0, question: "", source: "ai", kind: "opinions", questions: [] }) };
    }));
    forgetReadings();
    const TaskPanel = (await import("@/components/control/outer/TaskPanel")).default;
    const one = [good("a", "ChatGPT")];
    const onAdded = vi.fn();
    const props = { open: true, onOpenChange: () => {}, busy: false, onStart: async () => true, onConnectForTask: () => {}, onToolAdded: onAdded };
    const { rerender } = render(<MemoryRouter><TaskPanel {...props} tools={one} addTool={null} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Describe the task"), { target: { value: "Should a small bakery open on Sundays?" } });
    await screen.findByTestId("task-plan-line", {}, { timeout: 3000 });
    fireEvent.click(screen.getByLabelText("Ask ChatGPT"));
    expect(screen.getByTestId("task-second-offer")).toBeTruthy();
    rerender(<MemoryRouter><TaskPanel {...props} tools={[...one, good("n", "Claude")]} addTool="n" /></MemoryRouter>);
    await waitFor(() => expect((screen.getByLabelText("Ask Claude") as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText("Ask ChatGPT") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("task-joined").textContent).toMatch(/Claude is connected\. Continue the same task with both tools/);
    expect(screen.queryByTestId("task-second-offer")).toBeNull();
    expect(screen.getByTestId("task-start")).toBeTruthy();
    expect(onAdded).toHaveBeenCalled();
  });
});

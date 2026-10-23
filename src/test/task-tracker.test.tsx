import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const state = vi.hoisted(() => ({ workflows: [] as unknown[], legs: [] as unknown[], tools: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const data = table === "outer_control_workflows" ? state.workflows : table === "outer_control_sessions" ? state.legs : table === "external_tools" ? state.tools : [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "in", "order", "limit"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res);
    return q;
  };
  return { supabase: { from: result, auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } }, SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1", SUPABASE_ANON: "anon" };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import TaskTracker from "@/components/control/outer/TaskTracker";
import { toast } from "sonner";
import { buildSessionArtifact, buildTaskArtifact } from "@/lib/outer-control-artifact";
import { composeReportText, type ReportDoc } from "@/lib/outer-control-report-doc";
import { proofTiles, taskProgress } from "@/lib/outer-control-task-progress";

const tools = [
  { id: "a", name: "ChatGPT", endpoint_url: "https://a.example.com" },
  { id: "b", name: "Claude", endpoint_url: "https://b.example.com" },
  { id: "w", name: "NazAI report writer", endpoint_url: "nazai-internal://report" },
];
const leg = (n: number, tool: string, status: string, deps: number[] = [], extra: Record<string, unknown> = {}) => ({ id: `l${n}`, workflow_id: "t1", leg_no: n, tool_id: tool, status, depends_on: deps, stop_reason: null, pending_kind: null, ...extra });

const sha = "c".repeat(64);
const doc: ReportDoc = {
  version: 1, kind: "research", parallel: true, topic: "AI safety evaluation", compiled_at: "2026-10-23T09:00:00Z", summary: "One source [1].",
  opinions: [{ n: 1, tool: "Claude", text: "Red-teaming finds failures.", shortened: false, sha256: "a".repeat(64), at: "2026-10-23T08:59:00Z" }],
  agreements: [], differences: [], conclusion: "Use red-teaming [1].", points: ["Red-teaming finds failures [1]."], open_questions: [],
  missing: [{ tool: "ChatGPT", reason: "The tool answered HTTP 503" }],
};
const sessionArt = (text: string, tool: string, report?: ReportDoc) => {
  const r = buildSessionArtifact({
    id: `s-${tool}`, taskId: "t1", objective: "o", tool, completedAt: "2026-10-23T09:00:00Z", finalText: text, sha256: sha,
    checklist: { passed: true, outcome: "completed", summary: "ok", criteria: [{ id: "a", label: "a", ok: true, detail: "d" }], output_sha256: sha },
    steps: [], rulesInForce: [{ name: "No secrets", action: "outer_control_text_review" }], decidedBy: "tool", report: report ?? null,
  });
  if (r.ok !== true) throw new Error("fixture");
  return r.artifact;
};
const taskArt = () => {
  const text = composeReportText(doc);
  const r = buildTaskArtifact({
    id: "t1", request: "Research: AI safety evaluation", origin: null, completedAt: "2026-10-23T09:01:00Z", finalLeg: 3, handoffs: [],
    legs: [
      { leg_no: 1, tool: "ChatGPT", status: "failed", artifact: null },
      { leg_no: 2, tool: "Claude", status: "completed", artifact: sessionArt("Red-teaming finds failures.", "Claude") },
      { leg_no: 3, tool: "NazAI report writer", status: "completed", artifact: sessionArt(text, "NazAI report writer", doc) },
    ],
  });
  if (r.ok !== true) throw new Error(`task fixture: ${(r as { reason: string }).reason}`);
  return r.artifact;
};

describe("taskProgress: one line for what is happening now", () => {
  it("tools asked at the same time, then NazAI writing, then the result", () => {
    let p = taskProgress({ status: "running" }, [leg(1, "a", "running"), leg(2, "b", "running"), leg(3, "w", "queued", [1, 2])], tools);
    expect(p.headline).toBe("Asking ChatGPT and Claude at the same time…");
    expect(p.together).toBe(true);
    expect(p.nodes.map((n) => [n.label, n.state])).toEqual([["ChatGPT", "asking"], ["Claude", "asking"], ["NazAI", "waiting"]]);
    p = taskProgress({ status: "running" }, [leg(1, "a", "failed"), leg(2, "b", "completed"), leg(3, "w", "running", [1, 2])], tools);
    expect(p.headline).toBe("NazAI is writing the result from 1 checked answer…");
    p = taskProgress({ status: "completed" }, [leg(1, "a", "failed"), leg(2, "b", "completed"), leg(3, "w", "completed", [1, 2])], tools);
    expect(p.phase).toBe("ready");
    expect(p.headline).toBe("Result ready, written without ChatGPT (no answer).");
  });
  it("steps one after another say which step; a person needed says what for; a stop says why and that the credit goes back", () => {
    expect(taskProgress({ status: "running" }, [leg(1, "a", "completed"), leg(2, "b", "running", [1]), leg(3, "w", "queued", [2])], tools).headline).toBe("Asking Claude (step 2 of 2)…");
    expect(taskProgress({ status: "awaiting_human" }, [leg(1, "a", "awaiting_human", [], { pending_kind: "first_contact" }), leg(2, "w", "queued", [1])], tools).headline)
      .toBe("Waiting for you: ChatGPT — approve the first contact. Open it in the list below.");
    expect(taskProgress({ status: "failed", stop_reason: "Only one tool answered, so there was nothing to compare." }, [leg(1, "a", "failed"), leg(2, "w", "failed", [1])], tools).headline)
      .toBe("Stopped: Only one tool answered, so there was nothing to compare. The credit for this task is given back.");
  });
});

describe("proofTiles: the proof of a result at a glance", () => {
  it("says what was done, which tools answered and which did not, what the rules did, and the checks", () => {
    const tiles = proofTiles(taskArt());
    expect(tiles.map((t) => t.key)).toEqual(["done", "tools", "rules", "checks"]);
    expect(tiles[0].text).toBe("NazAI wrote this research from 1 checked answer.");
    expect(tiles[1]).toMatchObject({ tone: "warn", text: "Answered: Claude. Did not answer: ChatGPT." });
    expect(tiles[2].text).toBe("1 rule checked every answer; none had to change anything.");
    expect(tiles[3].text).toMatch(/^Every kept answer passed its completion check\. Fingerprint c{12}\.$/);
  });
});

describe("TaskTracker", () => {
  beforeEach(() => { vi.clearAllMocks(); state.tools = tools; });

  it("shows nothing when there are no Start task Tasks", async () => {
    state.workflows = [{ id: "t9", objective: "Write the brief", status: "completed", started_at: "x", stop_reason: null, final_artifact: null }];
    state.legs = [{ ...leg(1, "a", "completed"), workflow_id: "t9" }];
    const { container } = render(<TaskTracker accountId="u1" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe("");
  });

  it("a running Task: its action, its text, the line and a step per tool and for NazAI", async () => {
    state.workflows = [{ id: "t1", objective: "Research: AI safety evaluation", status: "running", started_at: "x", stop_reason: null, final_artifact: null }];
    state.legs = [leg(1, "a", "running"), leg(2, "b", "completed"), leg(3, "w", "queued", [1, 2])];
    render(<TaskTracker accountId="u1" />);
    expect((await screen.findByTestId("task-headline")).textContent).toBe("Waiting for ChatGPT (1 of 2 answered)…");
    expect(screen.getByText("Research & synthesize")).toBeTruthy();
    expect(screen.getByText("AI safety evaluation")).toBeTruthy();
    expect(screen.getAllByTestId("task-node").map((n) => n.getAttribute("data-state"))).toEqual(["asking", "done", "waiting"]);
    expect(screen.getByText("At the same time")).toBeTruthy();
    expect(screen.queryByTestId("final-artifact")).toBeNull();
  });

  it("when the Task finishes while the page is open: Result ready, the result with its proof, and a message to view it", async () => {
    state.workflows = [{ id: "t1", objective: "Research: AI safety evaluation", status: "running", started_at: "x", stop_reason: null, final_artifact: null }];
    state.legs = [leg(1, "a", "failed"), leg(2, "b", "completed"), leg(3, "w", "running", [1, 2])];
    const { rerender } = render(<TaskTracker accountId="u1" refreshKey={0} />);
    expect((await screen.findByTestId("task-headline")).textContent).toBe("NazAI is writing the result from 1 checked answer…");
    state.workflows = [{ id: "t1", objective: "Research: AI safety evaluation", status: "completed", started_at: "x", stop_reason: null, final_artifact: taskArt() }];
    state.legs = [leg(1, "a", "failed"), leg(2, "b", "completed"), leg(3, "w", "completed", [1, 2])];
    rerender(<TaskTracker accountId="u1" refreshKey={1} />);
    await waitFor(() => expect(screen.getByTestId("task-headline").textContent).toBe("Result ready, written without ChatGPT (no answer)."));
    expect((toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("Result ready: Research & synthesize");
    expect(screen.getByTestId("final-artifact")).toBeTruthy();
    expect(screen.getByTestId("report-missing").textContent).toMatch(/Not included because it did not answer: ChatGPT \(The tool answered HTTP 503\)\./);
    expect(screen.getByTestId("proof-tools").textContent).toMatch(/Did not answer: ChatGPT/);
    expect(screen.getByTestId("task-node-result").getAttribute("data-state")).toBe("done");
  });

  it("a card can be folded; a finished Task can be hidden", async () => {
    state.workflows = [{ id: "t1", objective: "Research: AI safety evaluation", status: "completed", started_at: "x", stop_reason: null, final_artifact: taskArt() }];
    state.legs = [leg(1, "a", "failed"), leg(2, "b", "completed"), leg(3, "w", "completed", [1, 2])];
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskTracker accountId="u1" />);
    await screen.findByTestId("final-artifact");
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByTestId("final-artifact")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByTestId("task-hide"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ action: "archive", kind: "workflow", id: "t1" });
  });
});

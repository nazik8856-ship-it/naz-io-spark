// Correctness verification follow-up (2026-10-09): AgentControlReport
// (GAP 3) was built by mirroring WebsiteControlReport but shipped with
// zero test coverage of its own -- it has an independent data path
// (fetches by agentId via useEffect instead of reading props) and an
// independent copy of the same conditional-className layout logic, which
// turned out to carry the exact same "flagged badge loses its ml-auto
// right-alignment when there's no numeric trust score to show" bug this
// audit found and fixed in WebsiteControlReport.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  },
}));

// Imported AFTER the mock so the component picks up the mocked client.
const { default: AgentControlReport } = await import("@/components/agents/AgentControlReport");

async function renderReport(data: { trust_score: number | null; generation_notes: string[] } | null) {
  maybeSingleMock.mockResolvedValue({ data });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AgentControlReport agentId="agent-1" />);
    // Let the useEffect's async fetch resolve.
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

describe("AgentControlReport", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
  });

  it("renders nothing before the fetch resolves and nothing for a clean agent with no score yet (trust_score null, no notes)", async () => {
    const container = await renderReport({ trust_score: null, generation_notes: [] });
    expect(container.textContent).toBe("");
  });

  it("renders the numeric trust score and notes for a flagged agent", async () => {
    const container = await renderReport({
      trust_score: 60,
      generation_notes: [`Your agent's system prompt touches your safety rule(s) (Destructive wording) -- not something this check can mechanically fix, but worth reviewing.`],
    });
    expect(container.textContent).toContain("60");
    expect(container.textContent).toContain("flagged");
  });

  it("falls back to showing 'clean' with no score badge when trust_score is null but there are no notes either -- wait, that case renders nothing (covered above); this covers CLEAN with an explicit 0 notes and a real persisted 100", async () => {
    const container = await renderReport({ trust_score: 100, generation_notes: [] });
    expect(container.textContent).toContain("100");
    expect(container.textContent).toContain("clean");
  });

  // The actual bug this file exists to catch: a pre-GAP-3 agent that
  // already has flagged generation_notes (written before trust_score
  // existed) has trust_score still null in the DB -- the score badge
  // correctly doesn't render, but the flagged-count badge right next to
  // it must still carry the page's own right-alignment margin instead of
  // silently collapsing left now that nothing before it has "ml-auto".
  it("the flagged-count badge keeps ml-auto right-alignment when trust_score is null but notes exist", async () => {
    const container = await renderReport({
      trust_score: null,
      generation_notes: [`Your agent's decision policy touches your safety rule(s) (Destructive wording) -- not something this check can mechanically fix, but worth reviewing.`],
    });
    const spans = Array.from(container.querySelectorAll("span"));
    const countBadge = spans.find((s) => s.textContent?.includes("flagged"));
    expect(countBadge, "expected to find the flagged-count badge").toBeTruthy();
    expect(countBadge!.className).toContain("ml-auto");
  });

  it("renders nothing for an unsaved local agent (id starts with 'local-') without even attempting a fetch", async () => {
    maybeSingleMock.mockResolvedValue({ data: { trust_score: 60, generation_notes: ["should never be read"] } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AgentControlReport agentId="local-123" />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("");
    expect(maybeSingleMock).not.toHaveBeenCalled();
  });
});

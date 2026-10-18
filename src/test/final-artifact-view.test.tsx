import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FinalArtifactView from "@/components/control/outer/FinalArtifactView";
import { sessionArtifact } from "./artifact-fixture";
import { buildSessionArtifact } from "@/lib/outer-control-artifact";

describe("FinalArtifactView", () => {
  it("shows the controlled result at once and the proof, rules and changes as readable text or JSON of the same record", () => {
    const a = sessionArtifact("Returns take thirty days.", { changes: true });
    render(<FinalArtifactView artifact={a} kind="session" />);
    expect(screen.getByTestId("final-artifact-output").textContent).toBe("Returns take thirty days.");
    expect(screen.getByTestId("final-artifact-text").textContent).toBe(a.human_text);
    expect(screen.getByTestId("final-artifact-proof").textContent).toMatch(/1 rule triggered · 1 change/);
    fireEvent.click(screen.getByText("JSON"));
    expect(JSON.parse(screen.getByTestId("final-artifact-json").textContent ?? "")).toEqual(JSON.parse(JSON.stringify(a)));
  });

  it("renders nothing for an artifact that is missing or does not validate", () => {
    const { container, rerender } = render(<FinalArtifactView artifact={null} kind="session" />);
    expect(container.innerHTML).toBe("");
    rerender(<FinalArtifactView artifact={{ ...sessionArtifact(), final_output: "tampered" }} kind="session" />);
    expect(container.innerHTML).toBe("");
    rerender(<FinalArtifactView artifact={sessionArtifact()} kind="task" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows what was done and a link that opens the completed work in a new tab", () => {
    const sha = "a".repeat(64);
    const r = buildSessionArtifact({
      id: "s1", taskId: null, objective: "Schedule a call", tool: "Support Agent", completedAt: "2026-10-18T00:00:00Z",
      finalText: "Scheduled the call.\n\nDone by the agent:\n- Created Google Calendar event \"Call\" — https://calendar.google.com/calendar/event?eid=zzz", sha256: sha,
      checklist: { passed: true, outcome: "completed", summary: "ok", criteria: [{ id: "a", label: "a", ok: true, detail: "d" }], output_sha256: sha },
      steps: [], rulesInForce: [], decidedBy: "tool", whatDone: "Support Agent did: Created Google Calendar event \"Call\"",
    });
    if (r.ok !== true) throw new Error("fixture");
    render(<FinalArtifactView artifact={r.artifact} kind="session" />);
    expect(screen.getByTestId("final-artifact-what-done").textContent).toMatch(/What was done · Support Agent did: Created Google Calendar event/);
    const a = screen.getByTestId("final-artifact-links").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://calendar.google.com/calendar/event?eid=zzz");
    expect(a.getAttribute("target")).toBe("_blank"); expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toMatch(/Open the work · calendar\.google\.com/);
  });

  it("shows no links section when the work has no link", () => {
    render(<FinalArtifactView artifact={sessionArtifact()} kind="session" />);
    expect(screen.queryByTestId("final-artifact-links")).toBeNull();
  });
});

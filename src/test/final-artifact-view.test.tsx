import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FinalArtifactView from "@/components/control/outer/FinalArtifactView";
import { sessionArtifact } from "./artifact-fixture";

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
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SetupProgressBar from "@/components/control/dashboard/SetupProgressBar";
import RuleCoverageHealthCard from "@/components/control/dashboard/RuleCoverageHealthCard";

const checks = [{ label: "Hard rules configured", done: false, onClick: () => {} }];

describe("SetupProgressBar call to action", () => {
  it("shows the template button inside the card and calls it", () => {
    const onClick = vi.fn();
    render(<SetupProgressBar pct={25} checks={checks} cta={{ label: "Start from a policy template", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Start from a policy template" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it("shows no call to action when none is given", () => {
    render(<SetupProgressBar pct={25} checks={checks} />);
    expect(screen.queryByText(/policy template/i)).toBeNull();
  });
  it("renders nothing once setup is complete", () => {
    const { container } = render(<SetupProgressBar pct={100} checks={checks} cta={{ label: "x", onClick: () => {} }} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("RuleCoverageHealthCard readouts", () => {
  it("floats the coverage and health readouts over the graph, still clickable", () => {
    const onCoverageClick = vi.fn();
    const onHealthClick = vi.fn();
    render(
      <RuleCoverageHealthCard coveragePct={80} coverageGapCount={1} coverageTotal={5} coverageCells={[]} healthPct={95}
        onCoverageClick={onCoverageClick} onHealthClick={onHealthClick} />,
    );
    const overlay = screen.getByTestId("coverage-overlay");
    expect(overlay.className).toMatch(/absolute/);
    fireEvent.click(screen.getByText("Coverage 80%"));
    fireEvent.click(screen.getByText("Health 95%"));
    expect(onCoverageClick).toHaveBeenCalled();
    expect(onHealthClick).toHaveBeenCalled();
  });
});

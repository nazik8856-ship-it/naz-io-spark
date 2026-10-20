import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ProjectPicker from "@/components/control/ProjectPicker";
import { toProjects } from "@/lib/inner-projects";

const projects = toProjects(
  [{ id: "a1", name: "Support agent", created_at: "2026-10-12T00:00:00Z" }],
  [{ id: "w1", name: "Lisbon Yoga Studio", created_at: "2026-10-11T00:00:00Z" }, { id: "w2", name: "Bakery", created_at: "2026-10-10T00:00:00Z" }],
);

describe("ProjectPicker", () => {
  const base = { onSelect: vi.fn(), onCreate: vi.fn() };
  it("lists agents and websites in groups and reports the choice", () => {
    const onSelect = vi.fn();
    render(<ProjectPicker {...base} onSelect={onSelect} projects={projects} selected={projects[0]} loading={false} />);
    const select = screen.getByLabelText("Choose the project Inner Control shows") as HTMLSelectElement;
    expect(select.value).toBe("agent:a1");
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Agents", "Websites"]);
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Support agent", "Lisbon Yoga Studio", "Bakery"]);
    fireEvent.change(select, { target: { value: "website:w2" } });
    expect(onSelect).toHaveBeenCalledWith("website:w2");
  });
  it("with one project it is a label with its type, not a dropdown", () => {
    render(<ProjectPicker {...base} projects={[projects[0]]} selected={projects[0]} loading={false} />);
    expect(screen.getByTestId("project-picker-single").textContent).toMatch(/Agent.*Support agent/);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("with none it invites creating the first one", () => {
    const onCreate = vi.fn();
    render(<ProjectPicker {...base} onCreate={onCreate} projects={[]} selected={null} loading={false} />);
    fireEvent.click(screen.getByTestId("project-picker-empty"));
    expect(onCreate).toHaveBeenCalled();
  });
  it("shows a placeholder while the projects load, never the empty invitation", () => {
    render(<ProjectPicker {...base} projects={[]} selected={null} loading />);
    expect(screen.getByTestId("project-picker-loading")).toBeTruthy();
    expect(screen.queryByTestId("project-picker-empty")).toBeNull();
  });
});

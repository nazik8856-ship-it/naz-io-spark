import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AssemblyVisual from "@/components/generator/AssemblyVisual";
import { INITIAL_CHECKS, type QualityCheck } from "@/lib/site-structures";
import type { AssemblyPage, AssemblyPhase } from "@/lib/assembly";

const pages: AssemblyPage[] = [
  { slug: "home", title: "Home", sections: ["hero", "about", "services", "faq", "cta"] },
  { slug: "results", title: "Results", sections: ["feature-split", "gallery"] },
  { slug: "booking", title: "Booking", sections: ["pricing", "contact"] },
];

const renderAt = (phase: AssemblyPhase, p: AssemblyPage[] = pages, checks: QualityCheck[] = INITIAL_CHECKS) =>
  render(<AssemblyVisual pages={p} phase={phase} checks={checks} siteName="Flight Finder Pro" />);

describe("AssemblyVisual", () => {
  it("shows the REAL page names and section counts, one card per page", () => {
    renderAt(2);
    const list = screen.getByRole("list", { name: /pages in this site/i });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.getAttribute("data-card"))).toEqual(["home", "results", "booking"]);
    expect(within(cards[0]).getByText("Home")).toBeTruthy();
    expect(within(cards[0]).getByText("5 sections")).toBeTruthy();
    expect(within(cards[1]).getByText("2 sections")).toBeTruthy();
  });

  it("a different site shows different names: nothing is hardcoded", () => {
    renderAt(2, [{ slug: "pricing", title: "Pricing", sections: ["pricing"] }, { slug: "contact", title: "Contact", sections: ["contact"] }]);
    expect(screen.getByText("Pricing")).toBeTruthy();
    expect(screen.queryByText("Results")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText("1 section")).toHaveLength(2);
  });

  it("draws exactly one layer per page, and the page layers appear only from Synthesis on", () => {
    const { container, rerender } = renderAt(1);
    const layers = () => Array.from(container.querySelectorAll('[data-layer="page"]')) as SVGElement[];
    expect(layers()).toHaveLength(3);
    expect(layers().every((l) => l.style.opacity === "0")).toBe(true);
    rerender(<AssemblyVisual pages={pages} phase={2} checks={INITIAL_CHECKS} />);
    expect(layers().every((l) => l.style.opacity === "1")).toBe(true);
  });

  it("cards go Planned → Building → Merging → Merged with the phase; 'Merged' only at the end", () => {
    const labels: Record<number, string> = { 0: "Planned", 1: "Planned", 2: "Building", 3: "Merging", 4: "Merged" };
    for (const phase of [0, 1, 2, 3, 4] as AssemblyPhase[]) {
      const { unmount } = renderAt(phase);
      for (const li of screen.getAllByRole("listitem")) expect(within(li).getByText(labels[phase])).toBeTruthy();
      unmount();
    }
  });

  it("marks stages done / active / pending, with the active one carrying the trace caption", () => {
    const { container } = renderAt(2);
    const state = (name: string) => container.querySelector(`[data-stage="${name}"]`)!.getAttribute("data-stage-state");
    expect([state("Intake"), state("Calibration"), state("Synthesis"), state("Synchronization"), state("Vortex")]).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(container.textContent).toMatch(/COMPILE TRACE ACTIVE/);
  });

  it("the calibration cells show the real quality-check states", () => {
    const checks = INITIAL_CHECKS.map((c, i) => ({ ...c, status: (["passed", "fixed", "flagged", "pending"] as const)[i] })) as QualityCheck[];
    const { container } = renderAt(3, pages, checks);
    const fill = (id: string) => container.querySelector(`[data-check="${id}"]`)!.getAttribute("fill");
    expect(fill("structure")).toBe("#34d399"); // passed
    expect(fill("visual")).toBe("#22d3ee");    // fixed
    expect(fill("images")).toBe("#fbbf24");    // flagged
    expect(fill("claims")).toBe("rgba(255,255,255,0.18)"); // pending
  });

  it("the final phase reports the assembled totals and reveals the output frame", () => {
    const { container } = renderAt(4);
    expect(screen.getByTestId("assembly-caption").textContent).toMatch(/Assembled · 3 pages · 9 sections/);
    const out = container.querySelector('[data-layer="output"]') as SVGElement;
    expect(out.style.opacity).toBe("1");
    expect(container.querySelector('[data-assembly-phase="4"]')).toBeTruthy();
  });

  it("before the output phase the site frame is hidden", () => {
    const { container } = renderAt(3);
    expect((container.querySelector('[data-layer="output"]') as SVGElement).style.opacity).toBe("0");
  });

  it("with no pages yet it shows three dashed 'planning' placeholders, never invented names", () => {
    renderAt(0, []);
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.getAttribute("data-card-state") === "planning")).toBe(true);
    expect(screen.queryByText("Home")).toBeNull();
    expect(screen.getAllByText("Planning pages…")).toHaveLength(3);
  });

  it("never draws more than six page layers however many pages are passed", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ slug: `p${i}`, title: `Page ${i}`, sections: ["hero"] }));
    const { container } = renderAt(2, many);
    expect(container.querySelectorAll('[data-layer="page"]')).toHaveLength(6);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("describes itself for screen readers with the phase and the real counts", () => {
    renderAt(2);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/Flight Finder Pro: Synthesis — Writing every page\. 3 pages, 9 sections\./);
  });

  it("a status override replaces the caption (used to show 'taking longer than usual')", () => {
    render(<AssemblyVisual pages={pages} phase={2} statusText="Refining quality… (taking longer than usual…)" />);
    expect(screen.getByTestId("assembly-caption").textContent).toMatch(/taking longer than usual/);
  });
});

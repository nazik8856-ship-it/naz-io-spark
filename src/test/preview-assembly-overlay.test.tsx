import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PreviewAssemblyOverlay from "@/components/generator/PreviewAssemblyOverlay";
import type { AssemblyPage } from "@/lib/assembly";

const pages: AssemblyPage[] = [
  { slug: "home", title: "Home", sections: ["hero", "about", "cta"] },
  { slug: "pricing", title: "Pricing", sections: ["pricing", "faq"] },
];
type P = React.ComponentProps<typeof PreviewAssemblyOverlay>;
const props = (o: Partial<P> = {}): P => ({ busy: false, stage: null, stepsPhase: 0, previewLoaded: true, pages, siteName: "Flight Finder Pro", ...o });
const overlay = () => screen.queryByTestId("preview-assembly-overlay");
const phase = () => overlay()?.querySelector("[data-assembly-phase]")?.getAttribute("data-assembly-phase");

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("PreviewAssemblyOverlay", () => {
  it("is absent when nothing is happening to the site", () => {
    render(<PreviewAssemblyOverlay {...props()} />);
    expect(overlay()).toBeNull();
  });

  it("appears when an edit starts, with this site's real pages", () => {
    const { rerender } = render(<PreviewAssemblyOverlay {...props()} />);
    rerender(<PreviewAssemblyOverlay {...props({ busy: true })} />);
    expect(overlay()).not.toBeNull();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Pricing")).toBeTruthy();
    expect(phase()).toBe("0");
  });

  it("follows the real progress stage forward and never rewinds on a late poll", () => {
    const { rerender } = render(<PreviewAssemblyOverlay {...props({ busy: true })} />);
    rerender(<PreviewAssemblyOverlay {...props({ busy: true, stage: "generating" })} />);
    expect(phase()).toBe("1");
    rerender(<PreviewAssemblyOverlay {...props({ busy: true, stage: "refining" })} />);
    expect(phase()).toBe("2");
    rerender(<PreviewAssemblyOverlay {...props({ busy: true, stage: "understanding" })} />);
    expect(phase()).toBe("2");
    rerender(<PreviewAssemblyOverlay {...props({ busy: true, stage: "refining", stepsPhase: 3 })} />);
    expect(phase()).toBe("3");
  });

  it("when the edit finishes the pages merge into the finished site (phase 4), then it goes away", () => {
    const { rerender } = render(<PreviewAssemblyOverlay {...props({ busy: true, stage: "saving" })} />);
    rerender(<PreviewAssemblyOverlay {...props({ busy: false })} />);
    expect(phase()).toBe("4");
    expect(screen.getByTestId("assembly-caption").textContent).toMatch(/Assembled · 2 pages · 5 sections/);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(overlay()).toBeNull();
  });

  it("a fast-loading preview never shows the overlay", () => {
    const { rerender } = render(<PreviewAssemblyOverlay {...props({ previewLoaded: false })} />);
    act(() => { vi.advanceTimersByTime(200); });
    rerender(<PreviewAssemblyOverlay {...props({ previewLoaded: true })} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(overlay()).toBeNull();
  });

  it("a slow preview shows it, says it is loading, and resolves into the site when it loads", () => {
    const { rerender } = render(<PreviewAssemblyOverlay {...props({ previewLoaded: false })} />);
    act(() => { vi.advanceTimersByTime(600); });
    expect(overlay()).not.toBeNull();
    expect(screen.getByTestId("assembly-caption").textContent).toMatch(/Loading your live preview/);
    rerender(<PreviewAssemblyOverlay {...props({ previewLoaded: true })} />);
    expect(phase()).toBe("4");
    act(() => { vi.advanceTimersByTime(1600); });
    expect(overlay()).toBeNull();
  });
});

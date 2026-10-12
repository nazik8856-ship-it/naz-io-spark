// Smart Structure Selector, outline editor (progressive stage 1), live quality
// strip and stage stepper. These render the real components; the server rules
// they correspond to are covered by generation-templates_test.ts.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import StructureSelector from "@/components/generator/StructureSelector";
import OutlineEditor from "@/components/generator/OutlineEditor";
import QualityStrip from "@/components/generator/QualityStrip";
import StageStepper from "@/components/generator/StageStepper";
import {
  INITIAL_CHECKS, isAutoFixNote, moveItem, normalizeChecks, STRUCTURE_OPTIONS, stripNotePrefix, type Outline,
} from "@/lib/site-structures";

function mount(node: JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(node); });
  return { container, rerender: (n: JSX.Element) => act(() => { root.render(n); }) };
}

describe("StructureSelector", () => {
  it("offers exactly the four structures and marks the selected one", () => {
    const { container } = mount(<StructureSelector value="agency" onChange={() => {}} />);
    const radios = Array.from(container.querySelectorAll('[role="radio"]'));
    expect(radios.map((r) => r.getAttribute("data-structure"))).toEqual(["simple-landing", "full-business", "pricing-focused", "agency"]);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.getAttribute("data-structure"))).toEqual(["agency"]);
    expect(container.textContent).toContain("Simple Landing");
    expect(container.textContent).toContain("Pricing page (3+ plans) with FAQ");
  });

  it("reports the clicked structure", () => {
    const onChange = vi.fn();
    const { container } = mount(<StructureSelector value="full-business" onChange={onChange} />);
    act(() => { (container.querySelector('[data-structure="pricing-focused"]') as HTMLButtonElement).click(); });
    expect(onChange).toHaveBeenCalledWith("pricing-focused");
  });

  it("is inert while disabled", () => {
    const onChange = vi.fn();
    const { container } = mount(<StructureSelector value="full-business" onChange={onChange} disabled />);
    act(() => { (container.querySelector('[data-structure="agency"]') as HTMLButtonElement).click(); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("matches the server-side ids (guards against the duplicated list drifting)", () => {
    expect(STRUCTURE_OPTIONS.map((s) => s.id)).toEqual(["simple-landing", "full-business", "pricing-focused", "agency"]);
  });
});

const outline = (): Outline => ({
  pages: [
    { slug: "home", title: "Home", sections: [{ type: "hero" }, { type: "about" }, { type: "services" }, { type: "cta" }] },
    { slug: "about", title: "About", sections: [{ type: "about" }, { type: "process" }] },
    { slug: "menu", title: "Menu", sections: [{ type: "services" }, { type: "faq" }] },
    { slug: "contact", title: "Contact", sections: [{ type: "contact" }] },
  ],
});

describe("OutlineEditor", () => {
  it("renders every page and section", () => {
    const { container } = mount(<OutlineEditor outline={outline()} onChange={() => {}} />);
    expect(container.querySelectorAll("[data-page]").length).toBe(4);
    expect(container.querySelector('[data-page="home"]')!.querySelectorAll("[data-section]").length).toBe(4);
  });

  it("home and contact cannot be removed or moved; other pages can", () => {
    const { container } = mount(<OutlineEditor outline={outline()} onChange={() => {}} />);
    expect(container.querySelector('[aria-label="Remove the Home page"]')).toBeNull();
    expect(container.querySelector('[aria-label="Remove the Contact page"]')).toBeNull();
    expect(container.querySelector('[aria-label="Remove the Menu page"]')).not.toBeNull();
  });

  it("the home hero and the contact form section have no remove button", () => {
    const { container } = mount(<OutlineEditor outline={outline()} onChange={() => {}} />);
    expect(container.querySelector('[data-page="home"] [aria-label="Remove Hero"]')).toBeNull();
    expect(container.querySelector('[data-page="contact"] [aria-label="Remove Contact form"]')).toBeNull();
    expect(container.querySelector('[data-page="home"] [aria-label="Remove Services"]')).not.toBeNull();
  });

  it("removing a section reports an outline without it and leaves everything else untouched", () => {
    const onChange = vi.fn();
    const { container } = mount(<OutlineEditor outline={outline()} onChange={onChange} />);
    act(() => { (container.querySelector('[data-page="menu"] [aria-label="Remove FAQ"]') as HTMLButtonElement).click(); });
    const next = onChange.mock.calls[0][0] as Outline;
    expect(next.pages.find((p) => p.slug === "menu")!.sections.map((s) => s.type)).toEqual(["services"]);
    expect(next.pages.find((p) => p.slug === "home")!.sections.length).toBe(4);
  });

  it("removing a page drops it from the outline", () => {
    const onChange = vi.fn();
    const { container } = mount(<OutlineEditor outline={outline()} onChange={onChange} />);
    act(() => { (container.querySelector('[aria-label="Remove the Menu page"]') as HTMLButtonElement).click(); });
    expect((onChange.mock.calls[0][0] as Outline).pages.map((p) => p.slug)).toEqual(["home", "about", "contact"]);
  });

  it("reordering never moves a page before home or after contact", () => {
    const onChange = vi.fn();
    const { container } = mount(<OutlineEditor outline={outline()} onChange={onChange} />);
    expect((container.querySelector('[aria-label="Move About up"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[aria-label="Move Menu down"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => { (container.querySelector('[aria-label="Move About down"]') as HTMLButtonElement).click(); });
    expect((onChange.mock.calls[0][0] as Outline).pages.map((p) => p.slug)).toEqual(["home", "menu", "about", "contact"]);
  });

  it("adding a section offers only types that cannot invent content (no testimonials/stats/logos)", () => {
    const { container } = mount(<OutlineEditor outline={outline()} onChange={() => {}} />);
    const options = Array.from(container.querySelectorAll('[data-page="about"] select option')).map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(options).toEqual(["about", "feature-split", "services", "gallery", "process", "faq", "pricing", "cta"]);
    expect(options).not.toContain("testimonials");
  });

  it("the contact page offers no 'add section' and no title edit", () => {
    const { container } = mount(<OutlineEditor outline={outline()} onChange={() => {}} />);
    expect(container.querySelector('[data-page="contact"] select')).toBeNull();
    expect((container.querySelector('[aria-label="Title of the contact page"]') as HTMLInputElement).disabled).toBe(true);
  });

  it("everything is inert while a build is running", () => {
    const { container } = mount(<OutlineEditor outline={outline()} onChange={() => {}} disabled />);
    expect(Array.from(container.querySelectorAll("button")).every((b) => b.disabled)).toBe(true);
  });
});

describe("QualityStrip", () => {
  it("shows the four checks in order with their state", () => {
    const checks = normalizeChecks([
      { id: "structure", status: "fixed", detail: "Follows the Agency-style structure (corrected)" },
      { id: "visual", status: "checking" },
      { id: "claims", status: "flagged", detail: "Contact details look like placeholders" },
    ]);
    const { container } = mount(<QualityStrip checks={checks} />);
    const items = Array.from(container.querySelectorAll("[data-check]"));
    expect(items.map((i) => `${i.getAttribute("data-check")}:${i.getAttribute("data-status")}`)).toEqual([
      "structure:fixed", "visual:checking", "images:pending", "claims:flagged",
    ]);
    expect(container.textContent).toContain("Follows the Agency-style structure (corrected)");
    expect(container.textContent).toContain("No hallucinations");
  });

  it("hides detail text while a check is still pending or running", () => {
    const { container } = mount(<QualityStrip checks={normalizeChecks([{ id: "structure", status: "checking", detail: "should not show" }])} />);
    expect(container.textContent).not.toContain("should not show");
  });

  it("normalizeChecks survives garbage from the network", () => {
    expect(normalizeChecks(null)).toEqual(INITIAL_CHECKS);
    expect(normalizeChecks("x")).toEqual(INITIAL_CHECKS);
    expect(normalizeChecks([{ id: "structure", status: "exploded" }])[0].status).toBe("pending");
  });

  it("re-renders as the server reports progress", () => {
    const { container, rerender } = mount(<QualityStrip checks={normalizeChecks([])} />);
    expect(container.querySelector('[data-check="visual"]')!.getAttribute("data-status")).toBe("pending");
    rerender(<QualityStrip checks={normalizeChecks([{ id: "visual", status: "passed" }])} />);
    expect(container.querySelector('[data-check="visual"]')!.getAttribute("data-status")).toBe("passed");
  });
});

describe("StageStepper", () => {
  it("marks earlier stages done, the current active, later ones todo", () => {
    const { container } = mount(<StageStepper current="content" />);
    expect(Array.from(container.querySelectorAll("[data-stage]")).map((s) => s.getAttribute("data-state"))).toEqual(["done", "active", "todo"]);
  });
  it("done marks all three complete", () => {
    const { container } = mount(<StageStepper current="polish" done />);
    expect(Array.from(container.querySelectorAll("[data-stage]")).map((s) => s.getAttribute("data-state"))).toEqual(["done", "done", "done"]);
  });
});

describe("helpers", () => {
  it("moveItem is immutable and ignores out-of-range moves", () => {
    const a = [1, 2, 3];
    expect(moveItem(a, 0, 2)).toEqual([2, 3, 1]);
    expect(a).toEqual([1, 2, 3]);
    expect(moveItem(a, 0, -1)).toBe(a);
    expect(moveItem(a, 1, 3)).toBe(a);
  });
  it("auto-fix note prefixes match the server's", () => {
    expect(isAutoFixNote("Relevance Guard: Removed 1 customer testimonial(s)")).toBe(true);
    expect(isAutoFixNote("Visual fix: Adjusted the text colour")).toBe(true);
    expect(isAutoFixNote("Quality check: ...")).toBe(false);
    expect(isAutoFixNote("Content matching your safety rule(s) was redacted")).toBe(false);
    expect(stripNotePrefix("Relevance Guard: Removed x")).toBe("Removed x");
  });
});

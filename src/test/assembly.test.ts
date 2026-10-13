import { describe, expect, it } from "vitest";
import { advancePhase, assemblyPhase, cardState, summarizeAssembly, toAssemblyPages } from "@/lib/assembly";

describe("assemblyPhase", () => {
  it("maps each real generation_progress stage to its phase", () => {
    expect(assemblyPhase("understanding")).toBe(0);
    expect(assemblyPhase("generating")).toBe(1);
    expect(assemblyPhase("refining")).toBe(2);
    expect(assemblyPhase("reviewing")).toBe(3);
    expect(assemblyPhase("saving")).toBe(3);
  });
  it("an unknown or missing stage stays at Intake rather than guessing forward", () => {
    expect(assemblyPhase(null)).toBe(0);
    expect(assemblyPhase(undefined)).toBe(0);
    expect(assemblyPhase("something-new")).toBe(0);
  });
  it("only the saved site (done) reaches the final phase; no stage alone can", () => {
    expect(assemblyPhase("saving")).toBe(3);
    expect(assemblyPhase("saving", true)).toBe(4);
    expect(assemblyPhase(null, true)).toBe(4);
  });
});

describe("advancePhase", () => {
  it("never moves backwards (a late poll must not rewind the animation)", () => {
    expect(advancePhase(3, 1)).toBe(3);
    expect(advancePhase(2, 2)).toBe(2);
    expect(advancePhase(1, 3)).toBe(3);
  });
});

describe("toAssemblyPages", () => {
  it("turns outline pages (section objects) and saved rows (section arrays) into the same card data", () => {
    const fromOutline = toAssemblyPages([{ slug: "home", title: "Home", sections: [{ type: "hero" }, { type: "cta" }] }]);
    const fromRows = toAssemblyPages([{ slug: "home", title: "Home", sections: [{ type: "hero", content: {} }, { type: "cta", content: {} }] }]);
    expect(fromOutline).toEqual([{ slug: "home", title: "Home", sections: ["hero", "cta"] }]);
    expect(fromRows).toEqual(fromOutline);
  });
  it("falls back to the slug when a title is missing, caps at six, and tolerates junk", () => {
    expect(toAssemblyPages([{ slug: "menu", sections: [] }])[0].title).toBe("menu");
    expect(toAssemblyPages(Array.from({ length: 9 }, (_, i) => ({ slug: `p${i}`, title: `P${i}`, sections: [] })))).toHaveLength(6);
    expect(toAssemblyPages(null)).toEqual([]);
    expect(toAssemblyPages([{ slug: 5 as never, title: 7 as never, sections: "x" as never }])[0].sections).toEqual([]);
  });
});

describe("cardState / summarizeAssembly", () => {
  it("a page is only 'merged' in the final phase", () => {
    expect([0, 1, 2, 3, 4].map((p) => cardState(p as 0))).toEqual(["queued", "queued", "building", "merging", "merged"]);
  });
  it("counts the real pages and sections", () => {
    expect(summarizeAssembly([{ slug: "a", title: "A", sections: ["hero", "cta"] }, { slug: "b", title: "B", sections: ["contact"] }])).toEqual({ pages: 2, sections: 3 });
  });
});

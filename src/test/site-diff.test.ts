import { describe, expect, it } from "vitest";
import { diffSites, type DiffSite } from "@/lib/site-diff";

const site = (): DiffSite => ({
  theme: { palette: { bg: "#0B0B0F", text: "#2a2a33", accent: "#E8834A" }, layout: "asymmetric", motion: "subtle", font: { heading: "Fraunces", body: "Inter" } },
  pages: [
    { slug: "home", title: "Home", sections: [
      { type: "hero", variant: "split-image", content: { headline: "The ultimate coffee!", cta_primary: "Menu", image_prompt: "cafe" } },
      { type: "about", content: { heading: "Story", body: "We roast." } },
      { type: "gallery", content: { heading: "G", items: [{ caption: "a", image_prompt: "x" }, { caption: "b", image_prompt: "y" }] } },
    ] },
    { slug: "contact", title: "Contact", sections: [{ type: "contact", content: { heading: "Contact", form_fields: ["name"] } }] },
  ],
});

describe("diffSites", () => {
  it("identical sites -> no change, no lines", () => {
    const d = diffSites(site(), site());
    expect(d.changed).toBe(false);
    expect(d.lines).toEqual([]);
  });

  it("names the page, section and field whose text changed", () => {
    const after = site();
    (after.pages[0].sections[0].content as any).headline = "Coffee roasted in Vienna";
    expect(diffSites(site(), after).lines).toEqual(["Home › hero: headline changed"]);
  });

  it("ignores image_prompt/media_style churn (not visible) but reports added images", () => {
    const after = site();
    (after.pages[0].sections[0].content as any).image_prompt = "different prompt";
    expect(diffSites(site(), after).changed).toBe(false);
    (after.pages[0].sections[0].content as any).asset_url = "https://x/img.webp";
    (after.pages[0].sections[2].content as any).items[0].asset_url = "https://x/g1.webp";
    const d = diffSites(site(), after);
    expect(d.imagesAdded).toBe(2);
    expect(d.lines).toContain("Images: 2 added");
  });

  it("reports page additions/removals and structural section changes", () => {
    const after = site();
    after.pages.splice(1, 0, { slug: "pricing", title: "Pricing", sections: [{ type: "pricing", content: { heading: "Plans" } }] });
    after.pages[0].sections.pop();
    const lines = diffSites(site(), after).lines;
    expect(lines).toContain("Added page: Pricing");
    expect(lines.some((l) => l.startsWith("Home: sections changed (hero, about, gallery → hero, about)"))).toBe(true);
    const removed = diffSites(after, site()).lines;
    expect(removed).toContain("Removed page: Pricing");
  });

  it("reports theme changes: colours by name, spacing, layout, fonts", () => {
    const after = site();
    after.theme!.palette.text = "#f4f4f5";
    after.theme!.spacing = "professional";
    after.theme!.font = { heading: "Syne", body: "Inter" };
    const lines = diffSites(site(), after).lines;
    expect(lines).toContain("Colours changed: text");
    expect(lines).toContain("Theme spacing: default → professional");
    expect(lines).toContain("Fonts changed");
  });

  it("reports a variant change", () => {
    const after = site();
    after.pages[0].sections[0].variant = "full-bleed";
    expect(diffSites(site(), after).lines).toContain("Home › hero: layout variant changed (split-image → full-bleed)");
  });

  it("caps the list and says how many more", () => {
    const many = site();
    many.pages = Array.from({ length: 20 }, (_, i) => ({ slug: `p${i}`, title: `P${i}`, sections: [{ type: "about", content: { heading: "x" } }] }));
    const d = diffSites({ theme: many.theme, pages: [] }, many);
    expect(d.lines.length).toBe(1);
    const changed = JSON.parse(JSON.stringify(many)) as DiffSite;
    changed.pages.forEach((p) => ((p.sections[0].content as any).heading = "y"));
    const d2 = diffSites(many, changed);
    expect(d2.lines.length).toBe(13);
    expect(d2.lines[12]).toBe("…and 8 more");
  });
});

// Regression: WebsitePreview called a hook (useMemo for the CTA navigation
// context) AFTER its loading/error early returns. A visitor with no cached copy
// of the site (loading -> loaded) therefore rendered more hooks than on the
// previous render, React threw, and the page showed "Something went wrong".
// Only browsers whose preview cache had been seeded by the builder were spared.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const SID = "11111111-2222-3333-4444-555555555555";
const site = { id: SID, name: "Ember Coffee", tagline: "Coffee for the obsessed", theme: { palette: { bg: "#0B0B0F", surface: "#151520", text: "#F4F4F5", accent: "#E8834A", accentSecondary: "#1B7A72", muted: "#999999", border: "#333333" }, font: { heading: "Inter", body: "Inter" } } };
const livePages = [{ id: "p1", slug: "home", title: "Home", seo_description: null, order_index: 0, sections: [{ type: "hero", content: { headline: "Live headline", subheadline: "s", cta_primary: "Go" } }] }];
const snapshot = { website_snapshot: { name: "Ember Coffee", tagline: "t", theme: site.theme }, pages_snapshot: [{ slug: "home", title: "Home", order_index: 0, sections: [{ type: "hero", content: { headline: "Snapshot headline", subheadline: "s", cta_primary: "Go" } }] }] };

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, order: () => q,
      maybeSingle: async () => ({ data: table === "websites" ? { ...site, images_status: "done" } : table === "website_versions" ? snapshot : null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: table === "website_pages" ? livePages : [], error: null }).then(res, rej),
    };
    return q;
  };
  return {
    // A visitor (or the owner) opens the site through the one-site lookup, which returns the site with its pages.
    supabase: {
      auth: { getSession: async () => ({ data: { session: null } }) }, from: builder, functions: { invoke: vi.fn() },
      rpc: async (fn: string, args: { _ref: string; _meta_only?: boolean }) => ({
        data: fn === "get_public_site" && args._ref === SID ? { ...site, images_status: "done", ...(args._meta_only ? {} : { pages: livePages }) } : null, error: null,
      }),
    },
    SUPABASE_FUNCTIONS_URL: "https://x.supabase.co/functions/v1",
    SUPABASE_ANON: "anon",
    SUPABASE_URL: "https://x.supabase.co",
  };
});

// jsdom has none of the browser APIs the reveal/tilt effects use.
(globalThis as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) as unknown as MediaQueryList);
window.scrollTo = (() => {}) as typeof window.scrollTo;

import WebsitePreview from "@/pages/WebsitePreview";

async function mount(url: string) {
  localStorage.clear();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a); });
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/website-preview/:id" element={<WebsitePreview />} /></Routes></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  spy.mockRestore();
  return { container, errors };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("WebsitePreview with no cached copy", () => {
  it("renders the site instead of crashing on the loading -> loaded transition", async () => {
    const { container, errors } = await mount(`/website-preview/${SID}`);
    expect(container.textContent).toContain("Live headline");
    expect(container.textContent).not.toContain("Something went wrong");
    expect(JSON.stringify(errors)).not.toContain("more hooks");
  });

  it("?version=<id> renders that saved snapshot, not the live pages", async () => {
    const { container } = await mount(`/website-preview/${SID}?embed=1&version=abc`);
    expect(container.textContent).toContain("Snapshot headline");
    expect(container.textContent).not.toContain("Live headline");
  });

  it("viewing a version never writes to (or reads from) the live preview cache", async () => {
    localStorage.setItem(`nazai_website_preview_${SID}`, JSON.stringify({ website: site, pages: livePages, cachedAt: Date.now() }));
    const before = localStorage.getItem(`nazai_website_preview_${SID}`);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[`/website-preview/${SID}?version=abc`]}><Routes><Route path="/website-preview/:id" element={<WebsitePreview />} /></Routes></MemoryRouter>);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(container.textContent).toContain("Snapshot headline");
    expect(localStorage.getItem(`nazai_website_preview_${SID}`)).toBe(before);
  });
});

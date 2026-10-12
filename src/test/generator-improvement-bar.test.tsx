// "Make it more professional" bar, live checks, auto-fix list, before/after dialog.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SID = "11111111-2222-3333-4444-555555555555";
const state = { versions: [{ id: "v1", label: "Before professional pass", created_at: "2026-10-12T10:00:00Z" }] as any[], progress: null as any };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({
        data: table === "website_versions" ? { website_snapshot: { theme: {} }, pages_snapshot: [{ slug: "home", title: "Home", sections: [{ type: "hero", content: { headline: "Old" } }] }] }
          : table === "generation_progress" ? state.progress : null,
        error: null,
      }),
      then: (res: any, rej: any) => Promise.resolve({ data: table === "website_versions" ? state.versions : [], error: null }).then(res, rej),
    };
    return q;
  };
  return {
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) }, from: builder },
    SUPABASE_FUNCTIONS_URL: "https://x.supabase.co/functions/v1",
    SUPABASE_ANON: "anon",
  };
});

import { toast } from "sonner";
import SiteImprovementBar from "@/components/generator/SiteImprovementBar";

const website = (over: any = {}) => ({ id: SID, name: "Ember", theme: { palette: {} }, structure_template: "full-business", strict_mode: true, generation_stage: "content", generation_notes: [], ...over });
const pages = [{ slug: "home", title: "Home", sections: [{ type: "hero", content: { headline: "New" } }] }];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state.versions = [{ id: "v1", label: "Before professional pass", created_at: "2026-10-12T10:00:00Z" }];
  state.progress = null;
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ improved: true, summary: "Professional pass applied 2 improvements.", quality_checks: [{ id: "structure", status: "passed" }, { id: "visual", status: "fixed" }] }), { status: 200 }));
  (globalThis as any).fetch = fetchMock;
  vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); vi.mocked(toast.info).mockClear();
});
afterEach(() => { document.body.innerHTML = ""; });

async function mount(props: Partial<React.ComponentProps<typeof SiteImprovementBar>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onReload = vi.fn(async () => {});
  const onRestoreVersion = vi.fn();
  await act(async () => {
    root.render(<SiteImprovementBar websiteId={SID} website={website()} pages={pages} previewKey={0} onReload={onReload} onRestoreVersion={onRestoreVersion} {...props} />);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return { container, onReload, onRestoreVersion };
}
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

describe("SiteImprovementBar", () => {
  it("shows the staged flow, structure and strict chips, and step 3 hint when stage is 'content'", async () => {
    const { container } = await mount();
    expect(Array.from(container.querySelectorAll("[data-stage]")).map((s) => s.getAttribute("data-state"))).toEqual(["done", "done", "active"]);
    expect(container.textContent).toContain("Full Business Site");
    expect(container.textContent).toContain("Strict");
    expect(container.textContent).toContain("Step 3 of 3");
  });

  it("marks all stages done once polished, and hides the stepper for sites that never used the staged flow", async () => {
    let r = await mount({ website: website({ generation_stage: "polished" }) });
    expect(Array.from(r.container.querySelectorAll("[data-stage]")).map((s) => s.getAttribute("data-state"))).toEqual(["done", "done", "done"]);
    document.body.innerHTML = "";
    r = await mount({ website: website({ generation_stage: null }) });
    expect(r.container.querySelector("[data-stage]")).toBeNull();
    expect(button("Make it more professional")).toBeDefined();
  });

  it("one click sends the professional-pass request for this site, reloads it, and opens the before/after comparison", async () => {
    const { onReload } = await mount();
    await act(async () => { button("Make it more professional")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/functions/v1/compile-website-manifest");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ improve: "professional", previousWebsiteId: SID });
    expect(typeof body.requestId).toBe("string");
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Professional pass applied 2 improvements.");
    expect(document.body.textContent).toContain("Before / after");
    expect(document.querySelector('[data-testid="compare-frames"]')).not.toBeNull();
  });

  it("disables the button while running and shows the live checks", async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => { finish = res; }));
    state.progress = { checks: [{ id: "structure", status: "fixed", detail: "corrected" }, { id: "visual", status: "checking" }] };
    const { container } = await mount();
    await act(async () => { button("Make it more professional")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(button("Making it more professional")!.disabled).toBe(true);
    expect(container.querySelector('[data-check="structure"]')!.getAttribute("data-status")).toBe("fixed");
    expect(container.querySelector('[data-check="visual"]')!.getAttribute("data-status")).toBe("checking");
    await act(async () => { finish(new Response(JSON.stringify({ improved: false, summary: "This site already meets the professional standard — nothing needed to change." }), { status: 200 })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.querySelector('[data-check="structure"]')).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("already meets the professional standard"));
    expect(document.querySelector('[data-testid="compare-frames"]')).toBeNull();
  });

  it("a server error is shown and nothing is reloaded or compared", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "AI credits exhausted for this workspace." }), { status: 402 }));
    const { onReload } = await mount();
    await act(async () => { button("Make it more professional")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(toast.error).toHaveBeenCalledWith("AI credits exhausted for this workspace.");
    expect(onReload).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="compare-frames"]')).toBeNull();
    expect(button("Make it more professional")!.disabled).toBe(false);
  });

  it("lists what the Generator fixed by itself (prefix stripped) and only those", async () => {
    const { container } = await mount({ website: website({ generation_notes: ["Content flagged: x", "Relevance Guard: Removed 1 customer testimonial(s).", "Visual fix: Adjusted the text colour."] }) });
    expect(button("Fixed automatically (2)")).toBeDefined();
    await act(async () => { button("Fixed automatically (2)")!.click(); });
    const items = Array.from(container.querySelectorAll('[data-testid="auto-fixes"] li')).map((l) => l.textContent);
    expect(items).toEqual(["• Removed 1 customer testimonial(s).", "• Adjusted the text colour."]);
  });

  it("Compare is disabled when no version exists yet", async () => {
    state.versions = [];
    await mount();
    expect(button("Compare")!.disabled).toBe(true);
  });

  it("restoring from the comparison hands the version to the dashboard's own (confirmed) restore flow", async () => {
    const { onRestoreVersion } = await mount();
    await act(async () => { button("Compare")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await act(async () => { button("Restore previous version")!.click(); });
    expect(onRestoreVersion).toHaveBeenCalledWith("v1");
  });

  it("toggle mode shows one frame at a time; side-by-side shows both", async () => {
    await mount();
    await act(async () => { button("Compare")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.querySelectorAll("[data-frame]").length).toBe(2);
    await act(async () => { button("Toggle")!.click(); });
    expect(document.querySelectorAll("[data-frame]").length).toBe(1);
    expect(document.querySelector("[data-frame]")!.getAttribute("data-frame")).toBe("after");
    await act(async () => { button("before")!.click(); });
    const iframe = document.querySelector("[data-frame='before'] iframe") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe(`/website-preview/${SID}?embed=1&page=home&version=v1`);
  });

  it("the diff lists what changed between the saved version and the current site", async () => {
    await mount();
    await act(async () => { button("Compare")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.querySelector('[data-testid="diff-lines"]')!.textContent).toContain("Home › hero: headline changed");
  });
});

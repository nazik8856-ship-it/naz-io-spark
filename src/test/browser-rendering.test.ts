// Safe input & output handling, front 4: what the browser renders and loads because a model, a tool or a customer wrote it.
//   1. The content security policy runs no eval, frames only places made to be embedded, posts forms only to the app, loads no plugins.
//   2. The embed and picture allowlists are the same in the browser, on the server and in the policy.
//   3. No code path evaluates text as code (no eval / new Function), and HTML is injected only in two reviewed places.
//   4. Every frame is sandboxed, or loads this app's own page (recorded with the reason).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EMBED_HOSTS, IMAGE_HOSTS, embedFrameSources, isAllowedEmbedUrl, isAllowedImageUrl } from "@/lib/safe-urls";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const csp = () => (JSON.parse(read("vercel.json")) as { headers: { source: string; headers: { key: string; value: string }[] }[] })
  .headers.find((h) => h.source === "/(.*)")!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
const directive = (name: string) => (csp().split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "").split(/\s+/).slice(1);

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    if (statSync(join(ROOT, p)).isDirectory()) return n === "test" ? [] : files(p);
    return /\.(tsx?|jsx?)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}
const SRC = files("src");
const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the content security policy", () => {
  it("runs no eval and no inline script", () => {
    const script = directive("script-src");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("'unsafe-inline'");
  });
  it("frames only the app itself and places made to be embedded (the same list as the browser and the server)", () => {
    const frame = directive("frame-src");
    expect(frame).not.toContain("https:");
    expect(frame).not.toContain("*");
    expect(new Set(frame)).toEqual(new Set(["'self'", ...embedFrameSources()]));
  });
  it("posts forms only to the app, loads no plugins, keeps the base address, can not be framed by others", () => {
    expect(directive("form-action")).toEqual(["'self'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(directive("base-uri")).toEqual(["'self'"]);
    expect(directive("frame-ancestors")).toEqual(["'self'"]);
  });
});

describe("one allowlist for embeds and pictures in the browser, on the server and in the policy", () => {
  const serverList = (file: string, name: string) => {
    const m = read(file).match(new RegExp(`export const ${name}: readonly string\\[\\] = \\[([\\s\\S]*?)\\];`));
    return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };
  it("embed hosts match supabase/functions/_shared/site-content-guard.ts", () => {
    expect([...EMBED_HOSTS].sort()).toEqual(serverList("supabase/functions/_shared/site-content-guard.ts", "EMBED_HOSTS").sort());
  });
  it("picture hosts match supabase/functions/_shared/output-guard.ts", () => {
    expect([...IMAGE_HOSTS].sort()).toEqual(serverList("supabase/functions/_shared/output-guard.ts", "DEFAULT_IMAGE_HOSTS").sort());
  });
});

describe("isAllowedEmbedUrl / isAllowedImageUrl", () => {
  const self = "https://nazai.net";
  it("embeds: https from listed hosts only, never this app, never with a login in the address", () => {
    for (const ok of ["https://www.youtube.com/embed/x", "https://player.vimeo.com/video/1", "https://form.typeform.com/to/a", "https://calendly.com/a/b"]) expect(isAllowedEmbedUrl(ok, self), ok).toBe(true);
    for (const bad of ["http://www.youtube.com/embed/x", "https://evil.example/", "https://youtube.com.evil.example/", "https://nazai.net/settings", "javascript:alert(1)", "data:text/html,x", "https://a:b@www.youtube.com/", "", null, "x".repeat(3000)]) expect(isAllowedEmbedUrl(bad, self), String(bad).slice(0, 40)).toBe(false);
    expect(isAllowedEmbedUrl("https://www.youtube.com/embed/x", "https://www.youtube.com")).toBe(false);
  });
  it("pictures: our own origin, a path, or https from our picture hosts", () => {
    for (const ok of ["/logo.png", "https://nazai.net/a.png", "https://abc.supabase.co/storage/v1/object/public/a.png", "https://images.unsplash.com/photo"]) expect(isAllowedImageUrl(ok, self), ok).toBe(true);
    for (const bad of ["https://evil.example/p.png?q=secret", "http://abc.supabase.co/a.png", "//evil.example/a.png", "data:image/svg+xml,x", "javascript:x", "", undefined]) expect(isAllowedImageUrl(bad, self), String(bad)).toBe(false);
  });
});

describe("no text is evaluated as code, and HTML is injected only where reviewed", () => {
  it.each(SRC)("%s has no eval / new Function", (f) => {
    expect(/\bnew Function\s*\(|(?<![\w.$])eval\s*\(/.test(code(read(f))), `${f} evaluates text as code`).toBe(false);
  });

  const HTML_INJECTION: Record<string, string> = {
    "src/components/ui/chart.tsx": "CSS variables built from the chart's own colour config (code, not content)",
    "src/components/chat/MermaidDiagram.tsx": "SVG rendered by mermaid with securityLevel 'strict' (no scripts, no HTML labels, no click handlers)",
  };
  it("dangerouslySetInnerHTML only in the reviewed places", () => {
    const using = SRC.filter((f) => /dangerouslySetInnerHTML/.test(code(read(f))));
    expect(using.sort()).toEqual(Object.keys(HTML_INJECTION).sort());
    expect(read("src/components/chat/MermaidDiagram.tsx")).toMatch(/securityLevel:\s*"strict"/);
  });
});

describe("every frame is sandboxed or loads the app's own page", () => {
  const OWN_PAGE_FRAMES: Record<string, string> = {
    "src/components/generator/BeforeAfterDialog.tsx": "loads /website-preview/... on this app (React renders the site; no stored HTML)",
    "src/pages/GeneratedDashboard.tsx": "loads /website-preview/... on this app (React renders the site; no stored HTML)",
  };
  it.each(SRC.filter((f) => /<iframe\b/.test(read(f))))("%s", (f) => {
    const src = code(read(f));
    const frames = [...src.matchAll(/<iframe\b[\s\S]*?\/?>/g)].map((m) => m[0]);
    for (const fr of frames) {
      const ok = /\bsandbox=/.test(fr) || f in OWN_PAGE_FRAMES;
      expect(ok, `${f}: an iframe without a sandbox: ${fr.slice(0, 120)}`).toBe(true);
    }
  });
  it("the website embed frame only shows allowlisted addresses", () => {
    expect(read("src/pages/WebsitePreview.tsx")).toContain("isAllowedEmbedUrl(embedUrl)");
    expect(read("src/lib/static-site-export.ts")).toContain("isAllowedEmbedUrl(");
  });
  it("markdown from a model renders pictures through the safe renderer", () => {
    expect(read("src/components/chat/RichMarkdown.tsx")).toContain("img: SafeMarkdownImage");
    expect(read("src/components/agents/LiveAgentChat.tsx")).toContain("img: SafeMarkdownImage");
  });
});

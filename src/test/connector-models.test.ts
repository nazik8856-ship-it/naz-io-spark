// Connecting an AI tool: the browser and the server agree on addresses (base stored, path added when calling), the catalogue
// stores base addresses with a vetted default, and the model choice follows the key's own list.
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { modelOptions, pickModel, sameToolAddress, toolBaseUrl, toolRequestUrl } from "@/lib/outer-control-tool-url";
import { FEATURED_TOOLS, featuredPayload } from "@/lib/outer-control-tools-ui";

const ROOT = join(__dirname, "../..");
const CASES: [string, string][] = [
  ["https://api.groq.com/openai/v1", "openai_chat"], ["https://api.groq.com/openai/v1/chat/completions", "openai_chat"],
  ["https://api.groq.com/openai/v1/", "openai_chat"], [" https://api.groq.com/openai/v1/models ", "openai_chat"],
  ["https://api.anthropic.com/v1/messages", "anthropic_messages"], ["https://api.deepseek.com", "openai_chat"],
  ["https://x.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21", "openai_chat"],
  ["https://hooks.example.com/run/chat/completions", "generic_json"], ["https://docs.example.com/mcp", "mcp"], ["not a url", "openai_chat"],
];

describe("addresses: the browser copy matches the server", () => {
  it("base and request address for every case", async () => {
    (globalThis as unknown as { Deno?: unknown }).Deno ??= { env: { get: () => undefined } };
    const server = await import(/* @vite-ignore */ join(ROOT, "supabase/functions/_shared/outer-control-tool-url.ts"));
    for (const [u, f] of CASES) {
      expect(toolBaseUrl(u, f), `${u} ${f}`).toBe(server.toolBaseUrl(u, f));
      expect(toolRequestUrl(u, f), `${u} ${f}`).toBe(server.toolRequestUrl(u, f));
    }
    expect(toolRequestUrl(CASES[6][0], "openai_chat")).toBe(CASES[6][0]); // the query string (api-version) is kept
  });

  it("an address saved in full before is the same tool as the base now", () => {
    expect(sameToolAddress("https://api.groq.com/openai/v1/chat/completions", "https://api.groq.com/openai/v1", "openai_chat")).toBe(true);
    expect(sameToolAddress("https://api.groq.com/openai/v1", "https://api.x.ai/v1", "openai_chat")).toBe(false);
  });
});

describe("the catalogue", () => {
  it("stores base addresses only, and every default is its own first suggestion", () => {
    for (const f of FEATURED_TOOLS) {
      expect(f.endpoint_url, f.id).not.toMatch(/\/(chat\/completions|messages)\/?$/);
      expect(toolBaseUrl(f.endpoint_url, f.request_format), f.id).toBe(f.endpoint_url);
      expect(f.models[0], f.id).toBe(f.model);
      expect(featuredPayload(f, " k ").endpoint_url, f.id).toBe(f.endpoint_url);
    }
  });

  it("Groq: base address, a free-tier friendly default, and no retired defaults anywhere", () => {
    const groq = FEATURED_TOOLS.find((f) => f.id === "groq")!;
    expect(groq.endpoint_url).toBe("https://api.groq.com/openai/v1");
    expect(toolRequestUrl(groq.endpoint_url, groq.request_format)).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(groq.model).toBe("openai/gpt-oss-20b");
    expect(groq.models).toEqual(["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);
    const retired = ["llama-3.3-70b-versatile", "gemini-2.0-flash", "grok-3", "command-r-plus", "accounts/fireworks/models/llama-v3p3-70b-instruct"];
    for (const f of FEATURED_TOOLS) for (const m of f.models) expect(retired, `${f.id}: ${m}`).not.toContain(m);
  });
});

describe("the model choice", () => {
  const SUGGESTED = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
  it("suggestions until a list is read; then the key's models, suggestions it can use first", () => {
    expect(modelOptions(SUGGESTED, null)).toEqual(SUGGESTED);
    expect(modelOptions(SUGGESTED, ["z-model", "openai/gpt-oss-120b"])).toEqual(["openai/gpt-oss-120b", "z-model"]);
  });
  it("keeps a usable choice; otherwise the first usable suggestion; otherwise the first listed", () => {
    expect(pickModel("openai/gpt-oss-20b", SUGGESTED, null)).toBe("openai/gpt-oss-20b");
    expect(pickModel("openai/gpt-oss-20b", SUGGESTED, ["openai/gpt-oss-20b", "x"])).toBe("openai/gpt-oss-20b");
    expect(pickModel("openai/gpt-oss-20b", SUGGESTED, ["x", "qwen/qwen3.8-27b"])).toBe("qwen/qwen3.8-27b");
    expect(pickModel("gone", SUGGESTED, ["b", "a"])).toBe("b");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { detectMentions, namedButNotChosen, type MentionTool } from "@/lib/outer-control-mentions";

const BOT2: MentionTool = { id: "b", name: "Bot2", endpoint_url: "https://ekuo.supabase.co/functions/v1/bot2" };
const GPT: MentionTool = { id: "g", name: "ChatGPT (OpenAI)", model: "gpt-4o", endpoint_url: "https://api.openai.com/v1/chat/completions" };
const CLAUDE: MentionTool = { id: "c", name: "My assistant", model: "claude-sonnet", endpoint_url: "https://api.anthropic.com/v1/messages" };
const WRITER: MentionTool = { id: "w", name: "NazAI report writer", endpoint_url: "nazai-internal://report" };
const tools = [BOT2, GPT, CLAUDE, WRITER];
const ids = (text: string, ts = tools) => detectMentions(text, ts).mentions.map((m) => m.tool.id);

describe("the page and the edge functions share one copy of the mention logic", () => {
  it("outer-control-mentions.ts is identical in src/lib and supabase/functions/_shared", () => {
    expect(readFileSync("supabase/functions/_shared/outer-control-mentions.ts", "utf8")).toBe(readFileSync("src/lib/outer-control-mentions.ts", "utf8"));
  });
});

describe("detectMentions", () => {
  it("finds a tool by the name without its bracketed part, any case", () => {
    expect(ids("Collaborate with connected ChatGPT and generate a simple report about NazAI")).toEqual(["g"]);
    expect(ids("ask chatgpt")).toEqual(["g"]);
  });
  it("finds a tool by a product word its model or endpoint belongs to", () => {
    expect(ids("what does OpenAI think?")).toEqual(["g"]);
    expect(ids("ask GPT-4o")).toEqual(["g"]);
    expect(ids("let Claude check it")).toEqual(["c"]);
  });
  it("finds a tool by its own plain name", () => {
    expect(ids("send this to bot2 please")).toEqual(["b"]);
  });
  it("matches whole words only", () => {
    expect(ids("a robot2 and a chatgptx")).toEqual([]);
    expect(ids("the ungpt thing")).toEqual([]);
  });
  it("keeps the order things are named in and names each tool once", () => {
    expect(ids("ask Claude, then ChatGPT, then Claude again and Bot2")).toEqual(["c", "g", "b"]);
  });
  it("finds nothing when no tool is named", () => {
    expect(detectMentions("write a short summary of our pricing", tools)).toEqual({ mentions: [], ambiguous: [], notConnected: [] });
  });
  it("never matches the internal report writer", () => {
    expect(ids("use the NazAI report writer")).toEqual([]);
  });
  it("says a word is ambiguous when it fits two tools, and settles it when one is named by its own name", () => {
    const azure: MentionTool = { id: "a", name: "ChatGPT (Azure)", endpoint_url: "https://x.openai.azure.com" };
    const r = detectMentions("ask ChatGPT", [GPT, azure]);
    expect(r.mentions).toEqual([]);
    expect(r.ambiguous[0].tools.map((t) => t.id).sort()).toEqual(["a", "g"]);
    const work: MentionTool = { id: "w2", name: "Work GPT", endpoint_url: "https://api.openai.com" };
    const s = detectMentions("ask Work GPT", [GPT, work]);
    expect(s.mentions.map((m) => m.tool.id)).toEqual(["w2"]);
    expect(s.ambiguous).toEqual([]);
  });
  it("reports a well-known product that is named but not connected", () => {
    const r = detectMentions("ask Gemini and ChatGPT", tools);
    expect(r.mentions.map((m) => m.tool.id)).toEqual(["g"]);
    expect(r.notConnected.map((n) => n.brand)).toEqual(["Gemini"]);
  });
});

describe("namedButNotChosen", () => {
  it("lists the named tools that were not chosen, in the order named", () => {
    const found = detectMentions("Collaborate with ChatGPT and Claude", tools);
    expect(namedButNotChosen(found, ["b"]).missing.map((t) => t.id)).toEqual(["g", "c"]);
    expect(namedButNotChosen(found, ["g", "c"]).missing).toEqual([]);
  });
});

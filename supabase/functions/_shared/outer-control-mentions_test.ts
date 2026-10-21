// The guard outer-control-drive runs before start_session / start_goal / start_report: a named tool must be among the chosen ones.
import { detectMentions, namedButNotChosen } from "./outer-control-mentions.ts";

function eq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const tools = [
  { id: "b", name: "Bot2", model: null, endpoint_url: "https://x.supabase.co/functions/v1/bot2" },
  { id: "g", name: "ChatGPT (OpenAI)", model: "gpt-4o", endpoint_url: "https://api.openai.com/v1/chat/completions" },
  { id: "w", name: "NazAI report writer", model: null, endpoint_url: "nazai-internal://report" },
];

Deno.test("the reported case is refused: Bot2 chosen, ChatGPT named", () => {
  const r = namedButNotChosen(detectMentions("Collaborate with connected ChatGPT and generate a simple report about NazAI", tools), ["b"]);
  eq(r.missing.map((t) => t.id), ["g"]);
});

Deno.test("nothing to refuse when the named tool is the chosen one, or when no tool is named", () => {
  eq(namedButNotChosen(detectMentions("ask chatgpt", tools), ["g"]).missing, []);
  eq(namedButNotChosen(detectMentions("write a summary", tools), ["b"]).missing, []);
});

Deno.test("the internal report writer is never a named tool", () => {
  eq(detectMentions("use the NazAI report writer", tools).mentions, []);
});

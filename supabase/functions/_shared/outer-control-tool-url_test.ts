// Run with: deno test --no-check supabase/functions/_shared/outer-control-tool-url_test.ts
// Connecting an AI tool: the base address is stored, the call path is added when calling, the Test says exactly what it called,
// and the model list is read from the provider for the key.
import { chatModelIds, isModelProblem, providerMessage, toolBaseUrl, toolModelsUrl, toolRequestUrl } from "./outer-control-tool-url.ts";
import { describeToolFailure, runConnectionTest } from "./outer-control-tool-test.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const GROQ = "https://api.groq.com/openai/v1";

Deno.test("only the base is stored; a pasted full path, trailing slash or /models is taken off", () => {
  eq(toolBaseUrl(`${GROQ}/chat/completions`, "openai_chat"), GROQ, "full path");
  eq(toolBaseUrl(`${GROQ}/`, "openai_chat"), GROQ, "trailing slash");
  eq(toolBaseUrl(` ${GROQ}/models `, "openai_chat"), GROQ, "models path and spaces");
  eq(toolBaseUrl("https://api.anthropic.com/v1/messages", "anthropic_messages"), "https://api.anthropic.com/v1", "anthropic");
  eq(toolBaseUrl("https://api.deepseek.com", "openai_chat"), "https://api.deepseek.com", "a bare host stays");
  eq(toolBaseUrl("https://hooks.example.com/run/chat/completions", "generic_json"), "https://hooks.example.com/run/chat/completions", "other formats as given");
  eq(toolBaseUrl("https://example.com/mcp", "mcp"), "https://example.com/mcp", "mcp as given");
});

Deno.test("the call goes to base + path, never with the path twice; the model list to base + /models", () => {
  eq(toolRequestUrl(GROQ, "openai_chat"), `${GROQ}/chat/completions`, "groq base");
  eq(toolRequestUrl(`${GROQ}/chat/completions`, "openai_chat"), `${GROQ}/chat/completions`, "an address stored before: unchanged");
  eq(toolRequestUrl("https://generativelanguage.googleapis.com/v1beta/openai", "openai_chat"), "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini");
  eq(toolRequestUrl("https://api.anthropic.com/v1", "anthropic_messages"), "https://api.anthropic.com/v1/messages", "anthropic");
  eq(toolRequestUrl("https://hooks.example.com/run", "generic_json"), "https://hooks.example.com/run", "generic as given");
  eq(toolModelsUrl(`${GROQ}/chat/completions`, "openai_chat"), `${GROQ}/models`, "models");
  eq(toolModelsUrl("https://hooks.example.com/run", "generic_json"), null, "no list for generic");
});

Deno.test("the model list keeps chat models only (Groq-like and Gemini-like lists)", () => {
  const groq = { data: [
    { id: "openai/gpt-oss-20b", active: true }, { id: "openai/gpt-oss-120b" }, { id: "qwen/qwen3.8-27b" },
    { id: "whisper-large-v3" }, { id: "playai-tts" }, { id: "meta-llama/llama-guard-4-12b" }, { id: "old-model", active: false },
  ] };
  eq(chatModelIds(groq), ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"], "groq");
  eq(chatModelIds({ data: [{ id: "models/gemini-3.5-flash" }, { id: "models/text-embedding-004" }] }), ["gemini-3.5-flash"], "gemini prefix and embeddings");
  eq(chatModelIds({ nope: 1 }), [], "not a list");
  eq(chatModelIds({ data: [{ id: "<script>" }, { id: "a b" }] }), [], "odd ids dropped");
});

Deno.test("a failed test says what it means, the exact address and status, and the provider's own words", () => {
  const groq404 = JSON.stringify({ error: { message: "The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.", type: "invalid_request_error", code: "model_not_found" } });
  assert(isModelProblem(404, providerMessage(groq404)), "a 404 about the model is a model problem");
  const t = describeToolFailure({ status: 404, url: `${GROQ}/chat/completions`, model: "llama-3.3-70b-versatile", bodyText: groq404 });
  assert(t.startsWith('The model "llama-3.3-70b-versatile" is not available for this key'), t);
  assert(t.includes(`Called: POST ${GROQ}/chat/completions → HTTP 404.`), t);
  assert(t.includes("does not exist or you do not have access to it"), t);
  const wrong = describeToolFailure({ status: 404, url: `${GROQ}/chat/completions/chat/completions`, model: "x", bodyText: "<html><body>Not Found</body></html>" });
  assert(wrong.startsWith("Nothing answers at that address (HTTP 404)") && wrong.includes("HTTP 404."), wrong);
  assert(!/<html|<body/.test(wrong), "no raw HTML");
  const key = describeToolFailure({ status: 401, url: `${GROQ}/chat/completions?key=abc123`, model: "m", bodyText: JSON.stringify({ error: { message: "Invalid API Key", code: "invalid_api_key" } }) });
  assert(key.includes("rejected the key") && key.includes('"Invalid API Key"') && !key.includes("abc123"), key);
});

Deno.test("Test posts to base + /chat/completions with the key, and a 404 model reply is reported as a model problem", async () => {
  const calls: { url: string; auth: string | null; model: unknown }[] = [];
  const admin = { rpc: async () => ({ data: { token: "gsk_test_key" }, error: null }) };
  const tool = { id: "t", name: "Groq", endpoint_url: GROQ, request_format: "openai_chat", model: "openai/gpt-oss-20b", auth_header: "Authorization", auth_scheme: "Bearer ", credentials_secret_id: "s", last_ok_at: null };
  let reply: Response = new Response(JSON.stringify({ choices: [{ message: { content: '{"status":"done","answer":"ok"}' } }] }), { status: 200 });
  const deps = {
    fetchImpl: (async (u: string, init: RequestInit) => { calls.push({ url: u, auth: new Headers(init.headers).get("Authorization"), model: JSON.parse(String(init.body)).model }); return reply; }) as unknown as typeof fetch,
    validateUrl: async () => ({ ok: true as const }), now: () => 0, timeoutMs: 1000,
  };
  const ok = await runConnectionTest(admin, tool, deps);
  assert(ok.ok, `works: ${ok.error}`);
  eq(calls[0], { url: `${GROQ}/chat/completions`, auth: "Bearer gsk_test_key", model: "openai/gpt-oss-20b" }, "the request");
  reply = new Response(JSON.stringify({ error: { message: "The model `openai/gpt-oss-20b` does not exist or you do not have access to it.", code: "model_not_found" } }), { status: 404 });
  const bad = await runConnectionTest(admin, tool, deps);
  assert(!bad.ok && /is not available for this key/.test(bad.error ?? "") && (bad.error ?? "").includes(`POST ${GROQ}/chat/completions → HTTP 404`), bad.error ?? "");
});

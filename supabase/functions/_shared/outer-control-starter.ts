// First-value onboarding: "NazAI does it for me". A new account can run its first controlled Tasks without connecting an AI of
// its own: three starter tools answer with NazAI's own AI, each from a different angle, so a Task still has several replies to
// check and one clean result. They are internal tools (an address NazAI never fetches), and each account gets them for its
// first STARTER_TASKS Tasks only: a session of a later Task is stopped before anything is asked, with a plain reason.
import { callAiGateway, pickAiGateway } from "./ai-gateway.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export const STARTER_TOOL_URL = "nazai-internal://starter/";
export const STARTER_TASKS = 2;

export const STARTER_TOOLS = [
  {
    key: "writer", name: "NazAI Writer",
    system: "You are a clear, practical writer. Answer the request directly and usefully, in plain language, with a concrete example where it helps.",
  },
  {
    key: "analyst", name: "NazAI Analyst",
    system: "You are a careful analyst. Answer the request with the key facts, numbers and trade-offs, and say plainly what you are not sure about.",
  },
  {
    key: "reviewer", name: "NazAI Reviewer",
    system: "You are a sceptical reviewer. Answer the request, then point out risks, common mistakes and what is often missed.",
  },
] as const;

export const isStarterUrl = (url: unknown): boolean => typeof url === "string" && url.startsWith(STARTER_TOOL_URL);
export const starterKeyOf = (url: string): string => url.slice(STARTER_TOOL_URL.length);

export const STARTER_USED_UP =
  `Your ${STARTER_TASKS} free NazAI tasks are used. Connect your own AI (ChatGPT, Claude or another) to keep going.`;

/** The account's starter tools, created on first use (an existing one is kept). */
export async function ensureStarterTools(admin: AnyAdmin, accountId: string, maxTools: number):
  Promise<{ ok: true; tools: { id: string; name: string }[] } | { ok: false; code: string; message: string; status: number }> {
  const { data: existing } = await admin.from("external_tools").select("id, name, endpoint_url").eq("user_id", accountId).like("endpoint_url", `${STARTER_TOOL_URL}%`).is("removed_at", null);
  const have = new Map(((existing ?? []) as { id: string; name: string; endpoint_url: string }[]).map((t) => [starterKeyOf(t.endpoint_url), t]));
  const missing = STARTER_TOOLS.filter((t) => !have.has(t.key));
  if (missing.length) {
    const { count } = await admin.from("external_tools").select("id", { count: "exact", head: true }).eq("user_id", accountId).is("removed_at", null);
    if ((count ?? 0) + missing.length > maxTools) return { ok: false, code: "too_many_tools", message: `An account can connect at most ${maxTools} tools.`, status: 409 };
    const now = new Date().toISOString();
    const { data: made, error } = await admin.from("external_tools").insert(missing.map((t) => ({
      user_id: accountId, name: t.name, endpoint_url: `${STARTER_TOOL_URL}${t.key}`, request_format: "generic_json",
      approved_at: now, last_ok_at: now, last_checked_at: now, enabled: true,
    }))).select("id, name, endpoint_url");
    if (error || !made) return { ok: false, code: "internal_error", message: "Could not set up NazAI's starter AI.", status: 500 };
    for (const t of made as { id: string; name: string; endpoint_url: string }[]) have.set(starterKeyOf(t.endpoint_url), t);
  }
  return { ok: true, tools: STARTER_TOOLS.map((t) => have.get(t.key)!).filter(Boolean).map((t) => ({ id: t.id, name: t.name })) };
}

/** The Tasks that used starter tools, oldest first: a session belongs to its Task, or stands alone. */
export function starterTaskKeys(rows: { id: string; workflow_id: string | null; started_at: string | null }[]): string[] {
  const sorted = [...rows].sort((a, b) => String(a.started_at ?? "").localeCompare(String(b.started_at ?? "")) || a.id.localeCompare(b.id));
  const keys: string[] = [];
  for (const r of sorted) { const k = r.workflow_id ?? r.id; if (!keys.includes(k)) keys.push(k); }
  return keys;
}

/** Whether this session's Task is one of the account's first STARTER_TASKS Tasks with starter tools. */
export async function starterAllowed(admin: AnyAdmin, s: { id: string; user_id: string; workflow_id: string | null }): Promise<boolean> {
  const { data: tools } = await admin.from("external_tools").select("id").eq("user_id", s.user_id).like("endpoint_url", `${STARTER_TOOL_URL}%`);
  const ids = ((tools ?? []) as { id: string }[]).map((t) => t.id);
  if (!ids.length) return false;
  const { data: rows } = await admin.from("outer_control_sessions").select("id, workflow_id, started_at").eq("user_id", s.user_id).in("tool_id", ids);
  const keys = starterTaskKeys((rows ?? []) as { id: string; workflow_id: string | null; started_at: string | null }[]);
  return keys.slice(0, STARTER_TASKS).includes(s.workflow_id ?? s.id);
}

/** How many of the free Tasks the account has used (for the page). */
export async function starterTasksUsed(admin: AnyAdmin, accountId: string): Promise<number> {
  const { data: tools } = await admin.from("external_tools").select("id").eq("user_id", accountId).like("endpoint_url", `${STARTER_TOOL_URL}%`);
  const ids = ((tools ?? []) as { id: string }[]).map((t) => t.id);
  if (!ids.length) return 0;
  const { data: rows } = await admin.from("outer_control_sessions").select("id, workflow_id, started_at").eq("user_id", accountId).in("tool_id", ids);
  return Math.min(STARTER_TASKS, starterTaskKeys((rows ?? []) as { id: string; workflow_id: string | null; started_at: string | null }[]).length);
}

export type StarterAi = (system: string, user: string) => Promise<string | null>;

/** The production AI: NazAI's own gateway, a plain-text answer. Null when it is not configured or does not answer. */
export const gatewayStarterAi: StarterAi = async (system, user) => {
  const cfg = pickAiGateway();
  if (!cfg) return null;
  try {
    const res = await callAiGateway({
      model: cfg.model, temperature: 0.6,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }, cfg, AbortSignal.timeout(60_000));
    if (!res.ok) return null;
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text : null;
  } catch { return null; }
};

/** One starter tool's answer to the step's instruction (which already carries the request, its context and the rules). */
export async function askStarter(ai: StarterAi, url: string, instruction: string): Promise<string | null> {
  const tool = STARTER_TOOLS.find((t) => t.key === starterKeyOf(url));
  if (!tool) return null;
  return await ai(`${tool.system} Follow every rule you are given. Keep the answer under 400 words.`, instruction.slice(0, 12_000));
}

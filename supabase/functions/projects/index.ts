// projects — imported projects (see _shared/projects.ts for what each action does).
//
//   POST { action: "import_paste", text, name? }
//   POST { action: "import_files", files: [{ name, text }], name? }        (text files only, at most 20, 200,000 characters in all)
//   POST { action: "import_link", url, name? }                             (a public https page, or a public GitHub repository)
//   POST { action: "notion_search", query }                                (pages of the connected Notion workspace)
//   POST { action: "import_notion", page_id, name? }                       (linked to the original page)
//   POST { action: "refresh", project_id }                                 (a linked project, read again from its source)
//   POST { action: "rename", project_id, name }
//   POST { action: "archive", project_id, archived? }
//   POST { action: "set_write_back", project_id, enabled, confirm_name? }  (linked only; turning it on needs the project's name typed)
//   POST { action: "write_back", project_id, text }                        (creates an approval; nothing is written before it is approved)
//   POST { action: "add_rule", project_id, name, words, rule_action: "remove" | "block" | "approval" }
//   POST { action: "remove_rule", project_id, rule_id }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAccountScope } from "../_shared/account-scope.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { validateOutboundUrl } from "../_shared/url-safety.ts";
import { readSecret } from "../_shared/integration-secrets.ts";
import { handleProjectsAction, MAX_LINK_BYTES, type FetchedPage, type ProjectDeps } from "../_shared/projects.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RATE_LIMIT_PER_MINUTE = 30;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** A public page: every redirect is checked again (a redirect can not lead to a private address), the body is capped. */
async function fetchUrl(url: string): Promise<FetchedPage> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const allowed = await validateOutboundUrl(current);
    if (!allowed.ok) return { ok: false, status: 0, contentType: "", text: "", finalUrl: current, error: `That link leads to an address that is not allowed (${allowed.reason}).` };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(current, { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": "NazAI-Import/1.0", Accept: "text/html,text/plain,application/json,text/*;q=0.9" } });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        current = new URL(r.headers.get("location")!, current).toString();
        await r.body?.cancel();
        continue;
      }
      const contentType = r.headers.get("content-type") ?? "";
      const reader = r.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_LINK_BYTES) { await reader.cancel(); return { ok: false, status: r.status, contentType, text: "", finalUrl: current, error: `That page is larger than ${MAX_LINK_BYTES / 1_000_000} MB.` }; }
          chunks.push(value);
        }
      }
      const buf = new Uint8Array(size);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
      return { ok: r.ok, status: r.status, contentType, text: new TextDecoder().decode(buf), finalUrl: current, error: r.ok ? undefined : `The page answered HTTP ${r.status}.` };
    } catch (e) {
      return { ok: false, status: 0, contentType: "", text: "", finalUrl: current, error: (e as Error)?.name === "AbortError" ? "The page did not answer within 10 seconds." : "The page could not be reached." };
    } finally { clearTimeout(timer); }
  }
  return { ok: false, status: 0, contentType: "", text: "", finalUrl: current, error: "Too many redirects." };
}

// deno-lint-ignore no-explicit-any
const notion: ProjectDeps["notion"] = async (admin: any, accountId, path, init) => {
  const { data } = await admin.from("agent_integrations").select("id, credentials_secret_id, agent_id").eq("user_id", accountId).eq("provider", "Notion").eq("status", "connected");
  const rows = (data ?? []) as { id: string; credentials_secret_id: string | null; agent_id: string | null }[];
  const row = rows.find((r) => !r.agent_id) ?? rows[0];
  const token = row ? ((await readSecret(admin, row.credentials_secret_id)).access_token as string | undefined) : undefined;
  if (!token) return { ok: false, status: 0, json: null, connected: false };
  try {
    const r = await fetch(`https://api.notion.com${path}`, {
      method: init?.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => null), connected: true };
  } catch {
    return { ok: false, status: 0, json: { message: "Notion could not be reached" }, connected: true };
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "invalid_json", message: "The request body must be a JSON object." }, 400);
    const accountId = await resolveAccountScope(userClient, userData.user.id, body.account_id, "integrations");
    if (!accountId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);
    const rate = await checkRateLimit(admin, accountId, "projects", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) return json({ error: "rate_limited", message: "Too many requests. Try again shortly." }, 429);

    const r = await handleProjectsAction(admin, accountId, userData.user.id, body as Record<string, unknown>, { fetchUrl, checkUrl: validateOutboundUrl, notion, now: Date.now });
    return json(r.body, r.status);
  } catch (e) {
    console.error("projects failed:", e instanceof Error ? e.message : e);
    return json({ error: "internal_error", message: "Something went wrong. Nothing was changed." }, 500);
  }
});

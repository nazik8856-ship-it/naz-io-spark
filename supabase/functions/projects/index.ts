// projects — imported projects (see _shared/projects.ts for what each action does).
//
//   POST { action: "import_paste", text, name? }
//   POST { action: "import_files", files: [{ name, text }], name? }        (text files only, at most 20, 200,000 characters in all)
//   POST { action: "import_link", url, name?, github_token? }              (a public https page; a GitHub repository, private with a
//                                                                          token used once and never stored; a Google Docs, Sheets,
//                                                                          Slides or Drive file shared with "Anyone with the link")
//   POST { action: "notion_search", query }                                (pages of the connected Notion workspace)
//   POST { action: "import_notion", page_id, name? }                       (linked to the original page)
//   POST { action: "refresh", project_id }                                 (a linked project, read again from its source)
//   POST { action: "rename", project_id, name }
//   POST { action: "archive", project_id, archived? }
//   POST { action: "delete", project_id, confirm_name }                    (permanent: the project, its text and its rules)
//   POST { action: "read", project_id }                                    (the decrypted text; any team member may read)
//   POST { action: "set_write_back", project_id, enabled, confirm_name? }  (linked only; turning it on needs the project's name typed)
//   POST { action: "write_back", project_id, text }                        (creates an approval; nothing is written before it is approved)
//   POST { action: "add_rule", project_id, name, words, rule_action: "remove" | "block" | "approval" }
//   POST { action: "remove_rule", project_id, rule_id, kind? }
//   POST { action: "test_rule", project_id, kind?, words | description, rule_action }  (tried on recent replies; nothing saved)
//
// Project text is encrypted with PROJECTS_KEY (32 random bytes, base64), which only the edge functions have. Without it nothing
// new is stored. Everything but "read" needs the owner of the account (or an owner-role team member with the integrations
// permission); "read" is open to every active team member.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient } from "../_shared/encrypted-client.ts"; // encrypts Outer Control content (data encryption, front 3)
import { resolveAccountScope } from "../_shared/account-scope.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { validateOutboundUrl } from "../_shared/url-safety.ts";
import { readSecret } from "../_shared/integration-secrets.ts";
import { handleProjectsAction, IMPORT_ACTIONS, linkShapeProblem, MAX_LINK_BYTES, READ_ACTIONS, type FetchedPage, type ProjectDeps } from "../_shared/projects.ts";
import { MIN_PASSPHRASE_CHARS, projectKeysFromEnv } from "../_shared/project-crypto.ts";
import { dataKeysFromEnv } from "../_shared/field-crypto.ts";
import { optionalSecret, requireSecret } from "../_shared/require-secret.ts";
import { gatewayAi } from "../_shared/outer-control-report.ts";
import { requireCaller } from "../_shared/caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RATE_LIMIT_PER_MINUTE = 30;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
/** A request body larger than this is refused before it is read (200,000 characters of text, JSON-escaped, fit well within it). */
const MAX_BODY_BYTES = 2_000_000;
const IMPORTS_PER_DAY = 50;

// Without its key this function can not store or read anything: a missing, misnamed or too short key stops it at startup, by name.
requireSecret("PROJECTS_KEY", { minLength: MIN_PASSPHRASE_CHARS });
optionalSecret("PROJECTS_KEY_PREVIOUS", { minLength: MIN_PASSPHRASE_CHARS });
const keyPromise = projectKeysFromEnv();
// DATA_KEY makes each project's fingerprint keyed, so it can not be used to guess the encrypted text.
requireSecret("DATA_KEY", { minLength: MIN_PASSPHRASE_CHARS });
optionalSecret("DATA_KEY_PREVIOUS", { minLength: MIN_PASSPHRASE_CHARS });
const dataKeyPromise = dataKeysFromEnv();

/** Every hop of a link: the shape (https, port 443, a site name, no login in the link) and then its addresses. */
async function checkLink(url: string): Promise<{ ok: boolean; reason: string }> {
  const shape = linkShapeProblem(url);
  if (shape) return { ok: false, reason: shape };
  return await validateOutboundUrl(url);
}

/**
 * A public page: every redirect is checked again (a redirect can not lead to a private address), the body is capped, and the
 * address is looked up again after the fetch: a name that now points somewhere private is not trusted. A name that changes its
 * address between the check and the fetch itself (DNS rebinding) can not be fully ruled out without pinning the connection.
 */
async function fetchUrl(url: string): Promise<FetchedPage> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const allowed = await checkLink(current);
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
      const after = await validateOutboundUrl(current);
      if (!after.ok) return { ok: false, status: 0, contentType: "", text: "", finalUrl: current, error: `That link leads to an address that is not allowed (${after.reason}).` };
      return { ok: r.ok, status: r.status, contentType, text: new TextDecoder().decode(buf), finalUrl: current, error: r.ok ? undefined : `The page answered HTTP ${r.status}.` };
    } catch (e) {
      return { ok: false, status: 0, contentType: "", text: "", finalUrl: current, error: (e as Error)?.name === "AbortError" ? "The page did not answer within 10 seconds." : "The page could not be reached." };
    } finally { clearTimeout(timer); }
  }
  return { ok: false, status: 0, contentType: "", text: "", finalUrl: current, error: "Too many redirects." };
}

/** The GitHub API with a token given for one private import: only api.github.com, 10 seconds, 2 MB, the token never logged. */
const github: ProjectDeps["github"] = async (path, token, raw) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.github.com${path}`, {
      signal: ctl.signal, redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "NazAI-Import/1.0" },
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text: text.length > MAX_LINK_BYTES ? text.slice(0, MAX_LINK_BYTES) : text };
  } catch {
    return { ok: false, status: 0, text: "" };
  } finally { clearTimeout(timer); }
};

// deno-lint-ignore no-explicit-any
const notion: ProjectDeps["notion"] =async (admin: any, accountId, path, init) => {
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

/** The account to read from: the caller's own, or one they are an active member of (any role). */
// deno-lint-ignore no-explicit-any
async function readScope(userClient: any, callerId: string, requested: unknown): Promise<string | null> {
  if (typeof requested !== "string" || !requested || requested === callerId) return callerId;
  const { data, error } = await userClient.rpc("is_account_member", { _account_owner_id: requested, _min_role: "viewer", _permission: null });
  return error || !data ? null : requested;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authed = await requireCaller(req, (h) => createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: h } } }));
    if (!authed.ok) return json({ error: "unauthorized" }, 401);
    const userClient = authed.caller.userClient;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "too_large", message: "That is too much to import at once. Nothing was stored." }, 413);
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large", message: "That is too much to import at once. Nothing was stored." }, 413);
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(raw); } catch { body = null; }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_json", message: "The request body must be a JSON object." }, 400);
    const action = String(body.action ?? "");
    // Reading is for every team member; everything else needs an owner.
    const accountId = READ_ACTIONS.has(action)
      ? await readScope(userClient, authed.caller.userId, body.account_id)
      : await resolveAccountScope(userClient, authed.caller.userId, body.account_id, "integrations");
    if (!accountId) return json({ error: "forbidden", message: READ_ACTIONS.has(action) ? "You are not a member of that account." : "View only: only an owner of this account can change its projects." }, 403);
    const rate = await checkRateLimit(admin, accountId, "projects", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) return json({ error: "rate_limited", message: "Too many requests. Try again shortly." }, 429);
    if (IMPORT_ACTIONS.has(action)) {
      const daily = await checkRateLimit(admin, accountId, "projects_import", IMPORTS_PER_DAY, 86_400);
      if (!daily.allowed) return json({ error: "import_quota", message: `At most ${IMPORTS_PER_DAY} imports a day. Try again tomorrow.` }, 429);
    }

    const r = await handleProjectsAction(admin, accountId, authed.caller.userId, body, { fetchUrl, checkUrl: checkLink, notion, now: Date.now, key: await keyPromise, fingerprintKeys: await dataKeyPromise, judge: gatewayAi, github });
    return json(r.body, r.status);
  } catch (e) {
    console.error("projects failed:", e instanceof Error ? e.message : e);
    return json({ error: "internal_error", message: "Something went wrong. Nothing was changed." }, 500);
  }
});

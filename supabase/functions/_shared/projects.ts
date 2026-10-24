// Imported projects: bring an external project into NazAI, as a one-time copy (snapshot: a link, uploaded text files or pasted
// text) or linked to its original (a Notion page from a connected Notion workspace). Once imported it is a NazAI project: its
// content is checked against the account's rules, it can have rules of its own (project_rules, which apply only to it), Outer
// Control Tasks can use it, and NazAI writes to the original only when the owner turned write-back on, every write waiting for an
// approval. The projects edge function is a thin wrapper around handleProjectsAction; the outside world (fetching a link, Notion)
// comes in through ProjectDeps so the whole flow is testable.
import { loadSafetyRules, scanWithRules, type SafetyRule } from "./safety-scanner.ts";
import { isRedactableMatch } from "./outer-control-scoring.ts";
import { textSafeToStore } from "./outer-control-text-review.ts";
import { sha256Hex } from "./api-key-auth.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export const MAX_PROJECT_CHARS = 200_000;
export const MAX_PROJECT_FILES = 20;
export const MAX_LINK_BYTES = 2_000_000;
export const MAX_RULES_PER_PROJECT = 20;
export const MAX_WRITE_BACK_CHARS = 20_000;
/** How much of a project's text goes to the tools of an Outer Control Task. */
export const PROJECT_CONTEXT_CHARS = 6_000;

const TEXT_EXT = ["md", "markdown", "txt", "text", "html", "htm", "json", "csv", "tsv", "xml", "yaml", "yml", "js", "jsx", "ts", "tsx", "py", "rb", "go", "java", "kt", "rs", "c", "h", "cpp", "cs", "php", "sql", "sh", "css", "scss", "toml", "ini", "env.example"];
const CODE_EXT = new Set(["js", "jsx", "ts", "tsx", "py", "rb", "go", "java", "kt", "rs", "c", "h", "cpp", "cs", "php", "sql", "sh", "css", "scss", "json", "yaml", "yml", "toml", "xml", "ini"]);

export type ContentType = "text" | "markdown" | "html" | "code" | "mixed";
export type ProjectFile = { name: string; chars: number };
export type CheckMatch = { name: string; action: "remove_text" | "block" | "approval" };
export type ProjectCheck = { at: string; rules: number; matches: CheckMatch[] };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
export const extOf = (name: string) => {
  const n = name.toLowerCase();
  if (n.endsWith(".env.example")) return "env.example";
  const i = n.lastIndexOf(".");
  return i < 0 ? "" : n.slice(i + 1);
};
export const isTextFile = (name: string) => TEXT_EXT.includes(extOf(name));

/** A project name: trimmed, one line, at most 120 characters; the fallback when nothing is left. */
export function cleanName(v: unknown, fallback: string): string {
  const s = (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim();
  const f = fallback.replace(/\s+/g, " ").trim();
  return clip(s || f || "Imported project", 120);
}

/** The first line of a text as a name (without markdown marks). */
export const firstLine = (text: string) => (text.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "").slice(0, 120);

function typeOfText(text: string): ContentType {
  if (/<(html|body|div|p|h1|head)[\s>]/i.test(text)) return "html";
  if (/^#{1,6} \S/m.test(text) || /^\s*[-*] \S/m.test(text) || /\[[^\]]+\]\([^)]+\)/.test(text)) return "markdown";
  return "text";
}
function typeOfFile(name: string, text: string): ContentType {
  const e = extOf(name);
  if (e === "md" || e === "markdown") return "markdown";
  if (e === "html" || e === "htm") return "html";
  if (CODE_EXT.has(e)) return "code";
  return typeOfText(text);
}

/** What kind of content a project is. Several files of different kinds are "mixed". */
export function contentTypeOf(input: { text?: string; files?: { name: string; text: string }[] }): ContentType {
  if (input.files?.length) {
    const kinds = [...new Set(input.files.map((f) => typeOfFile(f.name, f.text)))];
    return kinds.length === 1 ? kinds[0] : "mixed";
  }
  return typeOfText(input.text ?? "");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ENTITIES[k] ?? m;
});

/** An HTML page as readable text: scripts and styles dropped, headings kept as "#" lines, list items as "- ". Never rendered. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim());
  let t = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, "");
  t = t.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, inner: string) => `\n\n${"#".repeat(Number(n))} ${inner.replace(/<[^>]+>/g, "").trim()}\n\n`);
  t = t.replace(/<li[^>]*>/gi, "\n- ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote|pre)>/gi, "\n\n");
  t = decode(t.replace(/<[^>]+>/g, ""));
  t = t.split("\n").map((l) => l.replace(/[ \t\f\v]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: t };
}

/** github.com/<owner>/<repo>[/...] → the repo; anything else → null. */
export function githubRepoOf(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
    const [owner, repo] = u.pathname.split("/").filter(Boolean);
    if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch { return null; }
}

/** Uploaded files joined into one text, each under its own name line. */
export function joinFiles(files: { name: string; text: string }[]): string {
  return files.length === 1 ? files[0].text : files.map((f) => `=== ${f.name} ===\n${f.text.trim()}`).join("\n\n");
}

// ---------------------------------------------------------------------------------------
// Notion: a page's blocks as markdown

type RichText = { plain_text?: string }[];
type NotionBlock = { type?: string; [k: string]: unknown };
const rt = (b: NotionBlock) => {
  const v = (b[b.type ?? ""] ?? {}) as { rich_text?: RichText; checked?: boolean; language?: string };
  return (v.rich_text ?? []).map((r) => r.plain_text ?? "").join("");
};
export function notionBlocksToMarkdown(blocks: NotionBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    const text = rt(b);
    const v = (b[b.type ?? ""] ?? {}) as { checked?: boolean; language?: string };
    switch (b.type) {
      case "heading_1": out.push(`# ${text}`); break;
      case "heading_2": out.push(`## ${text}`); break;
      case "heading_3": out.push(`### ${text}`); break;
      case "bulleted_list_item": out.push(`- ${text}`); break;
      case "numbered_list_item": out.push(`1. ${text}`); break;
      case "to_do": out.push(`- [${v.checked ? "x" : " "}] ${text}`); break;
      case "quote": case "callout": out.push(`> ${text}`); break;
      case "code": out.push("```" + (v.language ?? "") + "\n" + text + "\n```"); break;
      case "divider": out.push("---"); break;
      default: if (text) out.push(text);
    }
  }
  return out.join("\n\n").trim();
}
export function notionTitle(page: { properties?: Record<string, { type?: string; title?: RichText }> }): string {
  const p = Object.values(page.properties ?? {}).find((x) => x?.type === "title");
  return (p?.title ?? []).map((r) => r.plain_text ?? "").join("").trim();
}

// ---------------------------------------------------------------------------------------
// Rules: the account's rules plus the project's own

export type ProjectRuleRow = { id: string; name: string; pattern: string; severity: string; redact: boolean; enabled: boolean };
export const projectRulesAsSafety = (rows: ProjectRuleRow[]): SafetyRule[] => rows.filter((r) => r.enabled).map((r) => ({
  id: `project:${r.id}`, name: r.name, category: "custom", pattern: r.pattern, severity: r.severity === "block" ? "block" : "require_approval",
  enabled: true, builtin: false, agent_id: null, api_key_id: null, shadow_mode: false, rationale: null, redact: r.severity === "block" && r.redact,
}) as SafetyRule);

export async function loadProjectRules(admin: AnyAdmin, projectId: string | null | undefined): Promise<SafetyRule[]> {
  if (!projectId) return [];
  try {
    const { data } = await admin.from("project_rules").select("id, name, pattern, severity, redact, enabled").eq("project_id", projectId);
    return projectRulesAsSafety((data ?? []) as ProjectRuleRow[]);
  } catch { return []; }
}

/** The rules that apply to a project's text: the account's (not those of one agent or key) and the project's own. */
export async function rulesForProject(admin: AnyAdmin, accountId: string, projectId: string | null): Promise<SafetyRule[]> {
  return [...await loadSafetyRules(admin, accountId, null, null), ...await loadProjectRules(admin, projectId)].filter((r) => !r.shadow_mode);
}

/** What the rules find in a text, and the text with removable matches taken out (what a tool may receive). */
export function checkProjectText(rules: SafetyRule[], text: string): { matches: CheckMatch[]; cleaned: string; blocked: boolean } {
  const scan = scanWithRules(rules, text, "");
  const matches: CheckMatch[] = [];
  for (const m of scan.matches) {
    const action: CheckMatch["action"] = m.severity === "block" ? (isRedactableMatch(m) ? "remove_text" : "block") : "approval";
    if (!matches.some((x) => x.name === m.name)) matches.push({ name: m.name, action });
  }
  const removable = scan.matches.filter((m) => m.severity === "block" && isRedactableMatch(m));
  return { matches, cleaned: removable.length ? textSafeToStore(text, removable) : text, blocked: matches.some((m) => m.action === "block") };
}

/** "remove": cut the words out of what tools receive; "block": stop a reply that contains them; "approval": ask first. */
export type RuleAction = "remove" | "block" | "approval";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Words or phrases (comma or new line separated) as one case-insensitive pattern. */
export function wordsToPattern(words: string): string | null {
  const parts = words.split(/[,\n]/).map((w) => w.trim()).filter(Boolean).slice(0, 30);
  if (!parts.length) return null;
  // The rule scanner compiles patterns with the "i" flag only, so the word edges are written without Unicode classes.
  return `(?<![A-Za-z0-9_])(?:${parts.map((w) => escapeRe(w).replace(/\s+/g, "\\s+")).join("|")})(?![A-Za-z0-9_])`;
}

// ---------------------------------------------------------------------------------------
// The actions

export type FetchedPage = { ok: boolean; status: number; contentType: string; text: string; finalUrl: string; error?: string };
export type ProjectDeps = {
  /** Fetches a public https URL (redirects followed and re-checked, size capped). */
  fetchUrl: (url: string) => Promise<FetchedPage>;
  /** Whether a URL may be fetched (https, not a private or local address). */
  checkUrl: (url: string) => Promise<{ ok: boolean; reason: string }>;
  /** The Notion API with the account's Notion token; null token when Notion is not connected. */
  notion: (admin: AnyAdmin, accountId: string, path: string, init?: { method?: string; body?: unknown }) => Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null; connected: boolean }>;
  now: () => number;
};

export type ActionResult = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): ActionResult => ({ status: 200, body: { ok: true, ...body } });
const bad = (status: number, error: string, message: string): ActionResult => ({ status, body: { ok: false, error, message } });

const PROJECT_COLS = "id, user_id, name, source_mode, source_kind, source_ref, source_label, content_type, files, content_sha256, last_check, write_back, write_back_enabled_at, integration_id, last_synced_at, sync_error, created_at, updated_at, archived_at";

async function insertProject(admin: AnyAdmin, accountId: string, deps: ProjectDeps, p: {
  name: string; source_mode: "snapshot" | "linked"; source_kind: "link" | "file" | "paste" | "notion"; source_ref: string | null; source_label: string;
  content_type: ContentType; content: string; files: ProjectFile[]; integration_id?: string | null;
}): Promise<ActionResult> {
  if (!p.content.trim()) return bad(400, "empty", "There is no text to import.");
  if (p.content.length > MAX_PROJECT_CHARS) return bad(413, "too_large", `A project can hold at most ${MAX_PROJECT_CHARS.toLocaleString("en")} characters; this one has ${p.content.length.toLocaleString("en")}.`);
  const rules = await rulesForProject(admin, accountId, null);
  const check = checkProjectText(rules, p.content);
  const at = new Date(deps.now()).toISOString();
  const last_check: ProjectCheck = { at, rules: rules.length, matches: check.matches };
  const { data, error } = await admin.from("imported_projects").insert({
    user_id: accountId, name: p.name, source_mode: p.source_mode, source_kind: p.source_kind, source_ref: p.source_ref, source_label: clip(p.source_label, 200),
    content_type: p.content_type, content: p.content, files: p.files, content_sha256: await sha256Hex(p.content), last_check,
    integration_id: p.integration_id ?? null, last_synced_at: p.source_mode === "linked" ? at : null, write_back: false, sync_error: null, archived_at: null, created_at: at, updated_at: at,
  }).select(PROJECT_COLS).maybeSingle();
  if (error || !data) return bad(500, "internal_error", "The project could not be saved.");
  return ok({ project: data, check: last_check });
}

async function ownProject(admin: AnyAdmin, accountId: string, id: unknown) {
  const { data } = await admin.from("imported_projects").select(`${PROJECT_COLS}, content`).eq("id", String(id ?? "")).eq("user_id", accountId).maybeSingle();
  return data as (Record<string, unknown> & { id: string; name: string; source_mode: string; source_kind: string; source_ref: string | null; write_back: boolean; content: string; archived_at: string | null }) | null;
}

async function notionPageContent(admin: AnyAdmin, accountId: string, deps: ProjectDeps, pageId: string): Promise<{ ok: true; title: string; markdown: string } | { ok: false; result: ActionResult }> {
  const page = await deps.notion(admin, accountId, `/v1/pages/${pageId}`);
  if (!page.connected) return { ok: false, result: bad(409, "notion_not_connected", "Notion is not connected. Connect it first, then import the page.") };
  if (!page.ok || !page.json) return { ok: false, result: bad(502, "notion_error", `Notion refused: ${String(page.json?.message ?? `HTTP ${page.status}`)}. Make sure the page is shared with NazAI's Notion connection.`) };
  const blocks: NotionBlock[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const r = await deps.notion(admin, accountId, `/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!r.ok || !r.json) return { ok: false, result: bad(502, "notion_error", `Notion refused the page content: ${String(r.json?.message ?? `HTTP ${r.status}`)}.`) };
    blocks.push(...((r.json.results ?? []) as NotionBlock[]));
    if (!r.json.has_more || !r.json.next_cursor) break;
    cursor = String(r.json.next_cursor);
    if (notionBlocksToMarkdown(blocks).length > MAX_PROJECT_CHARS) break;
  }
  return { ok: true, title: notionTitle(page.json as never), markdown: notionBlocksToMarkdown(blocks) };
}

export async function handleProjectsAction(admin: AnyAdmin, accountId: string, userId: string, body: Record<string, unknown>, deps: ProjectDeps): Promise<ActionResult> {
  const action = String(body.action ?? "");

  if (action === "import_paste") {
    const text = typeof body.text === "string" ? body.text : "";
    return insertProject(admin, accountId, deps, {
      name: cleanName(body.name, firstLine(text) || "Pasted text"), source_mode: "snapshot", source_kind: "paste", source_ref: null, source_label: "Pasted text",
      content_type: contentTypeOf({ text }), content: text, files: [],
    });
  }

  if (action === "import_files") {
    const raw = Array.isArray(body.files) ? body.files as { name?: unknown; text?: unknown }[] : [];
    if (!raw.length) return bad(400, "no_files", "Choose at least one file.");
    if (raw.length > MAX_PROJECT_FILES) return bad(400, "too_many_files", `At most ${MAX_PROJECT_FILES} files can be imported at once.`);
    const files: { name: string; text: string }[] = [];
    for (const f of raw) {
      const name = clip(String(f.name ?? "").replace(/[\\/]/g, "_").trim(), 200);
      if (!name || !isTextFile(name)) return bad(400, "file_type", `${name || "A file"} is not a text file NazAI can import (text, markdown, HTML, JSON, CSV or code).`);
      if (typeof f.text !== "string") return bad(400, "file_unreadable", `${name} could not be read as text.`);
      files.push({ name, text: f.text });
    }
    const content = joinFiles(files);
    return insertProject(admin, accountId, deps, {
      name: cleanName(body.name, files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : `${files.length} files`), source_mode: "snapshot", source_kind: "file",
      source_ref: clip(files.map((f) => f.name).join(", "), 2000), source_label: files.length === 1 ? files[0].name : `${files.length} files`,
      content_type: contentTypeOf({ files }), content, files: files.map((f) => ({ name: f.name, chars: f.text.length })),
    });
  }

  if (action === "import_link") {
    const url = String(body.url ?? "").trim();
    const allowed = await deps.checkUrl(url);
    if (!allowed.ok) return bad(400, "address_not_allowed", `That link can't be imported: ${allowed.reason}.`);
    const repo = githubRepoOf(url);
    let title = "";
    let text = "";
    if (repo) {
      // A GitHub repository: its README and its top-level file list.
      const readme = await deps.fetchUrl(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/README.md`);
      const listing = await deps.fetchUrl(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents`);
      let files: string[] = [];
      try { files = (JSON.parse(listing.text) as { name: string; type: string }[]).map((x) => `${x.type === "dir" ? "📁" : "-"} ${x.name}`); } catch { /* no listing */ }
      if (!readme.ok && !files.length) return bad(404, "not_found", "That GitHub repository could not be read. Only public repositories can be imported by link.");
      title = `${repo.owner}/${repo.repo}`;
      text = [readme.ok ? readme.text.trim() : "", files.length ? `## Files\n\n${files.join("\n")}` : ""].filter(Boolean).join("\n\n");
    } else {
      const page = await deps.fetchUrl(url);
      if (!page.ok) return bad(502, "fetch_failed", page.error ?? `The page could not be read (HTTP ${page.status}).`);
      if (/html/i.test(page.contentType)) {
        const h = htmlToText(page.text);
        title = h.title; text = h.text;
      } else if (/^(text\/|application\/(json|xml|x-yaml|yaml))/i.test(page.contentType) || !page.contentType) {
        text = page.text;
      } else {
        return bad(415, "not_text", `That link is not a text page (${page.contentType}). Download it and upload it as a text file instead.`);
      }
      if (/sign in|log in|login required/i.test(title) && text.length < 2000) return bad(403, "login_required", "That page needs a login. Only public pages can be imported by link.");
    }
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* checked above */ }
    return insertProject(admin, accountId, deps, {
      name: cleanName(body.name, title || firstLine(text) || host), source_mode: "snapshot", source_kind: "link", source_ref: url, source_label: host,
      content_type: repo ? "markdown" : contentTypeOf({ text }), content: clip(text, MAX_PROJECT_CHARS + 1), files: [],
    });
  }

  if (action === "notion_search") {
    const query = clip(String(body.query ?? "").trim(), 200);
    const r = await deps.notion(admin, accountId, "/v1/search", { method: "POST", body: { query, filter: { property: "object", value: "page" }, page_size: 20 } });
    if (!r.connected) return bad(409, "notion_not_connected", "Notion is not connected.");
    if (!r.ok || !r.json) return bad(502, "notion_error", `Notion refused the search: ${String(r.json?.message ?? `HTTP ${r.status}`)}.`);
    const pages = ((r.json.results ?? []) as Record<string, unknown>[]).map((p) => ({
      id: String(p.id), title: notionTitle(p as never) || "Untitled", url: String(p.url ?? ""), last_edited: String(p.last_edited_time ?? ""),
      icon: (p.icon as { emoji?: string } | null)?.emoji ?? null,
    }));
    return ok({ pages });
  }

  if (action === "import_notion") {
    const pageId = String(body.page_id ?? "").replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/i.test(pageId)) return bad(400, "invalid_page", "Choose a Notion page.");
    const got = await notionPageContent(admin, accountId, deps, pageId);
    if (!got.ok) return got.result;
    return insertProject(admin, accountId, deps, {
      name: cleanName(body.name, got.title || "Notion page"), source_mode: "linked", source_kind: "notion", source_ref: pageId, source_label: "Notion",
      content_type: "markdown", content: clip(got.markdown, MAX_PROJECT_CHARS + 1), files: [],
    });
  }

  // ---- actions on one project
  const p = await ownProject(admin, accountId, body.project_id);
  if (!p) return bad(404, "not_found", "That project was not found.");
  const at = new Date(deps.now()).toISOString();

  if (action === "refresh") {
    if (p.source_mode !== "linked" || p.source_kind !== "notion" || !p.source_ref) return bad(409, "not_linked", "Only a linked project can be refreshed from its source.");
    const got = await notionPageContent(admin, accountId, deps, p.source_ref);
    if (!got.ok) {
      await admin.from("imported_projects").update({ sync_error: clip(String(got.result.body.message ?? "Sync failed"), 500), updated_at: at }).eq("id", p.id);
      return got.result;
    }
    const content = clip(got.markdown, MAX_PROJECT_CHARS);
    const sha = await sha256Hex(content);
    const changed = sha !== p.content_sha256;
    const rules = await rulesForProject(admin, accountId, p.id);
    const last_check: ProjectCheck = { at, rules: rules.length, matches: checkProjectText(rules, content).matches };
    await admin.from("imported_projects").update({ content, content_sha256: sha, last_check, last_synced_at: at, sync_error: null, updated_at: at }).eq("id", p.id);
    return ok({ changed, check: last_check });
  }

  if (action === "rename") {
    const name = cleanName(body.name, "");
    if (!String(body.name ?? "").trim()) return bad(400, "invalid_name", "Give the project a name.");
    await admin.from("imported_projects").update({ name, updated_at: at }).eq("id", p.id);
    return ok({ name });
  }

  if (action === "archive") {
    await admin.from("imported_projects").update({ archived_at: body.archived === false ? null : at, updated_at: at }).eq("id", p.id);
    return ok({ archived: body.archived !== false });
  }

  if (action === "set_write_back") {
    if (p.source_mode !== "linked") return bad(409, "snapshot", "A snapshot is a copy: there is no original to write to.");
    const enable = body.enabled === true;
    if (enable && String(body.confirm_name ?? "").trim() !== p.name) return bad(400, "confirm_name", "Type the project's name exactly to turn write-back on.");
    await admin.from("imported_projects").update({ write_back: enable, write_back_enabled_at: enable ? at : null, updated_at: at }).eq("id", p.id);
    return ok({ write_back: enable });
  }

  if (action === "write_back") {
    if (p.source_mode !== "linked" || p.source_kind !== "notion" || !p.source_ref) return bad(409, "snapshot", "A snapshot is a copy: there is no original to write to.");
    if (!p.write_back) return bad(403, "write_back_disabled", "Write-back is off for this project. Turn it on in the project first.");
    const text = String(body.text ?? "").trim();
    if (!text) return bad(400, "empty", "There is nothing to write.");
    if (text.length > MAX_WRITE_BACK_CHARS) return bad(413, "too_large", `At most ${MAX_WRITE_BACK_CHARS.toLocaleString("en")} characters can be written back at once.`);
    // The text that leaves NazAI is checked like any other: the account's rules and this project's.
    const check = checkProjectText(await rulesForProject(admin, accountId, p.id), text);
    if (check.blocked) return bad(422, "blocked", `A rule blocks this text: ${check.matches.filter((m) => m.action === "block").map((m) => m.name).join(", ")}. Nothing was sent.`);
    // The Notion writer adds at most 90 paragraphs of 1,900 characters each; more would arrive cut, so it is refused instead.
    const paras = check.cleaned.split(/\n{2,}/).filter((x) => x.trim());
    if (paras.length > 90 || paras.some((x) => x.length > 1900)) {
      return bad(413, "too_long_for_notion", "Notion takes at most 90 paragraphs of up to 1,900 characters each in one write. Split the text into smaller writes. Nothing was sent.");
    }
    const { data, error } = await admin.from("pending_approvals").insert({
      user_id: accountId, decision_id: null, api_key_id: null, requester_id: userId, agent_id: null, run_id: null,
      action_type: "notion_update_page", provider: "Notion",
      description: clip(`Write to the original of project "${p.name}" (Notion page): add ${check.cleaned.length.toLocaleString("en")} characters at the end. Nothing existing is changed or removed.`, 800),
      params: { page_id: p.source_ref, append_markdown: check.cleaned, project_id: p.id },
      reason: "Write-back to an imported project's original. Write-back is on for this project, and every write waits for an approval.",
      risk_tier: "medium", origin: "projects", approver_role: "owner", required_approvals: 1, status: "pending",
    }).select("id").maybeSingle();
    if (error || !data) return bad(500, "internal_error", "The approval could not be created, so nothing will be written.");
    return ok({ approval_id: (data as { id: string }).id, removed: check.matches.filter((m) => m.action === "remove_text").map((m) => m.name) });
  }

  if (action === "add_rule") {
    const { count } = await admin.from("project_rules").select("id", { count: "exact", head: true }).eq("project_id", p.id);
    if ((count ?? 0) >= MAX_RULES_PER_PROJECT) return bad(409, "too_many_rules", `A project can have at most ${MAX_RULES_PER_PROJECT} rules.`);
    const name = clip(String(body.name ?? "").replace(/\s+/g, " ").trim(), 120);
    if (!name) return bad(400, "invalid_name", "Give the rule a name.");
    const pattern = wordsToPattern(String(body.words ?? ""));
    if (!pattern) return bad(400, "invalid_words", "Say which words or phrases the rule looks for.");
    try { new RegExp(pattern, "i"); } catch { return bad(400, "invalid_words", "Those words can not be used as a rule."); }
    const act = String(body.rule_action ?? "remove") as RuleAction;
    if (!["remove", "block", "approval"].includes(act)) return bad(400, "invalid_action", "rule_action must be remove, block or approval.");
    const { data, error } = await admin.from("project_rules").insert({
      user_id: accountId, project_id: p.id, name, pattern, severity: act === "approval" ? "require_approval" : "block", redact: act === "remove", enabled: true, created_at: at,
    }).select("id, name, pattern, severity, redact, enabled, created_at").maybeSingle();
    if (error || !data) return bad(500, "internal_error", "The rule could not be saved.");
    const rules = await rulesForProject(admin, accountId, p.id);
    const last_check: ProjectCheck = { at, rules: rules.length, matches: checkProjectText(rules, p.content).matches };
    await admin.from("imported_projects").update({ last_check, updated_at: at }).eq("id", p.id);
    return ok({ rule: data, check: last_check });
  }

  if (action === "remove_rule") {
    await admin.from("project_rules").delete().eq("id", String(body.rule_id ?? "")).eq("project_id", p.id);
    const rules = await rulesForProject(admin, accountId, p.id);
    const last_check: ProjectCheck = { at, rules: rules.length, matches: checkProjectText(rules, p.content).matches };
    await admin.from("imported_projects").update({ last_check, updated_at: at }).eq("id", p.id);
    return ok({ check: last_check });
  }

  return bad(400, "unknown_action", `Unknown action "${action}".`);
}

/** A project's text for the tools of an Outer Control Task: checked against the account's and the project's rules first. */
export async function projectContextFor(admin: AnyAdmin, accountId: string, projectId: string): Promise<{ ok: true; name: string; mode: string; text: string; removed: string[] } | { ok: false; message: string }> {
  const { data } = await admin.from("imported_projects").select("id, name, source_mode, content, archived_at").eq("id", projectId).eq("user_id", accountId).maybeSingle();
  const p = data as { id: string; name: string; source_mode: string; content: string; archived_at: string | null } | null;
  if (!p || p.archived_at) return { ok: false, message: "That project was not found." };
  // The name goes to the tools too, so it is checked with the text.
  const more = p.content.length > PROJECT_CONTEXT_CHARS ? `\n[… the first ${PROJECT_CONTEXT_CHARS.toLocaleString("en")} of ${p.content.length.toLocaleString("en")} characters]` : "";
  const full = `Project "${p.name}" (${p.source_mode === "linked" ? "linked to its original" : "snapshot copy"}), checked by NazAI:\n${clip(p.content, PROJECT_CONTEXT_CHARS)}${more}`;
  const check = checkProjectText(await rulesForProject(admin, accountId, p.id), full);
  if (check.blocked) return { ok: false, message: `A rule blocks this project's text from going to tools: ${check.matches.filter((m) => m.action === "block").map((m) => m.name).join(", ")}.` };
  return { ok: true, name: p.name, mode: p.source_mode, text: check.cleaned, removed: check.matches.filter((m) => m.action === "remove_text").map((m) => m.name) };
}

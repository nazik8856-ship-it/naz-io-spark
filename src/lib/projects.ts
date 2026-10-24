// Projects: imported projects (snapshot or linked) and generated ones (agents and websites), as one list. Source and status are
// worked out here once, so every place that shows a project says the same thing.
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";

export type SourceMode = "snapshot" | "linked";
export type CheckMatch = { name: string; action: "remove_text" | "block" | "approval" };
export type ProjectCheck = { at: string; rules: number; matches: CheckMatch[] };
export type ImportedProject = {
  id: string; user_id: string; name: string; source_mode: SourceMode; source_kind: "link" | "file" | "paste" | "notion";
  source_ref: string | null; source_label: string; content_type: "text" | "markdown" | "html" | "code" | "mixed";
  files: { name: string; chars: number }[]; content_sha256: string; last_check: ProjectCheck | null;
  write_back: boolean; write_back_enabled_at: string | null; last_synced_at: string | null; sync_error: string | null;
  created_at: string; updated_at: string; archived_at: string | null; content?: string;
};
export type ProjectRule = { id: string; name: string; pattern: string; severity: "block" | "require_approval"; redact: boolean; enabled: boolean; created_at: string };

/** One row of the Projects list: imported, or generated (an agent or a website). */
export type ProjectItem = {
  key: string; id: string; name: string; origin: "imported" | "generated";
  kind: "imported" | "agent" | "website"; updated_at: string; href: string; imported?: ImportedProject;
};

export const PROJECT_COLS = "id, user_id, name, source_mode, source_kind, source_ref, source_label, content_type, files, content_sha256, last_check, write_back, write_back_enabled_at, last_synced_at, sync_error, created_at, updated_at, archived_at";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : "";
};
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "never";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const SOURCE_NAME: Record<ImportedProject["source_kind"], string> = { notion: "Notion", link: "Link", file: "Upload", paste: "Paste" };

/** What the source badge says. */
export function sourceBadge(p: ImportedProject | null, now = Date.now()): { label: string; detail: string; tone: "snapshot" | "linked" | "generated" } {
  if (!p) return { label: "Generated", detail: "Built in NazAI", tone: "generated" };
  if (p.source_mode === "linked") return { label: `Linked · ${SOURCE_NAME[p.source_kind]}`, detail: `Linked to the original · last synced ${ago(p.last_synced_at, now)}`, tone: "linked" };
  return { label: "Snapshot", detail: `One-time copy · imported ${shortDate(p.created_at)}. Changes to the original are not reflected.`, tone: "snapshot" };
}

/** The project's status, the same everywhere it is shown. */
export function projectStatus(p: ImportedProject | null): { label: string; tone: "ok" | "warn" } {
  if (p?.sync_error) return { label: `Sync failed: ${p.sync_error}`, tone: "warn" };
  if (p?.write_back) return { label: "Under NazAI control · write-back on", tone: "ok" };
  return { label: "Under NazAI control", tone: "ok" };
}

const TYPE_NAME: Record<ImportedProject["content_type"], string> = { markdown: "Markdown", code: "Code", text: "Text", html: "HTML", mixed: "Mixed files" };
export const projectType = (item: ProjectItem) =>
  item.kind === "imported" && item.imported ? `Imported · ${TYPE_NAME[item.imported.content_type]}` : item.kind === "agent" ? "Generated · Agent" : "Generated · Website";

/** Calls the projects edge function with the signed-in person's token. */
export async function callProjects(action: string, payload: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown>; message: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? SUPABASE_ANON;
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok && data?.ok !== false, data: data ?? {}, message: data?.message || data?.error || "" };
  } catch {
    return { ok: false, data: {}, message: "Could not reach NazAI. Try again." };
  }
}

/** Text files a browser can read for an upload, and the limits the server checks again. */
export const UPLOAD_ACCEPT = ".md,.markdown,.txt,.text,.html,.htm,.json,.csv,.tsv,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.rb,.go,.java,.kt,.rs,.c,.h,.cpp,.cs,.php,.sql,.sh,.css,.scss,.toml,.ini";
export const MAX_FILES = 20;
export const MAX_CHARS = 200_000;

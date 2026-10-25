// Projects: imported projects (snapshot or linked) and generated ones (agents and websites), as one list. Source and status are
// worked out here once, so every place that shows a project says the same thing.
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";

export type SourceMode = "snapshot" | "linked";
export type CheckMatch = { name: string; action: "remove_text" | "block" | "approval" };
export type ProjectCheck = {
  at: string; rules: number; matches: CheckMatch[];
  /** What was hidden before saving (credentials, card and ID numbers, written-out passwords). */
  hidden?: { name: string; count: number }[];
  /** Instruction-like text aimed at an AI found in the project (kept, flagged, never obeyed). */
  injection?: { severity: "suspicious" | "strong"; signals: { label: string; sample: string }[] } | null;
  /** Stored encrypted. */
  protected?: boolean;
};
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

/** "1 secret hidden before saving", or null when nothing was hidden. */
export function hiddenNotice(check: ProjectCheck | null | undefined): { text: string; detail: string } | null {
  const items = check?.hidden ?? [];
  const n = items.reduce((t, h) => t + h.count, 0);
  if (!n) return null;
  return { text: `${n} secret${n === 1 ? "" : "s"} hidden before saving`, detail: items.map((h) => `${h.count} ${h.name}${h.count === 1 ? "" : "s"}`).join(", ") };
}

export type ProjectEvent = { id: string; project_id: string; project_name: string; actor_id: string | null; action: string; detail: Record<string, unknown>; created_at: string };
/** One line of a project's history, in plain words. */
export function eventText(e: ProjectEvent): string {
  const d = e.detail ?? {};
  const hidden = Number(d.hidden ?? 0);
  switch (e.action) {
    case "imported": return `Imported${hidden ? ` · ${hidden} secret${hidden === 1 ? "" : "s"} hidden` : ""}${d.flagged ? " · AI instructions flagged" : ""}`;
    case "refreshed": return `Updated from the original${hidden ? ` · ${hidden} secret${hidden === 1 ? "" : "s"} hidden` : ""}`;
    case "renamed": return `Renamed from "${String(d.from ?? "")}" to "${String(d.to ?? "")}"`;
    case "archived": return "Archived";
    case "restored": return "Restored";
    case "deleted": return "Deleted permanently";
    case "rule_added": return `Rule added: "${String(d.name ?? "")}"`;
    case "rule_removed": return `Rule removed: "${String(d.name ?? "")}"`;
    case "write_back_on": return "Write-back turned on";
    case "write_back_off": return "Write-back turned off";
    case "write_back_requested": return "Asked to write to the original (waits for approval)";
    default: return e.action;
  }
}

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

// ---------------------------------------------------------------------------------------
// Live check: a real Notion import and write-back, step by step, each step read from what actually happened.

export const LIVE_CHECK_PREFIX = "NazAI live check";
export const liveCheckLine = (now = new Date()) => `${LIVE_CHECK_PREFIX} · ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
export type LiveApproval = { id: string; status: string; executed_at: string | null; execution_error: string | null; params: { project_id?: string; append_markdown?: string } | null; created_at: string };
export type LiveStep = { key: "connected" | "read" | "write_back" | "sent" | "run" | "landed"; label: string; state: "done" | "todo" | "waiting" | "failed"; detail: string };

/** The steps of the live check for a linked Notion project, from the project, its approvals and its current text. */
export function liveCheckSteps(p: ImportedProject, approvals: LiveApproval[], content: string | null, now = Date.now()): { steps: LiveStep[]; done: number; next: LiveStep | null; test: LiveApproval | null } {
  const test = approvals
    .filter((a) => a.params?.project_id === p.id && String(a.params?.append_markdown ?? "").startsWith(LIVE_CHECK_PREFIX))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
  const line = String(test?.params?.append_markdown ?? "");
  const steps: LiveStep[] = [
    { key: "connected", label: "Imported from Notion", state: "done", detail: "Linked to the original page through your Notion connection." },
    p.sync_error
      ? { key: "read", label: "NazAI can read the page", state: "failed", detail: p.sync_error }
      : { key: "read", label: "NazAI can read the page", state: p.last_synced_at ? "done" : "todo", detail: p.last_synced_at ? `Read ${ago(p.last_synced_at, now)}.` : "Refresh to read it from Notion." },
    { key: "write_back", label: "Write-back is on", state: p.write_back ? "done" : "todo", detail: p.write_back ? "NazAI may add to the end of the page, each write after your approval." : "Turn it on: type the project's name to confirm." },
    { key: "sent", label: "A test line waits for approval", state: test ? "done" : "todo", detail: test ? `“${line}”` : "Send one short test line. Nothing is written yet." },
    !test
      ? { key: "run", label: "Approved and run", state: "todo", detail: "In Approvals: approve it, then press Run it." }
      : test.status === "rejected"
        ? { key: "run", label: "Approved and run", state: "failed", detail: test.execution_error || "It was rejected, so nothing was written. Send a new test line." }
        : test.execution_error
          ? { key: "run", label: "Approved and run", state: "failed", detail: test.execution_error }
          : test.executed_at
            ? { key: "run", label: "Approved and run", state: "done", detail: `Notion confirmed the write ${ago(test.executed_at, now)}.` }
            : { key: "run", label: "Approved and run", state: "waiting", detail: "Open Approvals, approve it, then press Run it." },
    !test?.executed_at
      ? { key: "landed", label: "The line is in the Notion page", state: "todo", detail: "After Run it, NazAI reads the page again to find the line." }
      : content !== null && content.includes(line)
        ? { key: "landed", label: "The line is in the Notion page", state: "done", detail: "Found in the page NazAI read back. The live check passed." }
        : { key: "landed", label: "The line is in the Notion page", state: "waiting", detail: "Not seen yet: refresh to read the page again." },
  ];
  return { steps, done: steps.filter((s) => s.state === "done").length, next: steps.find((s) => s.state !== "done") ?? null, test };
}

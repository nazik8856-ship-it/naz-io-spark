// Outer Control: the history as a file. One row per session, with the honest status and the reason next to it, so the CSV says the same
// thing the screen says. Cells that a spreadsheet would run as a formula are made plain text.
import { honestStatus } from "@/lib/outer-control-status";

export type ExportSession = {
  id: string; tool_id: string; objective: string; status: string; step_count: number; max_steps: number; stop_reason: string | null;
  started_at: string; finished_at?: string | null; workflow_id: string | null; leg_no: number | null; final_artifact?: unknown;
  pending_kind?: string | null; archived_at?: string | null;
};

export const CSV_HEADER = ["Started (UTC)", "Finished (UTC)", "Task", "Step", "Tool", "Request", "Status", "Reason", "Exchanges", "Result", "Result SHA-256", "Archived", "Session id"] as const;

/** One CSV cell: quoted when needed, and a leading = + - @ (or tab/return) is neutralised so it cannot run as a formula. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const utc = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().replace("T", " ").slice(0, 19) : "");

export function sessionsToCsv(rows: ExportSession[], toolName: (id: string) => string): string {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const r of rows) {
    const st = honestStatus({ kind: "session", status: r.status as never, artifact: r.final_artifact, stop_reason: r.stop_reason, waiting_for: null, step_count: r.step_count, max_steps: r.max_steps });
    const art = r.final_artifact as { final_output?: unknown; output_sha256?: unknown } | null | undefined;
    const accepted = st.key === "completed" && art && typeof art.final_output === "string";
    lines.push([
      utc(r.started_at), utc(r.finished_at), r.workflow_id ?? "", r.leg_no ?? "", toolName(r.tool_id), r.objective, st.label, st.reason ?? "", r.step_count,
      accepted ? art!.final_output : "", accepted && typeof art!.output_sha256 === "string" ? art!.output_sha256 : "", r.archived_at ? "yes" : "", r.id,
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Hands a text file to the browser as a download. Returns false when the browser would not. */
export function saveTextFile(name: string, body: string, type: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const el = document.createElement("a");
    el.href = url; el.download = name;
    document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
    return true;
  } catch { return false; }
}


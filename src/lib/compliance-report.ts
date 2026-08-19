// Pure — bundles a date range's self-audit results, incidents, and
// settings changes into one exportable Markdown document. No DOM/Blob
// work here, same separation as toCsv (src/lib/csv.ts): serialization is
// pure and testable, download-triggering lives in the page component.
import { summarizeConfigChange } from "./config-change-diff";

export type ComplianceTestRun = { created_at: string; pass_rate_pct: number; regressions: unknown[] };
export type ComplianceIncident = {
  kind: string;
  status: string;
  summary: string;
  opened_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};
export type ComplianceChange = {
  table_name: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

export type ComplianceReportInput = {
  from: string;
  to: string;
  generatedAt: string;
  testRuns: ComplianceTestRun[];
  incidents: ComplianceIncident[];
  changes: ComplianceChange[];
};

/** Pure — builds the report as Markdown text. */
export function buildComplianceReport(input: ComplianceReportInput): string {
  const lines: string[] = [];
  lines.push("# NazAI Control System — Compliance Report");
  lines.push(`Range: ${input.from} to ${input.to}`);
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push("");

  lines.push(`## Self-audit runs (${input.testRuns.length})`);
  if (!input.testRuns.length) {
    lines.push("None in this range.");
  } else {
    for (const r of input.testRuns) {
      const regressionNote = Array.isArray(r.regressions) && r.regressions.length ? `, ${r.regressions.length} regression(s)` : "";
      lines.push(`- ${r.created_at}: ${r.pass_rate_pct}% pass${regressionNote}`);
    }
  }
  lines.push("");

  lines.push(`## Incidents (${input.incidents.length})`);
  if (!input.incidents.length) {
    lines.push("None in this range.");
  } else {
    for (const i of input.incidents) {
      lines.push(`- [${i.status}] ${i.kind} — ${i.summary}`);
      lines.push(`  Opened: ${i.opened_at}${i.resolved_at ? ` · Resolved: ${i.resolved_at}` : ""}`);
      if (i.resolution_note) lines.push(`  Note: ${i.resolution_note}`);
    }
  }
  lines.push("");

  lines.push(`## Settings changes (${input.changes.length})`);
  if (!input.changes.length) {
    lines.push("None in this range.");
  } else {
    for (const c of input.changes) {
      lines.push(`- ${c.created_at} — ${c.table_name} ${c.action}: ${summarizeConfigChange(c.before, c.after)}`);
    }
  }

  return lines.join("\n");
}

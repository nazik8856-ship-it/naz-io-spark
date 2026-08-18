// Minimal, dependency-free CSV serialization — RFC 4180 quoting (quote a
// field when it contains a comma, quote, or newline; double up embedded
// quotes). Pure function, no DOM/Blob work here, so it's directly testable.

export type CsvColumn<T> = { key: keyof T | string; header: string; value?: (row: T) => unknown };

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Pure — builds an RFC 4180-ish CSV string (with a header row) from rows + column defs. */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvField(c.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(c.value ? c.value(row) : row[c.key as string])).join(",")
  );
  return [header, ...lines].join("\r\n");
}

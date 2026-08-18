import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("writes a header row followed by one row per input, in column order", () => {
    const csv = toCsv(
      [{ a: "1", b: "x" }, { a: "2", b: "y" }],
      [{ key: "a", header: "A" }, { key: "b", header: "B" }],
    );
    expect(csv).toBe("A,B\r\n1,x\r\n2,y");
  });

  it("quotes a field containing a comma", () => {
    const csv = toCsv([{ a: "hello, world" }], [{ key: "a", header: "A" }]);
    expect(csv).toBe('A\r\n"hello, world"');
  });

  it("quotes a field containing a double quote and doubles the embedded quote", () => {
    const csv = toCsv([{ a: 'say "hi"' }], [{ key: "a", header: "A" }]);
    expect(csv).toBe('A\r\n"say ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    const csv = toCsv([{ a: "line1\nline2" }], [{ key: "a", header: "A" }]);
    expect(csv).toBe('A\r\n"line1\nline2"');
  });

  it("renders null/undefined as an empty field, not the string 'null'/'undefined'", () => {
    const csv = toCsv([{ a: null, b: undefined }], [{ key: "a", header: "A" }, { key: "b", header: "B" }]);
    expect(csv).toBe("A,B\r\n,");
  });

  it("uses a custom value() accessor over the raw row field when provided", () => {
    const csv = toCsv(
      [{ created_at: "2026-08-17T10:00:00Z" }],
      [{ key: "created_at", header: "Date", value: (r) => new Date(r.created_at as string).toISOString().slice(0, 10) }],
    );
    expect(csv).toBe("Date\r\n2026-08-17");
  });

  it("stringifies a non-string, non-nullish value (e.g. a boolean or array) as JSON", () => {
    const csv = toCsv([{ ok: true, tags: ["a", "b"] }], [{ key: "ok", header: "OK" }, { key: "tags", header: "Tags" }]);
    expect(csv).toBe('OK,Tags\r\ntrue,"[""a"",""b""]"');
  });

  it("an empty rows array still produces just the header row", () => {
    const csv = toCsv([], [{ key: "a", header: "A" }]);
    expect(csv).toBe("A");
  });
});

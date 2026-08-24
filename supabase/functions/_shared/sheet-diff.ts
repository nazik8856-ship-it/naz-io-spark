// Pure write-verification for googleEditSheet: confirms a re-read range
// actually reflects the values that were sent, not just that the re-read
// came back non-empty. Not a full deep-equal -- Sheets coerces types on
// write (a sent string "5" can read back as the number 5, a formula
// result reads back as its computed value), so this spot-checks the
// corners of what was sent instead of demanding byte-identical cells.

export type SheetDiffResult = { ok: boolean; reason?: string };

export function diffSheetWrite(sent: unknown[][], got: unknown[][]): SheetDiffResult {
  if (got.length < sent.length) {
    return { ok: false, reason: `expected ${sent.length} row(s) to be written, re-read only found ${got.length}` };
  }

  const firstRow = 0;
  const lastRow = sent.length - 1;
  const spots = new Set<string>();
  if ((sent[firstRow]?.length ?? 0) > 0) {
    spots.add(`${firstRow},0`);
    spots.add(`${firstRow},${sent[firstRow].length - 1}`);
  }
  if (lastRow !== firstRow && (sent[lastRow]?.length ?? 0) > 0) {
    spots.add(`${lastRow},0`);
    spots.add(`${lastRow},${sent[lastRow].length - 1}`);
  }

  for (const spot of spots) {
    const [r, c] = spot.split(",").map(Number);
    const wantCell = sent[r]?.[c];
    if (wantCell === undefined || wantCell === "") continue; // nothing meaningful was asked to land here
    const wantStr = String(wantCell).trim();
    const gotStr = String(got[r]?.[c] ?? "").trim();
    if (wantStr !== gotStr) {
      return { ok: false, reason: `cell [${r}][${c}] was sent as "${wantStr}" but re-reading the range got "${gotStr}"` };
    }
  }
  return { ok: true };
}

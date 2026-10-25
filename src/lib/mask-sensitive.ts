// Display-side masking for text that was stored before secrets were masked at write time.
// Same built-in patterns as the server's safety scanner (secrets, card numbers, national IDs);
// the server now masks before storing, this only covers older rows and is harmless on new ones.
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /(sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{16,}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJhbGciOi[A-Za-z0-9_-]{10,})/gi, label: "secrets" },
  { re: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/gi, label: "pii" },
  { re: /\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/gi, label: "pii" },
];

type StoredMatch = { pattern?: string; category?: string; redact?: boolean };

/**
 * `matches` are the rule hits stored with the decision: a custom rule that is set to "cut the matched
 * text out" is masked here too, the way the server masks it.
 */
export function maskSensitive(text: string | null | undefined, matches?: StoredMatch[] | null): string {
  let out = text ?? "";
  for (const { re, label } of PATTERNS) out = out.replace(re, `[REDACTED:${label}]`);
  for (const m of matches ?? []) {
    if (!m || m.redact !== true || typeof m.pattern !== "string" || m.pattern.length > 300) continue;
    try { out = out.replace(new RegExp(m.pattern, "gi"), `[REDACTED:${m.category ?? "custom"}]`); } catch { /* an invalid stored pattern is skipped */ }
  }
  return out;
}

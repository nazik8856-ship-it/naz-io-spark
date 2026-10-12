// The picker/outline/strip vocabulary is duplicated in src/lib/site-structures.ts
// (edge functions cannot be imported from src/). This fails if either side drifts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUARD_PREFIX, INITIAL_CHECKS, OUTLINE_ADDABLE_TYPES, STRUCTURE_OPTIONS, VISUAL_FIX_PREFIX } from "@/lib/site-structures";

const templates = readFileSync("supabase/functions/_shared/generation-templates.ts", "utf8");
const quality = readFileSync("supabase/functions/_shared/generation-quality.ts", "utf8");

const list = (src: string, re: RegExp) => [...(src.match(re)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

describe("generator vocabulary parity (client vs edge functions)", () => {
  it("structure ids", () => {
    expect(list(templates, /STRUCTURE_IDS = \[([^\]]+)\]/)).toEqual(STRUCTURE_OPTIONS.map((s) => s.id));
  });
  it("structure labels", () => {
    for (const o of STRUCTURE_OPTIONS) expect(templates).toContain(`label: "${o.label}"`);
  });
  it("outline-addable section types", () => {
    expect(list(templates, /OUTLINE_ADDABLE_TYPES = \[([^\]]+)\]/)).toEqual([...OUTLINE_ADDABLE_TYPES]);
  });
  it("check ids and labels", () => {
    for (const c of INITIAL_CHECKS) expect(quality).toContain(`${c.id}: "${c.label}"`);
  });
  it("auto-fix note prefixes", () => {
    expect(quality).toContain(`GUARD_PREFIX = "${GUARD_PREFIX}"`);
    expect(quality).toContain(`VISUAL_FIX_PREFIX = "${VISUAL_FIX_PREFIX}"`);
  });
});

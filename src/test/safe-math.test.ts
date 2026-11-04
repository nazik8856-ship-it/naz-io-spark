import { describe, it, expect } from "vitest";
import { safeCalc } from "@/lib/safe-math";

// What the old implementation (new Function behind a character filter) computed, for the formulas a calculator section really has.
const oldCalc = (formula: string, vars: Record<string, number>) => {
  if (!formula || !/^[\s\w+\-*/().]+$/.test(formula)) return null;
  const names = Object.keys(vars);
  try { const out = new Function(...names, `"use strict"; return (${formula});`)(...names.map((n) => vars[n] ?? 0)); return typeof out === "number" && isFinite(out) ? out : null; } catch { return null; }
};

describe("safeCalc gives the same numbers as before for ordinary formulas", () => {
  const vars = { guests: 40, price: 12.5, hours: 3, rate: 0.2 };
  it.each([
    "guests * price", "guests*price + 50", "(guests + 5) * price", "price * hours * (1 + rate)", "guests / 4", "100 - guests", "-guests + 100",
    "guests * price * 0.15", "2 ** 3", "1.5e2 + guests", ".5 * guests", "Math.round(price * hours)", "Math.floor(guests / 7)", "Math.max(1)",
    "Math.PI * 2", "((guests))", "guests*(price+hours)*(rate+1)", "10 / 0", "guests / (hours - 3)",
  ])("%s", (f) => { expect(safeCalc(f, vars)).toBe(oldCalc(f, vars)); });
});

it("the remainder operator works (the old character filter refused it)", () => { expect(safeCalc("guests % 7", { guests: 40 })).toBe(5); });

describe("safeCalc never runs code", () => {
  const vars = { a: 2 };
  it.each([
    "alert(1)", "constructor", "a.constructor", "this", "window", "fetch(a)", "globalThis", "process", "a(a)", "Math.constructor", "Math.random() * 100",
    "(function(){})()", "a;alert(1)", "a,a", "`x`", '"x"', "'x'", "a = 5", "a++", "a => a", "[1]", "{}", "a ? 1 : 2", "a ** a ** a ** a ** a ** a ** a ** a ** a ** a ** 99999",
    "__proto__", "Math.max.constructor('return 1')()", "", "()", "1 +", "a b", "1..2", "Math", "Math.", "Math.round", "import('x')",
  ])("%s", (f) => { expect(safeCalc(f, vars)).toBeNull(); });

  it("an unknown name, a huge or endless input, and a non-number are no result", () => {
    expect(safeCalc("unknown * 2", vars)).toBeNull();
    expect(safeCalc("1+".repeat(400) + "1", vars)).toBeNull();
    expect(safeCalc("(".repeat(300) + "1" + ")".repeat(300), vars)).toBeNull();
    expect(safeCalc("x".repeat(600), vars)).toBeNull();
  });

  it("variables are only the section's own (no inherited names)", () => {
    expect(safeCalc("toString", {})).toBeNull();
    expect(safeCalc("hasOwnProperty", {})).toBeNull();
  });
});

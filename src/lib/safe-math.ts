// Safe input & output handling, front 4: the website calculator sections evaluate a formula that a model wrote. That used to be
// `new Function(...)`, which is the only reason the page's content security policy had to allow 'unsafe-eval' (and the character filter in
// front of it still let calls like alert(1) through). This is a small arithmetic parser instead: numbers, the section's own variables,
// + - * / % ** , unary minus, parentheses, and a short list of Math helpers. Anything else is "no result", never code.

const FUNCS: Record<string, (...a: number[]) => number> = {
  round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt, min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS: Record<string, number> = { PI: Math.PI, E: Math.E };

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) return null;
      out.push({ t: "num", v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))!; out.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
    if (src.startsWith("**", i)) { out.push({ t: "op", v: "**" }); i += 2; continue; }
    if ("+-*/%(),.".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    return null;
  }
  return out;
}

export function safeCalc(formula: string, vars: Record<string, number>): number | null {
  if (!formula || formula.length > 500) return null;
  const toks = tokenize(formula);
  if (!toks) return null;
  let p = 0;
  let steps = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;
  const fail = (): never => { throw new Error("bad formula"); };
  const tick = () => { if (++steps > 2000) fail(); };

  function parseExpr(): number {
    let v = parseTerm();
    while (isOp("+") || isOp("-")) { tick(); const op = (toks[p++] as { v: string }).v; const r = parseTerm(); v = op === "+" ? v + r : v - r; }
    return v;
  }
  function parseTerm(): number {
    let v = parseUnary();
    while (isOp("*") || isOp("/") || isOp("%")) { tick(); const op = (toks[p++] as { v: string }).v; const r = parseUnary(); v = op === "*" ? v * r : op === "/" ? v / r : v % r; }
    return v;
  }
  function parseUnary(): number {
    if (isOp("-")) { p++; return -parseUnary(); }
    if (isOp("+")) { p++; return parseUnary(); }
    return parsePower();
  }
  function parsePower(): number {
    const base = parsePrimary();
    if (isOp("**")) { tick(); p++; return Math.pow(base, parseUnary()); }
    return base;
  }
  function parsePrimary(): number {
    tick();
    const t = toks[p++];
    if (!t) return fail();
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") { const v = parseExpr(); if (!isOp(")")) fail(); p++; return v; }
    if (t.t === "id") {
      if (t.v === "Math") {
        if (!isOp(".")) fail(); p++;
        const n = toks[p++];
        if (!n || n.t !== "id") return fail();
        if (isOp("(")) {
          const f = Object.prototype.hasOwnProperty.call(FUNCS, n.v) ? FUNCS[n.v] : null;
          if (!f) return fail();
          p++;
          const args: number[] = [];
          if (!isOp(")")) { for (;;) { args.push(parseExpr()); if (isOp(",")) { p++; continue; } break; } }
          if (!isOp(")")) fail(); p++;
          if (args.length > 8) fail();
          return f(...args);
        }
        if (Object.prototype.hasOwnProperty.call(CONSTS, n.v)) return CONSTS[n.v];
        return fail();
      }
      // a variable of this section; an unknown name is no result, as it was before
      if (Object.prototype.hasOwnProperty.call(vars, t.v)) return vars[t.v] ?? 0;
      return fail();
    }
    return fail();
  }

  try {
    const v = parseExpr();
    if (p !== toks.length) return null;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch { return null; }
}

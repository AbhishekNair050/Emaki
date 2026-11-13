/**
 * The Emaki expression language.
 *
 * Deliberately tiny and sandboxed: numbers, strings, booleans, declared
 * variables, arithmetic, comparison and boolean logic. The only calls are to
 * functions a game's plugins declare (`@dice.roll(6)`), answered by the
 * runtime; there is no property access and no host-language eval.
 * Expressions are stored in the compiled story as plain JSON trees so any
 * runtime (web, native, console) can evaluate them identically.
 */

export type Value = number | string | boolean;

export type BinOp =
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | 'and' | 'or';

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'var'; name: string }
  | { k: 'un'; op: '-' | 'not'; e: Expr }
  | { k: 'bin'; op: BinOp; l: Expr; r: Expr }
  /** `@dice.roll(6)`: a function from one of the game's plugins. */
  | { k: 'call'; plugin: string; fn: string; args: Expr[] };

/** Answers plugin function calls while evaluating; throws to report a problem. */
export type CallPlugin = (plugin: string, fn: string, args: Value[]) => Value;

export class ExprError extends Error {
  /** 0-based column within the expression source. */
  col: number;
  constructor(message: string, col: number) {
    super(message);
    this.name = 'ExprError';
    this.col = col;
  }
}

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'fn'; plugin: string; fn: string; pos: number }
  | { t: 'eof'; pos: number };

const OPS = ['==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%', '(', ')', ','];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      toks.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      const { value, end } = readQuoted(src, i);
      toks.push({ t: 'str', v: value, pos: i });
      i = end;
      continue;
    }
    if (c === '@') {
      const m = /^@([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?=\s*\()/.exec(src.slice(i));
      if (!m) {
        const name = /^@([A-Za-z_]\w*)/.exec(src.slice(i))?.[1] ?? 'plugin';
        throw new ExprError(`Call a plugin's function as @${name}.function(...), like @dice.roll(6)`, i);
      }
      toks.push({ t: 'fn', plugin: m[1]!, fn: m[2]!, pos: i });
      i += m[0].length;
      continue;
    }
    if (src.startsWith('&&', i) || src.startsWith('||', i)) {
      throw new ExprError(`Use 'and' / 'or' instead of '${src.slice(i, i + 2)}'`, i);
    }
    if (c === '!' && src[i + 1] !== '=') {
      throw new ExprError(`Use 'not' instead of '!'`, i);
    }
    if (c === '=' && src[i + 1] !== '=') {
      throw new ExprError(`'=' is assignment; use '==' to compare`, i);
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected character '${c}'`, i);
    toks.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  toks.push({ t: 'eof', pos: src.length });
  return toks;
}

/**
 * Read a double-quoted string starting at `start` (which must be a quote).
 * Supports \" \\ \n escapes. Any other backslash sequence is kept as written
 * (e.g. `\*`), so text-styling escapes survive quoting. Shared with the
 * script parser.
 */
export function readQuoted(src: string, start: number): { value: string; end: number } {
  let out = '';
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      if (n === 'n') out += '\n';
      else if (n === undefined) break;
      else if (n === '"' || n === '\\') out += n;
      else out += '\\' + n;
      i += 2;
      continue;
    }
    if (c === '"') return { value: out, end: i + 1 };
    out += c;
    i++;
  }
  throw new ExprError('Unterminated string (missing closing ")', start);
}

const BIN_PREC: Record<string, number> = {
  or: 1,
  and: 2,
  '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

const RESERVED = new Set(['and', 'or', 'not', 'true', 'false']);

export function parseExpr(src: string): Expr {
  if (!src.trim()) throw new ExprError('Expected an expression', 0);
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  function binOpOf(t: Tok): string | null {
    if (t.t === 'op' && t.v in BIN_PREC) return t.v;
    if (t.t === 'id' && (t.v === 'and' || t.v === 'or')) return t.v;
    return null;
  }

  function parsePrefix(): Expr {
    const t = next();
    switch (t.t) {
      case 'num': return { k: 'num', v: t.v };
      case 'str': return { k: 'str', v: t.v };
      case 'id':
        if (t.v === 'true') return { k: 'bool', v: true };
        if (t.v === 'false') return { k: 'bool', v: false };
        if (t.v === 'not') return { k: 'un', op: 'not', e: parse(3) };
        if (RESERVED.has(t.v)) throw new ExprError(`Unexpected '${t.v}'`, t.pos);
        return { k: 'var', name: t.v };
      case 'fn': {
        next(); // (
        const args: Expr[] = [];
        if (!(peek().t === 'op' && (peek() as { v: string }).v === ')')) {
          for (;;) {
            args.push(parse(0));
            const sep = next();
            if (sep.t === 'op' && sep.v === ')') break;
            if (sep.t !== 'op' || sep.v !== ',') throw new ExprError(`Expected ',' or ')' in @${t.plugin}.${t.fn}(...)`, sep.pos);
          }
        } else next();
        return { k: 'call', plugin: t.plugin, fn: t.fn, args };
      }
      case 'op':
        if (t.v === '-') return { k: 'un', op: '-', e: parse(7) };
        if (t.v === '(') {
          const e = parse(0);
          const close = next();
          if (close.t !== 'op' || close.v !== ')') throw new ExprError(`Expected ')'`, close.pos);
          return e;
        }
        throw new ExprError(`Unexpected '${t.v}'`, t.pos);
      case 'eof':
        throw new ExprError('Expression ended unexpectedly', t.pos);
    }
  }

  function parse(minPrec: number): Expr {
    let left = parsePrefix();
    for (;;) {
      const op = binOpOf(peek());
      if (!op) break;
      const prec = BIN_PREC[op];
      if (prec <= minPrec) break;
      next();
      const right = parse(prec);
      left = { k: 'bin', op: op as BinOp, l: left, r: right };
    }
    return left;
  }

  const e = parse(0);
  const rest = peek();
  if (rest.t !== 'eof') {
    const shown = rest.t === 'str' ? `"${rest.v}"` : rest.t === 'fn' ? `@${rest.plugin}.${rest.fn}` : String(rest.v);
    throw new ExprError(`Unexpected '${shown}' after expression`, rest.pos);
  }
  return e;
}

/** Names of all variables referenced by an expression. */
export function freeVars(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.k) {
    case 'var': out.add(e.name); break;
    case 'un': freeVars(e.e, out); break;
    case 'bin': freeVars(e.l, out); freeVars(e.r, out); break;
    case 'call': for (const a of e.args) freeVars(a, out); break;
    default: break;
  }
  return out;
}

/** Every plugin function call in an expression, outermost first. */
export function pluginCalls(e: Expr, out: Array<Extract<Expr, { k: 'call' }>> = []): Array<Extract<Expr, { k: 'call' }>> {
  switch (e.k) {
    case 'un': pluginCalls(e.e, out); break;
    case 'bin': pluginCalls(e.l, out); pluginCalls(e.r, out); break;
    case 'call': out.push(e); for (const a of e.args) pluginCalls(a, out); break;
    default: break;
  }
  return out;
}

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalError';
  }
}

export function truthy(v: Value): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v.length > 0;
}

/**
 * Evaluate an expression. `call` answers plugin functions; without it (when
 * compiling, or where no plugins run) a call is an error.
 */
export function evaluate(e: Expr, vars: Readonly<Record<string, Value>>, call?: CallPlugin): Value {
  const ev = (x: Expr) => evaluate(x, vars, call);
  switch (e.k) {
    case 'num': case 'str': case 'bool': return e.v;
    case 'var': {
      if (!Object.prototype.hasOwnProperty.call(vars, e.name)) {
        throw new EvalError(`Unknown variable '${e.name}'`);
      }
      return vars[e.name];
    }
    case 'call': {
      if (!call) throw new EvalError(`@${e.plugin}.${e.fn}(...) can't be used here`);
      const args = e.args.map(ev);
      let v: unknown;
      try {
        v = call(e.plugin, e.fn, args);
      } catch (err) {
        throw new EvalError(`@${e.plugin}.${e.fn} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string' && typeof v !== 'boolean') {
        throw new EvalError(`@${e.plugin}.${e.fn} should give a number, text or true/false (it gave ${v === null ? 'null' : typeof v})`);
      }
      return v as Value;
    }
    case 'un': {
      const v = ev(e.e);
      if (e.op === 'not') return !truthy(v);
      return -num(v, '-');
    }
    case 'bin': {
      if (e.op === 'and') return truthy(ev(e.l)) && truthy(ev(e.r));
      if (e.op === 'or') return truthy(ev(e.l)) || truthy(ev(e.r));
      const l = ev(e.l);
      const r = ev(e.r);
      switch (e.op) {
        case '+':
          if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r);
          return num(l, '+') + num(r, '+');
        case '-': return num(l, '-') - num(r, '-');
        case '*': return num(l, '*') * num(r, '*');
        case '/': {
          const d = num(r, '/');
          if (d === 0) throw new EvalError('Division by zero');
          return num(l, '/') / d;
        }
        case '%': {
          const d = num(r, '%');
          if (d === 0) throw new EvalError('Division by zero');
          return num(l, '%') % d;
        }
        case '==': return l === r;
        case '!=': return l !== r;
        case '<': case '<=': case '>': case '>=': {
          if (typeof l !== typeof r || typeof l === 'boolean') {
            throw new EvalError(`Cannot compare ${typeof l} with ${typeof r} using '${e.op}'`);
          }
          if (e.op === '<') return l < r;
          if (e.op === '<=') return l <= r;
          if (e.op === '>') return l > r;
          return l >= r;
        }
      }
    }
  }
}

function num(v: Value, op: string): number {
  if (typeof v !== 'number') throw new EvalError(`'${op}' needs numbers, got ${typeof v}`);
  return v;
}

/** Print an expression back to source (used by the formatter). */
export function printExpr(e: Expr, parentPrec = 0): string {
  switch (e.k) {
    case 'num': return String(e.v);
    case 'str': return JSON.stringify(e.v);
    case 'bool': return String(e.v);
    case 'var': return e.name;
    case 'call': return `@${e.plugin}.${e.fn}(${e.args.map((a) => printExpr(a)).join(', ')})`;
    case 'un': {
      const s = e.op === 'not' ? `not ${printExpr(e.e, 3)}` : `-${printExpr(e.e, 7)}`;
      const prec = e.op === 'not' ? 3 : 7;
      return prec < parentPrec ? `(${s})` : s;
    }
    case 'bin': {
      const prec = BIN_PREC[e.op];
      const s = `${printExpr(e.l, prec)} ${e.op} ${printExpr(e.r, prec + 1)}`;
      return prec < parentPrec ? `(${s})` : s;
    }
  }
}

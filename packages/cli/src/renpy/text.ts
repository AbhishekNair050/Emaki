/**
 * Ren'Py's strings, say text and Python expressions, in Emaki's terms. Anything outside the common subset comes
 * back as null (or with notes) so the importer can report it instead of guessing.
 */
import { KEYWORDS } from '@emaki/format';

/** A Python string literal at `start` (any quote, triple quotes, r/u/b prefixes): its value and where it ends. */
export function readString(src: string, start: number): { value: string; end: number } | null {
  let i = start;
  let raw = false;
  while (i < src.length && /[rRuUbBfF]/.test(src[i]!) && i - start < 2) { if (/[rR]/.test(src[i]!)) raw = true; i++; }
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  const quote = src.startsWith(q.repeat(3), i) ? q.repeat(3) : q;
  i += quote.length;
  let value = '';
  while (i < src.length) {
    if (src.startsWith(quote, i)) return { value, end: i + quote.length };
    const c = src[i]!;
    if (c === '\\' && !raw && i + 1 < src.length) {
      const n = src[i + 1]!;
      value += n === 'n' ? '\n' : n === 't' ? '\t' : n === '\n' ? '' : n === '"' || n === "'" || n === '\\' ? n : n === ' ' ? ' ' : '\\' + n;
      i += 2;
      continue;
    }
    value += c;
    i++;
  }
  return null;
}

/** Ren'Py collapses the whitespace in say strings (line breaks in the script included) to single spaces. */
export function sayWhitespace(s: string): string {
  return s.replace(/[ \t\n\r]+/g, ' ').trim();
}

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A Ren'Py name as an Emaki identifier: other characters become _, a leading digit gets _ before it, keywords get _ after. */
export function ident(name: string): string {
  let s = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!s) s = '_';
  if (/^[0-9]/.test(s)) s = '_' + s;
  if (KEYWORDS.has(s)) s += '_';
  return s;
}

/** A Ren'Py variable name (`persistent.seen` included) as an Emaki variable, or null for other dotted names. */
export function varName(name: string): string | null {
  const m = /^persistent\.([A-Za-z_]\w*)$/.exec(name);
  if (m) return `persistent_${m[1]}`;
  if (name.startsWith('store.')) return varName(name.slice('store.'.length));
  return IDENT.test(name) ? ident(name) : null;
}

/** An Emaki string literal. */
export function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export interface TextResult {
  /** Emaki styled text (unquoted). */
  text: string;
  /** Variables the text shows. */
  vars: string[];
  /** Text tags and interpolations that had no Emaki equivalent (dropped or kept as text). */
  dropped: string[];
}

/** Escape what Emaki's styling would read as markup. */
function plain(s: string): string {
  return s.replace(/[\\*[\]#]/g, (c) => `\\${c}`);
}

/**
 * Say text (a string's value) in Emaki's styling: `{i}` → `*`, `{b}` → `**`, `{color=}` → `[color=]`, `{w}` → `[w]`,
 * `{nw}` at the end → `[nw]`, `{rb}{rt}` → `[ruby=]`, `[var]` → `{var}`. Other tags are dropped and listed.
 */
export function convertText(value: string): TextResult {
  const vars: string[] = [];
  const dropped: string[] = [];
  let out = '';
  let i = 0;
  let ruby: { base: string } | null = null;
  const s = value;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '[' && s[i + 1] === '[') { out += plain('['); i += 2; continue; }
    if (c === '{' && s[i + 1] === '{') { out += '{{'; i += 2; continue; }
    if (c === '}' ) { out += '}}'; i++; continue; }
    if (c === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) { out += plain(c); i++; continue; }
      const inner = s.slice(i + 1, end);
      const name = varName(inner.replace(/![a-z]+$/i, '').replace(/:[^:]*$/, '').trim());
      if (name) { out += `{${name}}`; vars.push(name); } else { out += plain(`[${inner}]`); dropped.push(`[${inner}]`); }
      i = end + 1;
      continue;
    }
    if (c === '{') {
      const end = s.indexOf('}', i);
      if (end < 0) { out += '{{'; i++; continue; }
      const tag = s.slice(i + 1, end).trim();
      i = end + 1;
      const [nameRaw, arg] = tag.split('=', 2) as [string, string | undefined];
      const name = nameRaw.trim().toLowerCase();
      if (name === 'i' || name === '/i') out += '*';
      else if (name === 'b' || name === '/b') out += '**';
      else if (name === 'color' && arg && /^#?[0-9a-f]{3,8}$/i.test(arg.trim())) out += `[color=${arg.trim().startsWith('#') ? arg.trim() : '#' + arg.trim()}]`;
      else if (name === '/color') out += '[/color]';
      else if (name === 'w') out += arg ? `[w=${Number(arg)}]` : '[w]';
      else if (name === 'p') out += arg ? `[w=${Number(arg)}] ` : '[w] ';
      else if (name === 'nw') { if (s.slice(i).trim() === '') out += '[nw]'; else dropped.push('{nw}'); }
      else if (name === 'rb') { ruby = { base: '' }; out += '\u0000'; }
      else if (name === '/rb') { /* base ends at {rt} */ }
      else if (name === 'rt' && ruby) {
        const close = s.indexOf('{/rt}', i);
        const reading = close >= 0 ? s.slice(i, close) : '';
        const at = out.lastIndexOf('\u0000');
        out = `${out.slice(0, at)}[ruby=${plain(reading)}]${out.slice(at + 1)}[/ruby]`;
        i = close >= 0 ? close + '{/rt}'.length : i;
        ruby = null;
      } else if (name === '/rt') { /* handled with {rt} */ }
      else if (name === 'fast' || name === 'done' || name === 'clear') dropped.push(`{${tag}}`);
      else dropped.push(`{${tag}}`);
      continue;
    }
    out += plain(c);
    i++;
  }
  return { text: out.replace(/\u0000/g, ''), vars, dropped };
}

// ---------------------------------------------------------------- expressions

type Tok = { t: 'num' | 'str' | 'name' | 'op'; v: string };

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.\d*|\.\d+|\d+)/.exec(src.slice(i));
    if (num) { toks.push({ t: 'num', v: num[1]! }); i += num[1]!.length; continue; }
    if (/[rRuU]?["'`]/.test(src.slice(i, i + 2)) && (c === '"' || c === "'" || /["'`]/.test(src[i + 1] ?? ''))) {
      const s = readString(src, i);
      if (!s) return null;
      toks.push({ t: 'str', v: s.value });
      i = s.end;
      continue;
    }
    const name = /^[A-Za-z_][\w]*(\.[A-Za-z_]\w*)*/.exec(src.slice(i));
    if (name) { toks.push({ t: 'name', v: name[0] }); i += name[0].length; continue; }
    const op = /^(==|!=|<=|>=|\/\/|\*\*|[-+*/%<>()])/.exec(src.slice(i));
    if (op) { toks.push({ t: 'op', v: op[1]! }); i += op[1]!.length; continue; }
    return null;
  }
  return toks;
}

/**
 * A Python expression in Emaki's expression language, with the variables it reads, or null when it uses something
 * Emaki doesn't have (calls, attributes other than `persistent.x`, `None`, `in`, `//`...).
 */
export function convertExpr(src: string): { expr: string; vars: string[] } | null {
  const toks = tokenize(src.trim());
  if (!toks || !toks.length) return null;
  const vars: string[] = [];
  const parts: string[] = [];
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]!;
    if (tok.t === 'num') parts.push(tok.v.startsWith('.') ? '0' + tok.v : tok.v.endsWith('.') ? tok.v.slice(0, -1) : tok.v);
    else if (tok.t === 'str') parts.push(quote(tok.v));
    else if (tok.t === 'op') {
      if (tok.v === '//' || tok.v === '**') return null;
      parts.push(tok.v);
    } else {
      const v = tok.v;
      if (v === 'True') parts.push('true');
      else if (v === 'False') parts.push('false');
      else if (v === 'and' || v === 'or' || v === 'not') parts.push(v);
      else if (v === 'None' || v === 'in' || v === 'is' || v === 'lambda' || v === 'if' || v === 'else') return null;
      else {
        // A call or an index is Python Emaki can't run.
        if (toks[k + 1]?.v === '(' ) return null;
        const name = varName(v);
        if (!name) return null;
        vars.push(name);
        parts.push(name);
      }
    }
  }
  // Re-join with spaces, but no space after an opening or before a closing bracket, nor in a sign.
  let expr = '';
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]!;
    const prev = parts[k - 1];
    if (k > 0 && p !== ')' && prev !== '(' && !(prev === '-' && (k === 1 || ['(', '==', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', 'and', 'or', 'not'].includes(parts[k - 2]!)))) expr += ' ';
    expr += p;
  }
  return { expr, vars };
}

/** A literal's Emaki value and its kind, for a variable's starting value. */
export function literal(src: string): { value: string; kind: 'number' | 'string' | 'bool' } | null {
  const s = src.trim();
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return { value: String(Number(s)), kind: 'number' };
  if (s === 'True' || s === 'False') return { value: s === 'True' ? 'true' : 'false', kind: 'bool' };
  const str = readString(s, 0);
  if (str && str.end === s.length) return { value: quote(str.value), kind: 'string' };
  // _("text"): a translatable string.
  const tr = /^_\((.*)\)$/.exec(s);
  if (tr) { const inner = readString(tr[1]!.trim(), 0); if (inner && inner.end === tr[1]!.trim().length) return { value: quote(inner.value), kind: 'string' }; }
  return null;
}

/** The arguments of a call `Name(a, b, key=value)`: positional and keyword sources, split at top-level commas. */
export function callArgs(src: string): { name: string; args: string[]; kwargs: Record<string, string> } | null {
  const m = /^([A-Za-z_][\w.]*)\s*\(([\s\S]*)\)$/.exec(src.trim());
  if (!m) return null;
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  const inner = m[2]!;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === '"' || c === "'") {
      const s = readString(inner, i);
      if (!s) return null;
      cur += inner.slice(i, s.end);
      i = s.end - 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  const args: string[] = [];
  const kwargs: Record<string, string> = {};
  for (const p of parts) {
    const kw = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(p);
    if (kw) kwargs[kw[1]!] = kw[2]!;
    else args.push(p);
  }
  return { name: m[1]!, args, kwargs };
}

/** The string value of a literal (`"a"`, `_("a")`), or null. */
export function stringValue(src: string | undefined): string | null {
  if (src === undefined) return null;
  const s = src.trim();
  const tr = /^_\(([\s\S]*)\)$/.exec(s);
  const body = tr ? tr[1]!.trim() : s;
  const r = readString(body, 0);
  return r && r.end === body.length ? r.value : null;
}

/** A number literal's value, or null. */
export function numberValue(src: string | undefined): number | null {
  if (src === undefined) return null;
  const s = src.trim();
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
}

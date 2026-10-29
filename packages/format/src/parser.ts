/**
 * Parser for `.vn` scripts: source text -> AST + diagnostics.
 *
 * The parser never throws on bad input. It records a diagnostic, skips the
 * offending line, and keeps going, so the editor can show every problem at
 * once.
 */
import type {
  AchievementDef,
  AssetRef, AudioDef, Channel, CharacterDef, Choice, Diagnostic, IfBranch, ImageDef, LabelDef, Program, Stmt,
  Trivia, VarDef,
} from './ast.ts';
import { ExprError, parseExpr, readQuoted, type Expr } from './expr.ts';

interface Line {
  indent: number;
  text: string;
  line: number;
  children: Line[];
  /** Comments ("# ...") and blank lines ("") directly above this line. */
  leading: string[];
}

export const KEYWORDS = new Set([
  'define', 'image', 'audio', 'var', 'global', 'label', 'achievement', 'achieve',
  'scene', 'show', 'hide', 'play', 'stop', 'set', 'jump', 'call', 'return', 'end',
  'wait', 'menu', 'if', 'elif', 'else', 'with', 'at', 'nvl',
]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CHANNELS: Channel[] = ['music', 'sound', 'voice'];

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

export function parse(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const err = (line: number, code: string, message: string) =>
    diagnostics.push({ severity: 'error', line, code, message });

  const program: Program = { meta: [], characters: [], images: [], audio: [], vars: [], achievements: [], labels: [] };
  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');

  // --- Frontmatter -------------------------------------------------------
  let start = 0;
  while (start < rawLines.length && rawLines[start].trim() === '') start++;
  if (rawLines[start]?.trim() === '---') {
    let i = start + 1;
    for (; i < rawLines.length && rawLines[i].trim() !== '---'; i++) {
      const t = rawLines[i].trim();
      if (!t || t.startsWith('#')) continue;
      const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(t);
      if (!m) err(i + 1, 'bad-frontmatter', `Expected 'key: value' in the header`);
      else program.meta.push([m[1], unquote(m[2].trim())]);
    }
    if (i >= rawLines.length) err(start + 1, 'bad-frontmatter', `Header opened with '---' but never closed`);
    start = i + 1;
  }

  // --- Build an indentation tree ----------------------------------------
  // Comments and blank lines are collected and attached to the next real line
  // (consecutive blank lines collapse into one).
  const root: Line = { indent: -1, text: '', line: 0, children: [], leading: [] };
  const stack: Line[] = [root];
  let pending: string[] = [];
  for (let i = start; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (pending[pending.length - 1] !== '') pending.push('');
      continue;
    }
    if (trimmed.startsWith('#')) {
      pending.push(trimmed);
      continue;
    }
    const lead = /^[ \t]*/.exec(raw)![0];
    if (lead.includes('\t')) err(i + 1, 'tab-indent', 'Use spaces for indentation, not tabs');
    const indent = lead.replace(/\t/g, '    ').length;
    const node: Line = { indent, text: trimmed, line: i + 1, children: [], leading: pending };
    pending = [];
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  // --- Top level ---------------------------------------------------------
  for (const ln of root.children) parseTopLevel(ln);
  const trailing = trimBlanks(pending);
  if (trailing.length) program.trailing = trailing;

  return { program, diagnostics };

  // ======================================================================

  function parseTopLevel(ln: Line): void {
    const t = ln.text;
    const word = firstWord(t);

    if (word === 'label') {
      const m = /^label\s+([A-Za-z_]\w*)\s*:$/.exec(t);
      if (!m) { err(ln.line, 'bad-label', `Expected 'label name:'`); return; }
      if (ln.children.length === 0) err(ln.line, 'empty-block', `Label '${m[1]}' has no lines`);
      const label: LabelDef = { name: m[1], body: parseBlock(ln.children), loc: { line: ln.line } };
      program.labels.push(attach(label, ln, true));
      return;
    }

    noChildren(ln);

    if (word === 'define') {
      const m = /^define\s+([A-Za-z_]\w*)\s+(".*)$/.exec(t);
      if (!m) { err(ln.line, 'bad-define', `Expected 'define id "Display Name"'`); return; }
      const q = safeQuoted(m[2], ln.line);
      if (!q) return;
      let color: string | null = null;
      for (const opt of q.rest.split(/\s+/).filter(Boolean)) {
        const om = /^color=(#[0-9A-Fa-f]{3,8})$/.exec(opt);
        if (om) color = om[1];
        else err(ln.line, 'bad-define', `Unknown option '${opt}' (supported: color=#rrggbb)`);
      }
      if (KEYWORDS.has(m[1])) { err(ln.line, 'reserved-name', `'${m[1]}' is a keyword and can't be a character id`); return; }
      program.characters.push(attach<CharacterDef>({ id: m[1], name: q.value, color, loc: { line: ln.line } }, ln, program.characters.length === 0));
      return;
    }

    if (word === 'image' || word === 'audio') {
      const m = /^(?:image|audio)\s+([^=]+?)\s*=\s*(".*)$/.exec(t);
      if (!m) { err(ln.line, `bad-${word}`, `Expected '${word} name = "path"'`); return; }
      const q = safeQuoted(m[2], ln.line);
      if (!q) return;
      if (q.rest) err(ln.line, `bad-${word}`, `Unexpected text after path: '${q.rest}'`);
      const name = m[1].trim().split(/\s+/).join(' ');
      if (!name.split(' ').every((p) => IDENT.test(p))) {
        err(ln.line, `bad-${word}`, `Names may only use letters, digits and _`);
        return;
      }
      const list = word === 'image' ? program.images : program.audio;
      list.push(attach<ImageDef | AudioDef>({ name, path: q.value, loc: { line: ln.line } }, ln, list.length === 0));
      return;
    }

    if (word === 'var' || word === 'global') {
      const m = /^(global\s+)?var\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(t);
      if (!m) { err(ln.line, 'bad-var', word === 'global' ? `Expected 'global var name = value'` : `Expected 'var name = value'`); return; }
      const e = safeExpr(m[3], ln.line);
      const def: VarDef = { name: m[2], init: e!, ...(m[1] ? { global: true } : {}), loc: { line: ln.line } };
      if (e) program.vars.push(attach<VarDef>(def, ln, program.vars.length === 0));
      return;
    }

    if (word === 'achievement') {
      const m = /^achievement\s+([A-Za-z_]\w*)\s+(".*)$/.exec(t);
      if (!m) { err(ln.line, 'bad-achievement', `Expected 'achievement id "Name"', e.g. achievement first_light "First Light"`); return; }
      const q = safeQuoted(m[2], ln.line);
      if (!q) return;
      if (q.rest) err(ln.line, 'bad-achievement', `Unexpected text after the name: '${q.rest}'`);
      if (KEYWORDS.has(m[1])) { err(ln.line, 'reserved-name', `'${m[1]}' is a keyword and can't be an achievement id`); return; }
      program.achievements.push(attach<AchievementDef>({ id: m[1], name: q.value, loc: { line: ln.line } }, ln, program.achievements.length === 0));
      return;
    }

    err(ln.line, 'bad-toplevel',
      `Only define, image, audio, var, achievement and label can appear at the top level. Indent story lines under a label.`);
  }

  function parseBlock(lines: Line[]): Stmt[] {
    const out: Stmt[] = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const word = firstWord(ln.text);

      if (word === 'if') {
        const branches: IfBranch[] = [];
        const first = parseBranchHeader(ln, 'if');
        if (first) branches.push(first);
        while (i + 1 < lines.length) {
          const nw = firstWord(lines[i + 1].text);
          if (nw !== 'elif' && nw !== 'else') break;
          i++;
          const b = parseBranchHeader(lines[i], nw);
          if (b) branches.push(b);
          if (nw === 'else') break;
        }
        if (branches.length) out.push(attach<Stmt>({ type: 'if', branches, loc: { line: ln.line } }, ln, out.length === 0));
        continue;
      }
      if (word === 'elif' || word === 'else') {
        err(ln.line, 'orphan-branch', `'${word}' without a matching 'if' above it`);
        continue;
      }

      const s = parseStmt(ln);
      if (s) out.push(attach(s, ln, out.length === 0));
    }
    return out;
  }

  function parseBranchHeader(ln: Line, kind: 'if' | 'elif' | 'else'): IfBranch | null {
    let cond: Expr | null = null;
    if (kind === 'else') {
      if (!/^else\s*:$/.test(ln.text)) { err(ln.line, 'bad-if', `Expected 'else:'`); return null; }
    } else {
      const m = new RegExp(`^${kind}\\s+(.+):$`).exec(ln.text);
      if (!m) { err(ln.line, 'bad-if', `Expected '${kind} condition:'`); return null; }
      cond = safeExpr(m[1], ln.line);
      if (!cond) return null;
    }
    if (ln.children.length === 0) err(ln.line, 'empty-block', `'${kind}' needs indented lines under it`);
    const branch: IfBranch = { cond, body: parseBlock(ln.children), loc: { line: ln.line } };
    // The first branch's comments belong to the `if` statement itself.
    return kind === 'if' ? branch : attach(branch, ln, false);
  }

  function parseStmt(ln: Line): Stmt | null {
    const t = ln.text;
    const loc = { line: ln.line };
    const word = firstWord(t);

    if (word === 'menu') {
      if (!/^menu\s*:$/.test(t)) { err(ln.line, 'bad-menu', `Expected 'menu:'`); return null; }
      const choices: Choice[] = [];
      for (const c of ln.children) {
        const ch = parseChoice(c);
        if (ch) choices.push(attach(ch, c, choices.length === 0));
      }
      // Only complain if there were no choice lines at all; a broken choice already has its own error.
      if (ln.children.length === 0) err(ln.line, 'empty-menu', 'Menu has no choices');
      return { type: 'menu', choices, loc };
    }

    if (word === 'label') {
      err(ln.line, 'nested-label', 'Labels must be at the top level (no indentation)');
      return null;
    }

    noChildren(ln);

    // Narration: a bare quoted string.
    if (t.startsWith('"')) {
      const q = safeQuoted(t, ln.line);
      if (!q) return null;
      if (q.rest) { err(ln.line, 'bad-say', `Unexpected text after the closing quote: '${q.rest}'`); return null; }
      return { type: 'say', who: null, attrs: [], text: q.value, loc };
    }

    if (word && KEYWORDS.has(word)) return parseCommand(word, t, ln);

    // Dialogue: `who [attr ...]: text`
    const m = /^([A-Za-z_]\w*)((?:\s+[A-Za-z_]\w*)*)\s*:\s*(.*)$/.exec(t);
    if (m) {
      let text = m[3].trim();
      if (!text) {
        err(ln.line, 'bad-say', `'${m[1]}:' has no dialogue after the colon (or is this a typo of a statement?)`);
        return null;
      }
      if (text.startsWith('"')) {
        const q = safeQuoted(text, ln.line);
        if (q && !q.rest) text = q.value;
      }
      const attrs = m[2].trim() ? m[2].trim().split(/\s+/) : [];
      return { type: 'say', who: m[1], attrs, text, loc };
    }

    err(ln.line, 'unknown-statement', `I don't understand this line. Dialogue looks like 'name: text', narration like "text".`);
    return null;
  }

  function parseCommand(word: string, t: string, ln: Line): Stmt | null {
    const loc = { line: ln.line };
    const args = t.slice(word.length).trim();

    switch (word) {
      case 'scene': {
        const { words, transition, duration } = splitWith(args, ln.line);
        if (words.includes('at')) err(ln.line, 'bad-scene', `'scene' doesn't take 'at'`);
        return { type: 'scene', image: words.length ? words.join(' ') : null, transition, ...(duration !== undefined ? { duration } : {}), loc };
      }
      case 'show': {
        const { words, transition, duration } = splitWith(args, ln.line);
        let at: string | null = null;
        const atIdx = words.indexOf('at');
        if (atIdx >= 0) {
          at = words[atIdx + 1] ?? null;
          if (!at) err(ln.line, 'bad-show', `'at' needs a position (left, center, right)`);
          if (words.length > atIdx + 2) err(ln.line, 'bad-show', `Unexpected '${words.slice(atIdx + 2).join(' ')}'`);
          words.splice(atIdx);
        }
        if (words.length === 0) { err(ln.line, 'bad-show', `'show' needs an image, e.g. 'show mira smile'`); return null; }
        if (!words.every((w) => IDENT.test(w))) { err(ln.line, 'bad-show', `Image names may only use letters, digits and _`); return null; }
        return { type: 'show', tag: words[0], attrs: words.slice(1), at, transition, ...(duration !== undefined ? { duration } : {}), loc };
      }
      case 'hide': {
        const { words, transition, duration } = splitWith(args, ln.line);
        if (words.length !== 1) { err(ln.line, 'bad-hide', `Expected 'hide name'`); return null; }
        return { type: 'hide', tag: words[0], transition, ...(duration !== undefined ? { duration } : {}), loc };
      }
      case 'play': {
        const m = /^(\w+)\s+(.+)$/.exec(args);
        if (!m || !CHANNELS.includes(m[1] as Channel)) {
          err(ln.line, 'bad-play', `Expected 'play music|sound|voice name'`);
          return null;
        }
        let rest = m[2].trim();
        let asset: AssetRef;
        if (rest.startsWith('"')) {
          const q = safeQuoted(rest, ln.line);
          if (!q) return null;
          asset = { kind: 'path', path: q.value };
          rest = q.rest;
        } else {
          const [name, ...more] = rest.split(/\s+/);
          asset = { kind: 'name', name };
          rest = more.join(' ');
        }
        const opts = parseAudioOpts(rest, ln.line, true);
        if (!opts) return null;
        return { type: 'play', channel: m[1] as Channel, asset, loop: opts.loop, fade: opts.fade, loc };
      }
      case 'stop': {
        const m = /^(\w+)\s*(.*)$/.exec(args);
        if (!m || !CHANNELS.includes(m[1] as Channel)) {
          err(ln.line, 'bad-stop', `Expected 'stop music|sound|voice'`);
          return null;
        }
        const opts = parseAudioOpts(m[2], ln.line, false);
        if (!opts) return null;
        return { type: 'stop', channel: m[1] as Channel, fade: opts.fade, loc };
      }
      case 'set': {
        const m = /^([A-Za-z_]\w*)\s*(\+=|-=|=)\s*(.+)$/.exec(args);
        if (!m) { err(ln.line, 'bad-set', `Expected 'set name = value' (or += / -=)`); return null; }
        const e = safeExpr(m[3], ln.line);
        return e ? { type: 'set', name: m[1], op: m[2] as '=' | '+=' | '-=', expr: e, loc } : null;
      }
      case 'jump':
      case 'call': {
        if (!IDENT.test(args)) { err(ln.line, `bad-${word}`, `Expected '${word} label_name'`); return null; }
        return { type: word, target: args, loc };
      }
      case 'return':
      case 'end':
        if (args) err(ln.line, `bad-${word}`, `'${word}' takes no arguments`);
        return { type: word, loc };
      case 'achieve':
        if (!IDENT.test(args)) { err(ln.line, 'bad-achieve', `Expected 'achieve achievement_id'`); return null; }
        return { type: 'achieve', id: args, loc };
      case 'nvl':
        if (args !== 'on' && args !== 'off' && args !== 'clear') { err(ln.line, 'bad-nvl', `Expected 'nvl on', 'nvl off' or 'nvl clear'`); return null; }
        return { type: 'nvl', mode: args, loc };
      case 'wait': {
        const n = Number(args);
        if (!args || !Number.isFinite(n) || n < 0) { err(ln.line, 'bad-wait', `Expected 'wait seconds', e.g. 'wait 1.5'`); return null; }
        return { type: 'wait', seconds: n, loc };
      }
      default:
        err(ln.line, 'misplaced-keyword', `'${word}' can't be used here`);
        return null;
    }
  }

  function parseChoice(ln: Line): Choice | null {
    if (!ln.text.startsWith('"')) {
      err(ln.line, 'bad-choice', `Menu choices look like: "Choice text":`);
      return null;
    }
    const q = safeQuoted(ln.text, ln.line);
    if (!q) return null;
    let rest = q.rest;
    if (!rest.endsWith(':')) { err(ln.line, 'bad-choice', `A choice must end with ':'`); return null; }
    rest = rest.slice(0, -1).trim();
    let cond: Expr | null = null;
    if (rest) {
      const m = /^if\s+(.+)$/.exec(rest);
      if (!m) { err(ln.line, 'bad-choice', `Unexpected '${rest}' (did you mean 'if condition'?)`); return null; }
      cond = safeExpr(m[1], ln.line);
      if (!cond) return null;
    }
    if (ln.children.length === 0) err(ln.line, 'empty-block', `Choice "${q.value}" has nothing under it`);
    return { text: q.value, cond, body: parseBlock(ln.children), loc: { line: ln.line } };
  }

  // --- helpers ----------------------------------------------------------

  function noChildren(ln: Line): void {
    if (ln.children.length) {
      err(ln.children[0].line, 'unexpected-indent', `Unexpected indentation (the line above doesn't open a block)`);
    }
  }

  /** `... with dissolve` or `... with dissolve 1.5` (seconds). */
  function splitWith(args: string, line: number): { words: string[]; transition: string | null; duration?: number } {
    const words = args.split(/\s+/).filter(Boolean);
    const wi = words.indexOf('with');
    if (wi < 0) return { words, transition: null };
    const transition = words[wi + 1] ?? null;
    if (!transition) err(line, 'bad-transition', `'with' needs a transition name (fade, dissolve)`);
    let rest = words.slice(wi + 2);
    let duration: number | undefined;
    if (rest.length && /^\d+(\.\d+)?$/.test(rest[0]!)) {
      duration = Number(rest[0]);
      if (duration > 30) err(line, 'bad-transition', `${rest[0]} seconds is too long for a transition (30 at most)`);
      rest = rest.slice(1);
    }
    if (rest.length) err(line, 'bad-transition', `Unexpected '${rest.join(' ')}' after the transition (only a duration in seconds can follow, like 'with dissolve 1.5')`);
    return { words: words.slice(0, wi), transition, ...(duration !== undefined ? { duration } : {}) };
  }

  function parseAudioOpts(rest: string, line: number, allowLoop: boolean): { loop: boolean | null; fade: number | null } | null {
    const words = rest.split(/\s+/).filter(Boolean);
    let loop: boolean | null = null;
    let fade: number | null = null;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (allowLoop && (w === 'loop' || w === 'noloop')) loop = w === 'loop';
      else if (w === 'fade') {
        const n = Number(words[++i]);
        if (!Number.isFinite(n) || n < 0) { err(line, 'bad-audio', `'fade' needs seconds, e.g. 'fade 1.0'`); return null; }
        fade = n;
      } else { err(line, 'bad-audio', `Unknown audio option '${w}'`); return null; }
    }
    return { loop, fade };
  }

  function safeQuoted(text: string, line: number): { value: string; rest: string } | null {
    try {
      const { value, end } = readQuoted(text, 0);
      return { value, rest: text.slice(end).trim() };
    } catch (e) {
      err(line, 'bad-string', (e as Error).message);
      return null;
    }
  }

  function safeExpr(src: string, line: number): Expr | null {
    try {
      return parseExpr(src.trim());
    } catch (e) {
      if (e instanceof ExprError) {
        err(line, 'bad-expression', `${e.message} in '${src.trim()}'`);
        return null;
      }
      throw e;
    }
  }
}

/**
 * Copy a line's comments and blank lines onto its AST node. A blank line at
 * the start of a block (or between top-level items, where the printer decides
 * spacing) carries no meaning, so it is dropped; the AST stays canonical.
 */
function attach<T extends Trivia>(node: T, ln: Line, firstInBlock: boolean): T {
  const t = firstInBlock && ln.leading[0] === '' ? ln.leading.slice(1) : ln.leading;
  if (t.length) node.leading = t;
  return node;
}

function trimBlanks(t: string[]): string[] {
  let a = 0;
  let b = t.length;
  while (a < b && t[a] === '') a++;
  while (b > a && t[b - 1] === '') b--;
  return t.slice(a, b);
}

function firstWord(t: string): string {
  return /^[A-Za-z_]\w*/.exec(t)?.[0] ?? '';
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return readQuoted(s, 0).value; } catch { return s; }
  }
  return s;
}

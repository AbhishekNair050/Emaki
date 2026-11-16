/**
 * Parser for `.vn` scripts: source text -> AST + diagnostics.
 *
 * The parser never throws on bad input. It records a diagnostic, skips the
 * offending line, and keeps going, so the editor can show every problem at
 * once.
 */
import type {
  AchievementDef, AnimationDef, AnimationKey, EndingDef, GradeDef,
  AssetRef, AudioDef, Channel, CharacterDef, Choice, Diagnostic, IfBranch, ImageDef, LabelDef, LayerDef, LayeredDef, LayerOption, Program, ReplayDef, ScreenMode, Stmt,
  Motion, Tone, Trivia, VarDef,
} from './ast.ts';
import { ExprError, parseExpr, readQuoted, type Expr } from './expr.ts';
import { TONES } from './ast.ts';
import { SCREEN_TRANSITIONS, parseScreenLine, type ScreenDef, type ScreenItem } from './screens.ts';
import { parsePluginCall } from './plugins.ts';
import { EASES, hasProps, parseGrade, parseLayerProps, type LayerPropsSource } from './layers.ts';

interface Line {
  indent: number;
  text: string;
  line: number;
  children: Line[];
  /** Comments ("# ...") and blank lines ("") directly above this line. */
  leading: string[];
  /** A comment at the end of the line. */
  comment?: string;
}

/**
 * Split a line into its code and an end-of-line comment: a `#` with a space
 * before it and a space (or the line's end) after it, outside quotes, starts
 * a comment. So `mira: Room #4` and `color=#ff0000` are not comments, and
 * `\#` writes a literal # in text.
 */
export function splitComment(text: string): { code: string; comment?: string } {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\') { i++; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && c === '#' && i > 0 && /\s/.test(text[i - 1]!) && (i + 1 === text.length || /\s/.test(text[i + 1]!))) {
      return { code: text.slice(0, i).trimEnd(), comment: text.slice(i).trimEnd() };
    }
  }
  return { code: text };
}

export const KEYWORDS = new Set([
  'define', 'image', 'audio', 'var', 'global', 'label', 'achievement', 'achieve', 'ending', 'layered',
  'scene', 'show', 'hide', 'play', 'stop', 'set', 'jump', 'call', 'return', 'end',
  'wait', 'menu', 'if', 'elif', 'else', 'with', 'at', 'nvl',
]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Statements that aren't keywords: `flash: Hi!` is still a character named flash speaking. */
export const EFFECTS = new Set(['shake', 'flash', 'camera', 'hop', 'nod', 'bow', 'movie', 'float', 'still', 'tone', 'animate', 'textbox']);
/** Words that end a `show`'s image name: its layer's name and properties (D-062). */
const COLOUR_PROPS = new Set(['grade', 'silhouette', 'bright', 'contrast', 'blur']);
const propValue = (k: string, v: string | undefined): boolean =>
  v !== undefined && (k === 'grade' ? /^[A-Za-z_]\w*$/.test(v) : k === 'silhouette' ? /^(#[0-9a-fA-F]{6}|none)$/.test(v) : /^-?\d+(\.\d+)?%?$/.test(v));
const SHOW_PROPS = new Set(['at', 'anchor', 'zoom', 'rotate', 'opacity', 'depth', 'blend', 'clip', 'feather', 'grade', 'silhouette', 'bright', 'contrast', 'blur']);
/** Colours `flash` accepts besides #rgb / #rrggbb. */
export const FLASH_COLORS = ['white', 'black', 'red'];
const SECONDS = /^\d+(\.\d+)?$/;
const PERCENT = /^(\d+(\.\d+)?)%$/;
const CHANNELS: Channel[] = ['music', 'ambience', 'sound', 'voice'];

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

export function parse(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const err = (line: number, code: string, message: string) =>
    diagnostics.push({ severity: 'error', line, code, message });

  const program: Program = { meta: [], characters: [], images: [], audio: [], layered: [], screens: [], vars: [], achievements: [], endings: [], labels: [] };
  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');

  // --- Frontmatter -------------------------------------------------------
  let start = 0;
  while (start < rawLines.length && rawLines[start].trim() === '') start++;
  if (rawLines[start]?.trim() === '---') {
    let i = start + 1;
    let notes: string[] = [];
    for (; i < rawLines.length && rawLines[i].trim() !== '---'; i++) {
      const raw = rawLines[i].trim();
      if (!raw) continue;
      if (raw.startsWith('#')) { notes.push(raw); continue; }
      const { code: t, comment } = splitComment(raw);
      const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(t);
      if (!m) { err(i + 1, 'bad-frontmatter', `Expected 'key: value' in the header`); continue; }
      if (notes.length || comment) {
        (program.metaTrivia ??= {})[program.meta.length] = { ...(notes.length ? { leading: notes } : {}), ...(comment ? { comment } : {}) };
        notes = [];
      }
      program.meta.push([m[1], unquote(m[2].trim())]);
    }
    if (notes.length) program.metaTrailing = notes;
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
    const { code, comment } = splitComment(trimmed);
    const node: Line = { indent, text: code, line: i + 1, children: [], leading: pending, ...(comment ? { comment } : {}) };
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

    if (word === 'layered') {
      parseLayered(ln);
      return;
    }

    if (word === 'animation') {
      parseAnimation(ln);
      return;
    }

    if (word === 'grade') {
      parseGradeDef(ln);
      return;
    }

    if (word === 'screen' && /^screen\s+[A-Za-z_]\w*(\s+with\s+.*)?:$/.test(t)) {
      parseScreen(ln);
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
      const gallery = word === 'image' && q.rest === 'gallery';
      // `audio theme = "..." music "Title"` puts the track in the music room.
      let music: string | undefined;
      if (word === 'audio' && /^music\b/.test(q.rest)) {
        const t2 = q.rest.slice('music'.length).trim();
        const mq = t2.startsWith('"') ? safeQuoted(t2, ln.line) : null;
        if (!mq || mq.rest) { err(ln.line, 'bad-audio', `Expected 'audio name = "path" music "Its Title"'`); return; }
        music = mq.value;
      } else if (q.rest && !gallery) err(ln.line, `bad-${word}`, word === 'image' ? `Unexpected text after path: '${q.rest}' (only 'gallery' can follow)` : `Unexpected text after path: '${q.rest}' (only 'music "Title"' can follow)`);
      const name = m[1].trim().split(/\s+/).join(' ');
      if (!name.split(' ').every((p) => IDENT.test(p))) {
        err(ln.line, `bad-${word}`, `Names may only use letters, digits and _`);
        return;
      }
      const list = word === 'image' ? program.images : program.audio;
      list.push(attach<ImageDef | AudioDef>({ name, path: q.value, ...(gallery ? { gallery: true } : {}), ...(music !== undefined ? { music } : {}), loc: { line: ln.line } }, ln, list.length === 0));
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

    if (word === 'ending') {
      const m = /^ending\s+([A-Za-z_]\w*)\s+(".*)$/.exec(t);
      if (!m) { err(ln.line, 'bad-ending', `Expected 'ending id "Name"', e.g. ending light_holds "The Light Holds"`); return; }
      const q = safeQuoted(m[2], ln.line);
      if (!q) return;
      if (q.rest) err(ln.line, 'bad-ending', `Unexpected text after the name: '${q.rest}'`);
      if (KEYWORDS.has(m[1])) { err(ln.line, 'reserved-name', `'${m[1]}' is a keyword and can't be an ending id`); return; }
      program.endings.push(attach<EndingDef>({ id: m[1], name: q.value, loc: { line: ln.line } }, ln, program.endings.length === 0));
      return;
    }

    if (word === 'replay') {
      const m = /^replay\s+([A-Za-z_]\w*)\s+(".*)$/.exec(t);
      const usage = `Expected 'replay label "Its Name"', with 'image name' and 'until label' after it if needed`;
      if (!m) { err(ln.line, 'bad-replay', usage); return; }
      const q = safeQuoted(m[2], ln.line);
      if (!q) return;
      const def: ReplayDef = { label: m[1], name: q.value, loc: { line: ln.line } };
      const words = q.rest ? q.rest.split(/\s+/) : [];
      while (words.length) {
        const [k, v] = words.splice(0, 2);
        if ((k === 'image' || k === 'until') && v && IDENT.test(v)) def[k] = v;
        else { err(ln.line, 'bad-replay', usage); return; }
      }
      (program.replays ??= []).push(attach<ReplayDef>(def, ln, program.replays.length === 0));
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
      `Only define, image, audio, var, achievement, ending, replay, animation, screen and label can appear at the top level. Indent story lines under a label.`);
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

    if (t.startsWith('@')) {
      const r = parsePluginCall(t);
      if ('error' in r) { err(ln.line, 'bad-plugin', r.error); return null; }
      const into = /^->\s*([A-Za-z_]\w*)$/.exec(r.rest);
      if (r.rest && !into) { err(ln.line, 'bad-plugin', `Unexpected '${r.rest}': arguments are written name=value, and '-> variable' keeps a result`); return null; }
      return { type: 'plugin', call: r.call, ...(into ? { into: into[1]! } : {}), loc };
    }
    if (word && KEYWORDS.has(word)) return parseCommand(word, t, ln);
    // Screen effects aren't reserved words, so a character may still be called `flash`.
    if (word && EFFECTS.has(word) && !/^\w+(\s+\w+)*\s*:/.test(t)) return parseEffect(word, t.slice(word.length).trim(), ln);

    // Dialogue: `who [attr ...]: text`
    const m = /^([A-Za-z_]\w*)((?:\s+-?[A-Za-z_]\w*)*)\s*:\s*(.*)$/.exec(t);
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

  /** `show screen hud`, `hide screen hud`, `call screen map` or `call screen map -> place`. */
  function screenStmt(mode: ScreenMode, args: string, ln: Line): Stmt | null {
    const m = /^screen\s+([A-Za-z_]\w*)(?:\s*->\s*([A-Za-z_]\w*))?$/.exec(args);
    if (!m || (m[2] && mode !== 'call')) {
      err(ln.line, `bad-${mode}`, mode === 'call'
        ? `Expected 'call screen name', or 'call screen name -> variable' to keep what it returns`
        : `Expected '${mode} screen name'`);
      return null;
    }
    return { type: 'screen', mode, name: m[1]!, ...(m[2] ? { into: m[2] } : {}), loc: { line: ln.line } };
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
        if (/^screen(\s|$)/.test(args)) return screenStmt('show', args, ln);
        const { words, transition, duration } = splitWith(args, ln.line);
        // the image's words end at `as` or the first layer property (D-062)
        // (the colour words only when a value follows, so an expression called 'bright' still names the image)
        let end = words.findIndex((w, i) => w === 'as' || (SHOW_PROPS.has(w) && (!COLOUR_PROPS.has(w) || propValue(w, words[i + 1]))));
        if (end < 0) end = words.length;
        const image = words.slice(0, end);
        let rest = words.slice(end);
        let as: string | undefined;
        if (rest[0] === 'as') {
          as = rest[1];
          if (!as || !IDENT.test(as)) { err(ln.line, 'bad-show', `'as' needs a name for the layer, e.g. 'show street as far'`); return null; }
          rest = rest.slice(2);
        }
        let at: string | null = null;
        let props: LayerPropsSource | undefined;
        if (rest.length) {
          const r = parseLayerProps(rest);
          if ('error' in r) { err(ln.line, 'bad-show', r.error); return null; }
          at = r.at ?? null;
          if (hasProps(r.props)) props = r.props;
        }
        if (image.length === 0) { err(ln.line, 'bad-show', `'show' needs an image, e.g. 'show mira smile'`); return null; }
        if (!IDENT.test(image[0]!) || !image.slice(1).every((w) => IDENT.test(w.replace(/^-/, '')))) {
          err(ln.line, 'bad-show', `Image names may only use letters, digits and _`);
          return null;
        }
        return {
          type: 'show', tag: image[0]!, attrs: image.slice(1), ...(as ? { as } : {}), at, ...(props ? { props } : {}),
          transition, ...(duration !== undefined ? { duration } : {}), loc,
        };
      }
      case 'with': {
        // on its own line: the picture changes since the last line, through one transition
        const { words, transition, rule, duration } = splitWith(t, ln.line, true);
        if (words.length || !transition) { err(ln.line, 'bad-with', `Expected 'with dissolve' or 'with dissolve 0.5'`); return null; }
        return { type: 'with', transition, ...(rule ? { rule } : {}), ...(duration !== undefined ? { duration } : {}), loc };
      }
      case 'hide': {
        if (/^screen(\s|$)/.test(args)) return screenStmt('hide', args, ln);
        const { words, transition, duration } = splitWith(args, ln.line);
        if (words.length !== 1) { err(ln.line, 'bad-hide', `Expected 'hide name'`); return null; }
        return { type: 'hide', tag: words[0], transition, ...(duration !== undefined ? { duration } : {}), loc };
      }
      case 'play': {
        const m = /^(\w+)\s+(.+)$/.exec(args);
        if (!m || !CHANNELS.includes(m[1] as Channel)) {
          err(ln.line, 'bad-play', `Expected 'play music|ambience|sound|voice name'`);
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
        // `as rain`: a named ambience loop, so several play at once
        let as: string | undefined;
        const am = /^as\s+(\S+)\s*(.*)$/.exec(rest.trim());
        if (am) {
          if (m[1] !== 'ambience') { err(ln.line, 'bad-play', `Only ambience loops have names ('play ambience rain as rain'), so several can play at once`); return null; }
          if (!IDENT.test(am[1]!)) { err(ln.line, 'bad-play', `'as' needs a name for the loop, like 'as rain'`); return null; }
          as = am[1];
          rest = am[2]!;
        }
        const opts = parseAudioOpts(rest, ln.line, true);
        if (!opts) return null;
        return { type: 'play', channel: m[1] as Channel, asset, loop: opts.loop, fade: opts.fade, ...(as ? { as } : {}), loc };
      }
      case 'stop': {
        const m = /^(\w+)\s*(.*)$/.exec(args);
        if (!m || !CHANNELS.includes(m[1] as Channel)) {
          err(ln.line, 'bad-stop', `Expected 'stop music|ambience|sound|voice'`);
          return null;
        }
        // `stop ambience rain`: one named loop (without a name, the whole channel)
        let restStop = m[2];
        let as: string | undefined;
        const nm = /^([A-Za-z_]\w*)\s*(.*)$/.exec(restStop);
        if (nm && nm[1] !== 'fade') {
          if (m[1] !== 'ambience') { err(ln.line, 'bad-stop', `Only ambience loops have names: 'stop ambience rain'`); return null; }
          as = nm[1];
          restStop = nm[2]!;
        }
        const opts = parseAudioOpts(restStop, ln.line, false);
        if (!opts) return null;
        return { type: 'stop', channel: m[1] as Channel, fade: opts.fade, ...(as ? { as } : {}), loc };
      }
      case 'set': {
        const m = /^([A-Za-z_]\w*)\s*(\+=|-=|=)\s*(.+)$/.exec(args);
        if (!m) { err(ln.line, 'bad-set', `Expected 'set name = value' (or += / -=)`); return null; }
        const e = safeExpr(m[3], ln.line);
        return e ? { type: 'set', name: m[1], op: m[2] as '=' | '+=' | '-=', expr: e, loc } : null;
      }
      case 'jump':
      case 'call': {
        if (word === 'call' && /^screen(\s|$)/.test(args)) return screenStmt('call', args, ln);
        if (!IDENT.test(args)) { err(ln.line, `bad-${word}`, `Expected '${word} label_name'`); return null; }
        return { type: word, target: args, loc };
      }
      case 'return':
        if (args) err(ln.line, 'bad-return', `'return' takes no arguments`);
        return { type: 'return', loc };
      case 'end':
        if (args && !IDENT.test(args)) { err(ln.line, 'bad-end', `Expected 'end' or 'end ending_id'`); return null; }
        return args ? { type: 'end', ending: args, loc } : { type: 'end', loc };
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

  /**
   * layered mira:
   *   always "sprites/mira/body.png"
   *   group face:
   *     neutral "sprites/mira/neutral.png"
   */
  function parseLayered(ln: Line): void {
    const m = /^layered\s+([A-Za-z_]\w*)\s*:$/.exec(ln.text);
    if (!m) { err(ln.line, 'bad-layered', `Expected 'layered name:'`); return; }
    if (!ln.children.length) err(ln.line, 'empty-block', `'layered ${m[1]}' has no layers`);
    const path = (text: string, line: number): string | null => {
      const q = safeQuoted(text, line);
      if (!q) return null;
      if (q.rest) err(line, 'bad-layered', `Unexpected text after the path: '${q.rest}'`);
      return q.value;
    };
    const def: LayeredDef = { tag: m[1], layers: [], loc: { line: ln.line } };
    ln.children.forEach((c, i) => {
      const word = firstWord(c.text);
      if (word === 'always') {
        noChildren(c);
        const p = path(c.text.slice('always'.length).trim(), c.line);
        if (p !== null) def.layers.push(attach<LayerDef>({ kind: 'always', path: p, loc: { line: c.line } }, c, i === 0));
        return;
      }
      if (word !== 'group') { err(c.line, 'bad-layered', `Inside 'layered', write 'always "path"' or 'group name:'`); return; }
      const g = /^group\s+([A-Za-z_]\w*)(\s+optional)?\s*:$/.exec(c.text);
      if (!g) { err(c.line, 'bad-layered', `Expected 'group name:' or 'group name optional:'`); return; }
      if (!c.children.length) err(c.line, 'empty-block', `Group '${g[1]}' has no options`);
      const options: LayerOption[] = [];
      c.children.forEach((o, j) => {
        noChildren(o);
        const om = /^([A-Za-z_]\w*)\s+(".*)$/.exec(o.text);
        if (!om) { err(o.line, 'bad-layered', `Expected an option and its image: 'smile "sprites/mira/smile.png"'`); return; }
        const p = path(om[2], o.line);
        if (p !== null) options.push(attach<LayerOption>({ attr: om[1], path: p, loc: { line: o.line } }, o, j === 0));
      });
      def.layers.push(attach<LayerDef>({ kind: 'group', name: g[1], optional: !!g[2], options, loc: { line: c.line } }, c, i === 0));
    });
    program.layered.push(attach(def, ln, program.layered.length === 0));
  }

  /**
   * `animation drift loop:` and its keys, one per line: seconds, then layer properties, then an optional ease
   * toward the next key (D-062):
   *     0 opacity 0.6
   *     1.5 opacity 1 zoom 1.02 ease in-out-sine
   */
  function parseAnimation(ln: Line): void {
    const m = /^animation\s+([A-Za-z_]\w*)(\s+loop)?\s*:$/.exec(ln.text);
    if (!m) { err(ln.line, 'bad-animation', `Expected 'animation name:' or 'animation name loop:'`); return; }
    if (!ln.children.length) err(ln.line, 'empty-block', `'animation ${m[1]}' has no keys`);
    const def: AnimationDef = { name: m[1]!, loop: !!m[2], keys: [], loc: { line: ln.line } };
    let last = -1;
    ln.children.forEach((c, i) => {
      noChildren(c);
      const words = c.text.split(/\s+/).filter(Boolean);
      const t = words.shift() ?? '';
      if (!SECONDS.test(t)) { err(c.line, 'bad-animation', `A key starts with its time in seconds, like '1.5 opacity 0'`); return; }
      const time = Number(t);
      if (time < last) { err(c.line, 'bad-animation', `Keys go in order of time: ${t} comes after ${last}`); return; }
      last = time;
      let ease: string | null = null;
      const ei = words.indexOf('ease');
      if (ei >= 0) {
        ease = words[ei + 1] ?? '';
        if (!EASES.includes(ease)) { err(c.line, 'bad-animation', `Unknown ease '${ease}' (linear, or in-, out-, in-out- or out-in- with quad, cubic, quart, quint, sine, circ, expo, elastic, back or bounce)`); return; }
        words.splice(ei, 2);
      }
      const r = parseLayerProps(words, true);
      if ('error' in r) { err(c.line, 'bad-animation', r.error); return; }
      def.keys.push(attach<AnimationKey>({ time, props: r.props, ease, loc: { line: c.line } }, c, i === 0));
    });
    (program.animations ??= []).push(attach(def, ln, program.animations.length === 0));
  }

  /** `grade dusk: gamma 0.94 0.78 0.57 levels #000010 #546b90 tint #ff6500 14% overlay` (D-062). */
  function parseGradeDef(ln: Line): void {
    noChildren(ln);
    const m = /^grade\s+([A-Za-z_]\w*)\s*:\s*(.*)$/.exec(ln.text);
    if (!m) { err(ln.line, 'bad-grade', `Expected 'grade name: ...', like 'grade dusk: gamma 0.9 0.8 0.6 tint #ff6500 14% overlay'`); return; }
    if (m[1] === 'none') { err(ln.line, 'bad-grade', `'none' takes a layer's grade off, so it can't be a grade's name`); return; }
    const r = parseGrade(m[2]!.split(/\s+/).filter(Boolean));
    if ('error' in r) { err(ln.line, 'bad-grade', r.error); return; }
    (program.grades ??= []).push(attach<GradeDef>({ name: m[1]!, grade: r, loc: { line: ln.line } }, ln, program.grades.length === 0));
  }

  /**
   * screen title:
   *   image "ui/title.png"
   *   column at 80% 60%:
   *     button "New Game" -> start
   */
  function parseScreen(ln: Line): void {
    const name = /^screen\s+([A-Za-z_]\w*)/.exec(ln.text)![1]!;
    if (!ln.children.length) err(ln.line, 'empty-block', `'screen ${name}' has nothing in it`);
    const items = (lines: Line[]): ScreenItem[] => {
      const out: ScreenItem[] = [];
      lines.forEach((c, i) => {
        const r = parseScreenLine(c.text, { line: c.line });
        if ('error' in r) { err(c.line, 'bad-screen', r.error); return; }
        if (r.container) {
          if (!c.children.length) err(c.line, 'empty-block', `This ${r.item.kind} has nothing in it`);
          r.item.children = items(c.children);
        } else noChildren(c);
        out.push(attach(r.item, c, i === 0));
      });
      return out;
    };
    const def: ScreenDef = { name, items: items(ln.children), loc: { line: ln.line } };
    const w = /^screen\s+[A-Za-z_]\w*\s+with\s+(.*?)\s*:$/.exec(ln.text);
    if (w) {
      const m = /^([a-z]+)(?:\s+(\d+(?:\.\d+)?))?$/.exec(w[1]!);
      if (!m || !(SCREEN_TRANSITIONS as readonly string[]).includes(m[1]!)) err(ln.line, 'bad-screen', `Expected 'screen ${name} with fade:' or 'with fade 0.3' (${SCREEN_TRANSITIONS.join(', ')})`);
      else def.transition = { name: m[1] as (typeof SCREEN_TRANSITIONS)[number], ...(m[2] ? { duration: Number(m[2]) } : {}) };
    }
    program.screens.push(attach(def, ln, program.screens.length === 0));
  }

  /** `shake [s]`, `flash [colour] [s]`, `camera zoom Z [at X% Y%] [over s]`, `camera reset [over s]`. */
  function parseEffect(word: string, args: string, ln: Line): Stmt | null {
    const loc = { line: ln.line };
    const words = args.split(/\s+/).filter(Boolean);
    const seconds = (w: string | undefined, max: number, what: string): number | null => {
      if (!w || !SECONDS.test(w)) { err(ln.line, `bad-${word}`, `'${what}' needs seconds, e.g. '${what} 0.5'`); return null; }
      const n = Number(w);
      if (n > max) { err(ln.line, `bad-${word}`, `${w} seconds is too long for '${word}' (${max} at most)`); return null; }
      return n;
    };
    // `animate far zoom 0.7 opacity 1 over 3 ease in-out-sine` (D-062)
    if (word === 'animate') {
      const usage = `Expected 'animate name zoom 1.2 over 2' (properties: at, anchor, zoom, rotate, opacity; then 'over' seconds and an optional 'ease')`;
      const target = words.shift();
      if (!target || !IDENT.test(target)) { err(ln.line, 'bad-animate', usage); return null; }
      if (words[0] === 'stop' || words[0] === 'with') {
        const name = words[0] === 'with' ? words[1] : null;
        if ((words[0] === 'with' && (!name || !IDENT.test(name) || words.length !== 2)) || (words[0] === 'stop' && words.length !== 1)) {
          err(ln.line, 'bad-animate', `Expected 'animate ${target} with animation_name' or 'animate ${target} stop'`);
          return null;
        }
        return { type: 'animate', target, props: {}, over: 0, ease: null, animation: name ?? null, loc };
      }
      const oi = words.indexOf('over');
      if (oi < 0) { err(ln.line, 'bad-animate', `'animate' needs 'over' and seconds. ${usage}`); return null; }
      const over = seconds(words[oi + 1], 600, 'over');
      if (over === null) return null;
      const tail = words.splice(oi);
      tail.splice(0, 2);
      let ease: string | null = null;
      if (tail[0] === 'ease') {
        ease = tail[1] ?? '';
        if (!EASES.includes(ease)) { err(ln.line, 'bad-animate', `Unknown ease '${ease}' (linear, or in-, out-, in-out- or out-in- with quad, cubic, quart, quint, sine, circ, expo, elastic, back or bounce, like in-out-sine)`); return null; }
        tail.splice(0, 2);
      }
      if (tail.length) { err(ln.line, 'bad-animate', `Unexpected '${tail.join(' ')}'. ${usage}`); return null; }
      const r = parseLayerProps(words, true);
      if ('error' in r) { err(ln.line, 'bad-animate', r.error); return null; }
      if (!hasProps(r.props)) { err(ln.line, 'bad-animate', `Nothing to animate. ${usage}`); return null; }
      return { type: 'animate', target, props: r.props, over, ease, loc };
    }
    // A character's move: `hop mira`, `nod mira 2`, `shake textbox`, `shake mira forever`, `float mira`.
    if ((word === 'shake' && words[0] && /^[A-Za-z_]/.test(words[0])) || word === 'hop' || word === 'nod' || word === 'bow' || word === 'float') {
      const usage = word === 'float'
        ? `Expected 'float name' (a character on screen; 'still name' stops it)`
        : `Expected '${word} name', '${word} name 2' or '${word} name forever' (a character on screen, or textbox)`;
      const target = words[0];
      if (!target || !/^[A-Za-z_]\w*$/.test(target) || words.length > 2 || (word === 'float' && words.length > 1)) { err(ln.line, `bad-${word}`, usage); return null; }
      if (word === 'float') return { type: 'motion', motion: 'float', target, forever: true, loc };
      if (words.length === 1) return { type: 'motion', motion: word as Motion, target, loc };
      if (words[1] === 'forever') return { type: 'motion', motion: word as Motion, target, forever: true, loc };
      const n = Number(words[1]);
      if (!/^\d+$/.test(words[1]!) || n < 1 || n > 10) { err(ln.line, `bad-${word}`, `'${words[1]}' isn't a number of times (1 to 10). ${usage}`); return null; }
      return { type: 'motion', motion: word as Motion, target, times: n, loc };
    }
    if (word === 'still') {
      if (words.length !== 1 || !/^[A-Za-z_]\w*$/.test(words[0]!)) { err(ln.line, 'bad-still', `Expected 'still name' (stops a character's endless move)`); return null; }
      return { type: 'still', target: words[0]!, loc };
    }
    if (word === 'tone') {
      const usage = `Expected 'tone sepia', 'tone mono' or 'tone none', optionally with 'over 1.5'`;
      const tone = words.shift();
      if (!tone || !(TONES as readonly string[]).includes(tone)) { err(ln.line, 'bad-tone', tone ? `Unknown tone '${tone}'. ${usage}` : usage); return null; }
      let over: number | null = null;
      if (words[0] === 'over') {
        words.shift();
        over = seconds(words.shift(), 60, 'over');
        if (over === null) return null;
      }
      if (words.length) { err(ln.line, 'bad-tone', `Unexpected '${words.join(' ')}'. ${usage}`); return null; }
      return { type: 'tone', tone: tone as Tone, over, loc };
    }
    if (word === 'textbox') {
      const usage = `Expected 'textbox hide' or 'textbox show', optionally with 'over 0.5'`;
      const how = words.shift();
      if (how !== 'hide' && how !== 'show') { err(ln.line, 'bad-textbox', usage); return null; }
      let over: number | null = null;
      if (words[0] === 'over') {
        words.shift();
        over = seconds(words.shift(), 10, 'over');
        if (over === null) return null;
      }
      if (words.length) { err(ln.line, 'bad-textbox', `Unexpected '${words.join(' ')}'. ${usage}`); return null; }
      return { type: 'textbox', show: how === 'show', over, loc };
    }
    if (word === 'movie') {
      if (!args.startsWith('"')) { err(ln.line, 'bad-movie', `Expected 'movie "movie/opening.mp4"' (a video file in assets/)`); return null; }
      const qv = safeQuoted(args, ln.line);
      if (!qv) return null;
      if (qv.rest) { err(ln.line, 'bad-movie', `Unexpected '${qv.rest}' after the file name`); return null; }
      if (!qv.value) { err(ln.line, 'bad-movie', `The movie needs a file name`); return null; }
      return { type: 'movie', path: qv.value, loc };
    }
    if (word === 'shake') {
      if (words.length > 1) { err(ln.line, 'bad-shake', `Expected 'shake' or 'shake seconds'`); return null; }
      if (!words.length) return { type: 'shake', loc };
      const d = seconds(words[0], 10, 'shake');
      return d === null ? null : { type: 'shake', duration: d, loc };
    }
    if (word === 'flash') {
      let color: string | null = null;
      if (words[0] && !SECONDS.test(words[0])) {
        color = words.shift()!;
        if (!FLASH_COLORS.includes(color) && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
          err(ln.line, 'bad-flash', `Unknown colour '${color}' (use ${FLASH_COLORS.join(', ')}, or #rrggbb)`);
          return null;
        }
      }
      if (words.length > 1) { err(ln.line, 'bad-flash', `Expected 'flash [colour] [seconds]'`); return null; }
      if (!words.length) return { type: 'flash', color, loc };
      const d = seconds(words[0], 10, 'flash');
      return d === null ? null : { type: 'flash', color, duration: d, loc };
    }
    // camera
    let zoom: number | null = null;
    let at: [number, number] | null = null;
    let over: number | null = null;
    const usage = `Expected 'camera zoom 1.5 at 70% 30% over 2' or 'camera reset'`;
    const next = (w: string): boolean => (words[0] === w ? (words.shift(), true) : false);
    if (next('reset')) { /* the whole picture */ }
    else if (next('zoom')) {
      const z = words.shift();
      if (!z || !SECONDS.test(z)) { err(ln.line, 'bad-camera', `'zoom' needs a number, e.g. 'camera zoom 1.5' (1 is the whole picture)`); return null; }
      zoom = Number(z);
      if (zoom < 1 || zoom > 10) { err(ln.line, 'bad-camera', `Zoom ${z} is out of range: 1 is the whole picture, 10 the closest`); return null; }
      if (next('at')) {
        const x = PERCENT.exec(words.shift() ?? '');
        const y = PERCENT.exec(words.shift() ?? '');
        if (!x || !y || Number(x[1]) > 100 || Number(y[1]) > 100) {
          err(ln.line, 'bad-camera', `'at' needs a point as two percentages of the screen, across then down: 'at 70% 30%'`);
          return null;
        }
        at = [Number(x[1]), Number(y[1])];
      }
    } else { err(ln.line, 'bad-camera', usage); return null; }
    if (next('over')) {
      over = seconds(words.shift(), 60, 'over');
      if (over === null) return null;
    }
    if (words.length) { err(ln.line, 'bad-camera', `Unexpected '${words.join(' ')}'. ${usage}`); return null; }
    return { type: 'camera', zoom, at, over, loc };
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
  function splitWith(args: string, line: number, allowRule = false): { words: string[]; transition: string | null; rule?: string; duration?: number } {
    const words = args.split(/\s+/).filter(Boolean);
    const wi = words.indexOf('with');
    if (wi < 0) return { words, transition: null };
    const transition = words[wi + 1] ?? null;
    if (!transition) err(line, 'bad-transition', `'with' needs a transition name (fade, dissolve)`);
    let rest = words.slice(wi + 2);
    let rule: string | undefined;
    if (transition === 'wipe') {
      // the rule picture: dark parts change first
      if (!allowRule) err(line, 'bad-transition', `A wipe goes on its own line after the changes: 'with wipe rule_13 0.8'`);
      rule = rest[0]?.replace(/^"(.*)"$/, '$1');
      if (!rule || /^\d+(\.\d+)?$/.test(rule)) err(line, 'bad-transition', `'with wipe' needs a rule picture: an image's name or a path, like 'with wipe rule_13 0.8'`);
      else rest = rest.slice(1);
    }
    let duration: number | undefined;
    if (rest.length && /^\d+(\.\d+)?$/.test(rest[0]!)) {
      duration = Number(rest[0]);
      if (duration > 30) err(line, 'bad-transition', `${rest[0]} seconds is too long for a transition (30 at most)`);
      rest = rest.slice(1);
    }
    if (rest.length) err(line, 'bad-transition', `Unexpected '${rest.join(' ')}' after the transition (only a duration in seconds can follow, like 'with dissolve 1.5')`);
    return { words: words.slice(0, wi), transition, ...(rule ? { rule } : {}), ...(duration !== undefined ? { duration } : {}) };
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
  if (ln.comment) node.comment = ln.comment;
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

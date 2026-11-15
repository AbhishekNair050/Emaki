/**
 * Editor features for `.vn` scripts, independent of any editor API.
 *
 * Everything here works on plain strings and 0-based line/column numbers, so
 * it is unit-tested and shared: the VS Code extension and the web editor are
 * both thin adapters over it, and a language server could be too.
 */
import {
  combineFiles, compile, compileFiles, parse, print, printExpr, KEYWORDS, POSITIONS, TRANSITIONS,
  type CompileCache, type Diagnostic, type Loc, type PluginArgType, type PluginManifest, type Program, type Stmt, type StoryFile,
} from '@emaki/format';

export * from './edits.ts';

/** A span on one line. `line` is 0-based; `start`/`end` are 0-based columns, end exclusive. */
export interface Range {
  line: number;
  start: number;
  end: number;
}

export interface Problem {
  range: Range;
  severity: 'error' | 'warning';
  message: string;
  code: string;
}

export type SymbolKind = 'label' | 'character' | 'image' | 'audio' | 'variable' | 'achievement' | 'ending';

export interface StorySymbol {
  name: string;
  kind: SymbolKind;
  /** Short description: display name, file path, starting value. */
  detail: string;
  /** 0-based line of the definition. */
  line: number;
  /** 0-based last line the definition covers (a label's whole body). */
  endLine: number;
  /** The file it's defined in, when that isn't story.vn (multi-file stories). */
  file?: string;
}

/**
 * Where a document sits in its game. `file` is its path relative to the game
 * folder (story.vn, chapters/two.vn); `files` are the game's other .vn files,
 * story.vn included, so names defined in one file are known in all of them.
 */
export interface StoryContext {
  file: string;
  files: StoryFile[];
  /**
   * The game's plugins (plugins/<name>/plugin.json): `@` lines and plugin
   * functions are checked and completed against them. Absent: not known,
   * so plugin lines aren't checked.
   */
  plugins?: Readonly<Record<string, PluginManifest>>;
  /**
   * Keep one per game and pass it with every analysis: only the files and
   * labels that changed are compiled again, which matters for long games.
   */
  cache?: CompileCache;
}

export type CompletionKind = SymbolKind | 'keyword' | 'value' | 'plugin' | 'function' | 'argument';

export interface Completion {
  label: string;
  kind: CompletionKind;
  detail?: string;
}

/**
 * One parsed snapshot of a document. Cheap enough to rebuild on every edit:
 * names, symbols and completion need only the parsed files; the whole story is
 * compiled the first time its problems are asked for.
 */
export class Analysis {
  readonly lines: string[];
  readonly program: Program;
  private readonly compileNow: () => Diagnostic[];
  private compiled: Diagnostic[] | undefined;

  /** This document's file: undefined for story.vn, as in the compiler's locations. */
  readonly file: string | undefined;

  /** The game's plugins, when known. */
  readonly plugins: Readonly<Record<string, PluginManifest>> | undefined;

  constructor(source: string, context?: StoryContext) {
    this.lines = source.split(/\r?\n/);
    const file = context && context.file !== 'story.vn' ? context.file : undefined;
    this.file = file;
    this.plugins = context?.plugins;
    if (!context) {
      this.program = parse(source).program;
      this.compileNow = () => compile(source).diagnostics;
    } else {
      const others = context.files.filter((f) => f.path !== context.file);
      const main = file ? others.find((f) => f.path === 'story.vn')?.source ?? '' : source;
      const parts = others.filter((f) => f.path !== 'story.vn');
      if (file) parts.push({ path: file, source });
      const opts = { ...(context.plugins ? { plugins: { ...context.plugins } } : {}), cache: context.cache };
      this.program = combineFiles(main, parts, opts).program;
      this.compileNow = () => compileFiles(main, parts, opts).diagnostics;
    }
  }

  /** This document's problems (the other files' are reported in their own files). Compiles the story the first time. */
  get diagnostics(): Diagnostic[] {
    return (this.compiled ??= this.compileNow().filter((d) => d.file === this.file));
  }

  // ------------------------------------------------------------ problems

  problems(): Problem[] {
    return this.diagnostics.map((d) => ({
      range: this.rangeFor(d),
      severity: d.severity,
      message: d.message,
      code: d.code,
    }));
  }

  /** Underline the name a message is about if it appears on the line, else the line's text. */
  private rangeFor(d: Diagnostic): Range {
    const line = Math.min(Math.max(d.line - 1, 0), this.lines.length - 1);
    const text = this.lines[line] ?? '';
    const quoted = /'([^']+)'/.exec(d.message)?.[1];
    if (quoted) {
      const at = findWord(text, quoted);
      if (at >= 0) return { line, start: at, end: at + quoted.length };
    }
    const start = text.length - text.trimStart().length;
    const end = Math.max(text.trimEnd().length, start + 1);
    return { line, start, end };
  }

  // ------------------------------------------------------------ symbols

  private symbolCache: StorySymbol[] | null = null;

  symbols(): StorySymbol[] {
    return (this.symbolCache ??= this.collectSymbols());
  }

  private collectSymbols(): StorySymbol[] {
    const p = this.program;
    const at = (loc: Loc) => ({ line: loc.line - 1, endLine: loc.line - 1, ...(loc.file ? { file: loc.file } : {}) });
    const out: StorySymbol[] = [
      ...p.characters.map((c): StorySymbol => ({ name: c.id, kind: 'character', detail: c.name + (c.color ? ` ${c.color}` : ''), ...at(c.loc) })),
      ...p.images.map((i): StorySymbol => ({ name: i.name, kind: 'image', detail: i.path, ...at(i.loc) })),
      ...p.layered.flatMap((l) => l.layers.flatMap((layer) => (layer.kind === 'group' ? layer.options : []).map((o): StorySymbol => ({
        name: `${l.tag} ${o.attr}`, kind: 'image', detail: o.path, ...at(o.loc),
      })))),
      ...p.audio.map((a): StorySymbol => ({ name: a.name, kind: 'audio', detail: a.path, ...at(a.loc) })),
      ...p.achievements.map((a): StorySymbol => ({ name: a.id, kind: 'achievement', detail: a.name, ...at(a.loc) })),
      ...p.endings.map((e): StorySymbol => ({ name: e.id, kind: 'ending', detail: e.name, ...at(e.loc) })),
      ...p.vars.map((v): StorySymbol => ({
        name: v.name, kind: 'variable', detail: `= ${v.loc.file === this.file ? this.textAfter(v.loc.line - 1, '=') : printExpr(v.init)}`, ...at(v.loc),
      })),
    ];
    // A label covers its body: up to the last indented line before the next label in the same file.
    const labels = [...p.labels].sort((a, b) => (a.loc.file ?? '').localeCompare(b.loc.file ?? '') || a.loc.line - b.loc.line);
    labels.forEach((l, i) => {
      const says = countSays(l.body);
      const sym: StorySymbol = { name: l.name, kind: 'label', detail: `${says} line${says === 1 ? '' : 's'} of dialogue`, ...at(l.loc) };
      if (l.loc.file === this.file) {
        const nextLabel = labels[i + 1];
        const next = nextLabel && nextLabel.loc.file === this.file ? nextLabel.loc.line : this.lines.length + 1;
        let end = next - 2; // 0-based line before the next label
        while (end > l.loc.line - 1 && !/^\s+\S/.test(this.lines[end] ?? '')) end--;
        sym.endLine = end;
      }
      out.push(sym);
    });
    return out;
  }

  /** Definitions in this document (for outlines), as opposed to the whole story's. */
  ownSymbols(): StorySymbol[] {
    return this.symbols().filter((s) => s.file === this.file);
  }

  private textAfter(line: number, sep: string): string {
    const text = this.lines[line] ?? '';
    return text.slice(text.indexOf(sep) + 1).trim();
  }

  private find(kind: SymbolKind, name: string): StorySymbol | undefined {
    return this.symbols().find((s) => s.kind === kind && s.name === name);
  }

  // ------------------------------------------------------------ definition and hover

  /** Every place a definition is used (and, optionally, the definition itself). */
  referencesTo(target: StorySymbol, includeDeclaration: boolean): Range[] {
    const out: Range[] = [];
    this.lines.forEach((text, line) => {
      let last: StorySymbol | undefined;
      for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
        const hit = this.definitionAt(line, m.index);
        // Several words can name one thing ("show mira smile"): report it once per line.
        if (hit === target && last !== target && (includeDeclaration || line !== target.line || target.file !== this.file)) {
          out.push({ line, start: m.index, end: m.index + m[0].length });
        }
        last = hit;
      }
    });
    return out;
  }

  /** The definition the name under the cursor refers to, if any. */
  definitionAt(line: number, col: number): StorySymbol | undefined {
    const text = this.lines[line] ?? '';
    const word = wordAt(text, col);
    if (!word) return undefined;

    // Image references can span several words ("mira smile"): resolve the whole name first.
    const image = this.imageReferenceAt(text, word);
    if (image) return image;

    if (/^\s*(jump|call)\s/.test(text) || /^start\s*:/.test(text)) {
      const label = this.find('label', word.text);
      if (label) return label;
    }
    if (/^\s+(play|stop)\s/.test(text)) {
      const audio = this.find('audio', word.text);
      if (audio) return audio;
    }
    if (/^\s+achieve\s/.test(text)) {
      const a = this.find('achievement', word.text);
      if (a) return a;
    }
    if (/^\s+end\s/.test(text)) {
      const e = this.find('ending', word.text);
      if (e) return e;
    }
    for (const kind of ['label', 'variable', 'character', 'image', 'audio', 'achievement', 'ending'] as const) {
      const hit = this.find(kind, word.text);
      if (hit) return hit;
    }
    return undefined;
  }

  private imageReferenceAt(text: string, word: Word): StorySymbol | undefined {
    const m = /^(\s+)(scene|show|hide)\s+(.+?)(?:\s+(?:with|at)\s.*)?\s*$/.exec(text)
      ?? /^(\s+)()([A-Za-z_]\w*(?:\s+[A-Za-z_]\w*)*)\s*:/.exec(text); // say line: who attrs:
    if (!m) return undefined;
    const nameStart = text.indexOf(m[3]!, m[1]!.length + m[2]!.length);
    if (word.start < nameStart || word.end > nameStart + m[3]!.length) return undefined;
    const words = m[3]!.trim().split(/\s+/);
    const full = this.find('image', words.join(' '));
    // On the tag of a sprite, prefer the character (say lines) or the full image (scene/show).
    if (word.start === nameStart && m[2] === '') return this.find('character', words[0]!) ?? full;
    return full ?? (word.start === nameStart ? this.find('character', words[0]!) : undefined);
  }

  /** Markdown shown when hovering a name. */
  hoverAt(line: number, col: number): string | undefined {
    const plugin = this.pluginHoverAt(this.lines[line] ?? '', col, line);
    if (plugin) return plugin;
    const s = this.definitionAt(line, col);
    if (!s || (s.line === line && s.file === this.file)) return undefined;
    switch (s.kind) {
      case 'character': return `**${s.name}** — character, shown as *${s.detail}*`;
      case 'image': return `**${s.name}** — image \`${s.detail}\``;
      case 'audio': return `**${s.name}** — audio \`${s.detail}\``;
      case 'achievement': return `**${s.name}** — achievement *${s.detail}*`;
      case 'ending': return `**${s.name}** — ending *${s.detail}*`;
      case 'variable': return `**${s.name}** — variable, starts ${s.detail}`;
      case 'label': return `**${s.name}** — label, ${s.detail} (${s.file !== this.file ? `${s.file ?? 'story.vn'} ` : ''}line ${s.line + 1})`;
    }
  }

  // ------------------------------------------------------------ completion

  /** The game's own screens that the story can show or call (not the ones replacing built-in screens). */
  private storyScreens(): string[] {
    return this.lines.flatMap((l) => /^screen\s+([A-Za-z_]\w*)\s*:/.exec(l)?.[1] ?? [])
      .filter((n) => !['title', 'menu', 'load', 'save', 'settings', 'extras'].includes(n));
  }

  // ------------------------------------------------------------ plugins

  /** `@weather start`, `@dice.roll(6)` under the cursor: what the manifest says about it. */
  private pluginHoverAt(text: string, col: number, line: number): string | undefined {
    if (!this.plugins) return undefined;
    for (const m of text.matchAll(/@([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*)|\s+([A-Za-z_]\w*))?/g)) {
      if (col < m.index || col > m.index + m[0].length) continue;
      const p = this.plugins[m[1]!];
      if (!p) return undefined;
      const onPlugin = col <= m.index + 1 + m[1]!.length;
      if (m[2] && !onPlugin) {
        const f = p.functions?.[m[2]];
        return f && `**@${m[1]}.${m[2]}**${signature(f.args)}${f.returns ? ` → ${f.returns}` : ''} — plugin function${f.description ? `\n\n${f.description}` : ''}`;
      }
      if (m[3] && !onPlugin && /^\s*$/.test(text.slice(0, m.index))) {
        const inScreen = this.inScreen(line);
        const spec = (inScreen ? p.elements : p.commands)?.[m[3]];
        if (!spec) return undefined;
        const c = spec as { args?: Record<string, PluginArgType>; waits?: boolean; lasting?: string; description?: string };
        const how = c.waits ? ', the story waits for it' : c.lasting ? `, lasting (${c.lasting})` : '';
        return `**@${m[1]} ${m[3]}** — plugin ${inScreen ? 'element' : 'command'}${how}${argList(c.args)}${c.description ? `\n\n${c.description}` : ''}`;
      }
      return `**@${m[1]}** — plugin${p.description ? `: ${p.description}` : ''}`;
    }
    return undefined;
  }

  /** Whether a line sits in a `screen` block (where `@` lines are elements, not commands). */
  private inScreen(at: number): boolean {
    for (let i = at; i >= 0; i--) {
      const l = this.lines[i] ?? '';
      if (/^\S/.test(l) && !l.startsWith('#')) return /^screen\s/.test(l);
    }
    return false;
  }

  /** Completions for plugin commands, elements, arguments and functions; null when the cursor isn't on one. */
  private pluginCompletions(before: string, line: number): Completion[] | null {
    const plugins = this.plugins;
    const fn = /@([A-Za-z_]\w*)\.\w*$/.exec(before);
    if (fn) {
      return Object.entries(plugins?.[fn[1]!]?.functions ?? {})
        .map(([n, f]): Completion => ({ label: n, kind: 'function', detail: `${signature(f.args)}${f.returns ? ` → ${f.returns}` : ''}${f.description ? ` — ${f.description}` : ''}` }));
    }
    const inScreen = () => this.inScreen(line);
    const table = (p: PluginManifest) => (inScreen() ? p.elements : p.commands);
    if (/^\s+@\w*$/.test(before)) {
      return Object.entries(plugins ?? {}).filter(([, p]) => Object.keys(table(p) ?? {}).length)
        .map(([n, p]): Completion => ({ label: n, kind: 'plugin', ...(p.description ? { detail: p.description } : {}) }));
    }
    const cmd = /^\s+@([A-Za-z_]\w*)\s+\w*$/.exec(before);
    if (cmd) {
      const p = plugins?.[cmd[1]!];
      return Object.entries((p && table(p)) ?? {})
        .map(([n, c]): Completion => ({ label: n, kind: 'function', ...(c.description ? { detail: c.description } : {}) }));
    }
    const call = /^\s+@([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\b(.*)$/.exec(before);
    if (call) {
      const p = plugins?.[call[1]!];
      const spec = p && table(p)?.[call[2]!];
      const args = spec?.args ?? {};
      const rest = call[3]!;
      const value = /\s([A-Za-z_]\w*)=("?)\w*$/.exec(rest);
      if (value) {
        const t = args[value[1]!];
        if (Array.isArray(t)) return t.map((o): Completion => ({ label: value[2] ? o : `"${o}"`, kind: 'value', detail: value[1] }));
        if (t === 'boolean' || t === 'boolean?') return ['true', 'false'].map((o): Completion => ({ label: o, kind: 'value', detail: value[1] }));
        return /=\w*$/.test(rest) && !value[2] ? this.of('variable') : [];
      }
      if (/\s\w*$/.test(rest) && !/->\s*\w*$/.test(rest)) {
        const given = new Set([...rest.matchAll(/([A-Za-z_]\w*)=/g)].map((m) => m[1]));
        return Object.entries(args).filter(([k]) => !given.has(k))
          .map(([k, t]): Completion => ({ label: `${k}=`, kind: 'argument', detail: typeText(t) }));
      }
      if (/->\s*\w*$/.test(rest)) return this.of('variable');
      return [];
    }
    if (/@\w*$/.test(before)) {
      return Object.entries(plugins ?? {}).filter(([, p]) => Object.keys(p.functions ?? {}).length)
        .map(([n, p]): Completion => ({ label: n, kind: 'plugin', ...(p.description ? { detail: p.description } : {}) }));
    }
    return null;
  }

  private of(kind: SymbolKind): Completion[] {
    return this.symbols().filter((s) => s.kind === kind).map((s): Completion => ({ label: s.name, kind, detail: s.detail }));
  }

  // ------------------------------------------------------------ completion

  /** Suggestions for the cursor position, based on the text before it on the line. */
  completionsAt(line: number, col: number): Completion[] {
    const before = (this.lines[line] ?? '').slice(0, col);
    const plugin = this.pluginCompletions(before, line);
    if (plugin) return plugin;
    const syms = this.symbols();
    const of = (kind: SymbolKind) => syms.filter((s) => s.kind === kind).map((s): Completion => ({ label: s.name, kind, detail: s.detail }));
    const values = (xs: string[], detail: string) => xs.map((x): Completion => ({ label: x, kind: 'value', detail }));
    const images = syms.filter((s) => s.kind === 'image');

    if (/\bwith\s+\w*$/.test(before)) return values(TRANSITIONS, 'transition');
    if (/^\s+show\s.*\bat\s+\w*$/.test(before)) return values(POSITIONS, 'position');
    if (/^\s*(jump|call)\s+\w*$/.test(before) || /^replay\s+\w*$/.test(before) || /^replay\s.*\buntil\s+\w*$/.test(before)
      || (/^start\s*:\s*\w*$/.test(before) && this.inHeader(line))) return of('label');
    if (/^\s+scene\s+[\w ]*$/.test(before)) {
      return [...images.filter((s) => !s.name.includes(' ')).map((s): Completion => ({ label: s.name, kind: 'image', detail: s.detail })),
        { label: 'black', kind: 'value', detail: 'empty black screen' }];
    }
    // `show screen hud`, `call screen map`: the game's screens.
    const screens = this.storyScreens();
    if (/^\s+(show|hide|call)\s+screen\s+\w*$/.test(before)) return values(screens, 'screen');
    // Attributes after a sprite tag: `show mira sm|` or a say line `mira sm|`.
    const shown = /^\s+show\s+(\w+)\s+\w*$/.exec(before)?.[1];
    const speaker = /^\s+(\w+)\s+\w*$/.exec(before)?.[1];
    const tag = shown ?? (speaker && !KEYWORDS.has(speaker) && this.find('character', speaker) ? speaker : undefined);
    if (tag) {
      return images
        .filter((s) => s.name.startsWith(tag + ' '))
        .map((s): Completion => ({ label: s.name.slice(tag.length + 1), kind: 'image', detail: s.detail }));
    }
    if (/^\s+(show|hide)\s+\w*$/.test(before)) {
      const tags = [...new Set(images.map((s) => s.name.split(' ')[0]!))];
      const all = tags.map((t): Completion => ({ label: t, kind: 'image', detail: 'sprite' }));
      return screens.length ? [...all, ...values(['screen'], 'one of your screens')] : all;
    }
    if (/^\s+set\s+\w*$/.test(before) || /^\s+(if|elif)\s/.test(before) || /\{\w*$/.test(before) || /"\s+if\s/.test(before)) {
      return of('variable');
    }
    if (/^\s+achieve\s+\w*$/.test(before)) return of('achievement');
    if (/^\s+end\s+\w*$/.test(before)) return of('ending');
    if (/^\s+(play|stop)\s+\w*$/.test(before)) return values(['music', 'ambience', 'sound', 'voice'], 'channel');
    if (/^\s+play\s+\w+\s+\w*$/.test(before)) return of('audio');
    if (/^\s+\w*$/.test(before)) {
      return [
        ...of('character'),
        ...STATEMENTS.map((k): Completion => ({ label: k, kind: 'keyword' })),
      ];
    }
    if (/^\w*$/.test(before) && !this.inHeader(line)) {
      return TOP_LEVEL.map((k): Completion => ({ label: k, kind: 'keyword' }));
    }
    return [];
  }

  private inHeader(line: number): boolean {
    if (this.lines[0]?.trim() !== '---') return false;
    for (let i = 1; i < this.lines.length; i++) {
      if (this.lines[i]!.trim() === '---') return line < i;
    }
    return true;
  }
}

/** `(sides, times?)`: a plugin function's arguments, in order. */
function signature(args: Record<string, PluginArgType> | undefined): string {
  return `(${Object.entries(args ?? {}).map(([k, t]) => (typeof t === 'string' && t.endsWith('?') ? `${k}?` : k)).join(', ')})`;
}

function typeText(t: PluginArgType): string {
  return Array.isArray(t) ? t.map((x) => `"${x}"`).join(' | ') : t.endsWith('?') ? `${t.slice(0, -1)} (optional)` : t;
}

function argList(args: Record<string, PluginArgType> | undefined): string {
  const e = Object.entries(args ?? {});
  return e.length ? `\n\n${e.map(([k, t]) => `\`${k}\`: ${typeText(t)}`).join(' · ')}` : '';
}

const TOP_LEVEL = ['define', 'image', 'audio', 'layered', 'screen', 'var', 'global var', 'achievement', 'ending', 'replay', 'label'];
const STATEMENTS = ['scene', 'show', 'hide', 'play', 'stop', 'set', 'jump', 'call', 'return', 'end', 'wait', 'menu', 'if', 'elif', 'else', 'achieve', 'nvl', 'shake', 'flash', 'camera', 'hop', 'nod', 'bow', 'movie', 'float', 'still', 'tone'];

/**
 * The dev-server address that opens the game at a line (0-based `line` in,
 * 1-based in the URL, matching what the player expects: `?line=52`).
 */
export function previewUrl(base: string, line: number, file?: string): string {
  const url = new URL(base);
  if (file && file !== 'story.vn') url.searchParams.set('file', file);
  url.searchParams.set('line', String(line + 1));
  return url.toString();
}

/** The canonical formatting of a script, or null if it has syntax errors (never format broken code). */
export function format(source: string): string | null {
  const { program, diagnostics } = parse(source);
  if (diagnostics.some((d) => d.severity === 'error')) return null;
  return print(program);
}

interface Word {
  text: string;
  start: number;
  end: number;
}

function wordAt(text: string, col: number): Word | undefined {
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  for (let m; (m = re.exec(text));) {
    if (col >= m.index && col <= m.index + m[0].length) return { text: m[0], start: m.index, end: m.index + m[0].length };
  }
  return undefined;
}

/** Column of `word` in `text` as a whole word (or phrase), or -1. */
function findWord(text: string, word: string): number {
  const re = new RegExp(`(?<![A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
  return re.exec(text)?.index ?? -1;
}

function countSays(body: Stmt[]): number {
  let n = 0;
  for (const s of body) {
    if (s.type === 'say') n++;
    else if (s.type === 'menu') for (const c of s.choices) n += countSays(c.body);
    else if (s.type === 'if') for (const b of s.branches) n += countSays(b.body);
  }
  return n;
}

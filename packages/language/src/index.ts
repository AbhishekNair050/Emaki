/**
 * Editor features for `.vn` scripts, independent of any editor API.
 *
 * Everything here works on plain strings and 0-based line/column numbers, so
 * it is unit-tested and shared: the VS Code extension and the web editor are
 * both thin adapters over it, and a language server could be too.
 */
import {
  compile, parse, print, KEYWORDS, POSITIONS, TRANSITIONS,
  type Diagnostic, type Program, type Stmt,
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

export type SymbolKind = 'label' | 'character' | 'image' | 'audio' | 'variable' | 'achievement';

export interface StorySymbol {
  name: string;
  kind: SymbolKind;
  /** Short description: display name, file path, starting value. */
  detail: string;
  /** 0-based line of the definition. */
  line: number;
  /** 0-based last line the definition covers (a label's whole body). */
  endLine: number;
}

export type CompletionKind = SymbolKind | 'keyword' | 'value';

export interface Completion {
  label: string;
  kind: CompletionKind;
  detail?: string;
}

/** One parsed snapshot of a document. Cheap enough to rebuild on every edit. */
export class Analysis {
  readonly lines: string[];
  readonly program: Program;
  readonly diagnostics: Diagnostic[];

  constructor(source: string) {
    this.lines = source.split(/\r?\n/);
    const result = compile(source);
    this.program = result.program;
    this.diagnostics = result.diagnostics;
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
    const one = (line: number) => line - 1;
    const out: StorySymbol[] = [
      ...p.characters.map((c): StorySymbol => ({
        name: c.id, kind: 'character', detail: c.name + (c.color ? ` ${c.color}` : ''), line: one(c.loc.line), endLine: one(c.loc.line),
      })),
      ...p.images.map((i): StorySymbol => ({ name: i.name, kind: 'image', detail: i.path, line: one(i.loc.line), endLine: one(i.loc.line) })),
      ...p.audio.map((a): StorySymbol => ({ name: a.name, kind: 'audio', detail: a.path, line: one(a.loc.line), endLine: one(a.loc.line) })),
      ...p.achievements.map((a): StorySymbol => ({ name: a.id, kind: 'achievement', detail: a.name, line: one(a.loc.line), endLine: one(a.loc.line) })),
      ...p.vars.map((v): StorySymbol => ({
        name: v.name, kind: 'variable', detail: `= ${this.textAfter(one(v.loc.line), '=')}`, line: one(v.loc.line), endLine: one(v.loc.line),
      })),
    ];
    const labels = [...p.labels].sort((a, b) => a.loc.line - b.loc.line);
    labels.forEach((l, i) => {
      const next = labels[i + 1]?.loc.line ?? this.lines.length + 1;
      let end = next - 2; // 0-based line before the next label
      while (end > l.loc.line - 1 && !/^\s+\S/.test(this.lines[end] ?? '')) end--;
      const says = countSays(l.body);
      out.push({
        name: l.name, kind: 'label', detail: `${says} line${says === 1 ? '' : 's'} of dialogue`, line: l.loc.line - 1, endLine: end,
      });
    });
    return out;
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
        if (hit === target && last !== target && (includeDeclaration || line !== target.line)) {
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
    for (const kind of ['label', 'variable', 'character', 'image', 'audio', 'achievement'] as const) {
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
    const s = this.definitionAt(line, col);
    if (!s || s.line === line) return undefined;
    switch (s.kind) {
      case 'character': return `**${s.name}** — character, shown as *${s.detail}*`;
      case 'image': return `**${s.name}** — image \`${s.detail}\``;
      case 'audio': return `**${s.name}** — audio \`${s.detail}\``;
      case 'achievement': return `**${s.name}** — achievement *${s.detail}*`;
      case 'variable': return `**${s.name}** — variable, starts ${s.detail}`;
      case 'label': return `**${s.name}** — label, ${s.detail} (line ${s.line + 1})`;
    }
  }

  // ------------------------------------------------------------ completion

  /** Suggestions for the cursor position, based on the text before it on the line. */
  completionsAt(line: number, col: number): Completion[] {
    const before = (this.lines[line] ?? '').slice(0, col);
    const syms = this.symbols();
    const of = (kind: SymbolKind) => syms.filter((s) => s.kind === kind).map((s): Completion => ({ label: s.name, kind, detail: s.detail }));
    const values = (xs: string[], detail: string) => xs.map((x): Completion => ({ label: x, kind: 'value', detail }));
    const images = syms.filter((s) => s.kind === 'image');

    if (/\bwith\s+\w*$/.test(before)) return values(TRANSITIONS, 'transition');
    if (/^\s+show\s.*\bat\s+\w*$/.test(before)) return values(POSITIONS, 'position');
    if (/^\s*(jump|call)\s+\w*$/.test(before) || (/^start\s*:\s*\w*$/.test(before) && this.inHeader(line))) return of('label');
    if (/^\s+scene\s+[\w ]*$/.test(before)) {
      return [...images.filter((s) => !s.name.includes(' ')).map((s): Completion => ({ label: s.name, kind: 'image', detail: s.detail })),
        { label: 'black', kind: 'value', detail: 'empty black screen' }];
    }
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
      return tags.map((t): Completion => ({ label: t, kind: 'image', detail: 'sprite' }));
    }
    if (/^\s+set\s+\w*$/.test(before) || /^\s+(if|elif)\s/.test(before) || /\{\w*$/.test(before) || /"\s+if\s/.test(before)) {
      return of('variable');
    }
    if (/^\s+achieve\s+\w*$/.test(before)) return of('achievement');
    if (/^\s+(play|stop)\s+\w*$/.test(before)) return values(['music', 'sound', 'voice'], 'channel');
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

const TOP_LEVEL = ['define', 'image', 'audio', 'var', 'global var', 'achievement', 'label'];
const STATEMENTS = ['scene', 'show', 'hide', 'play', 'stop', 'set', 'jump', 'call', 'return', 'end', 'wait', 'menu', 'if', 'elif', 'else', 'achieve'];

/**
 * The dev-server address that opens the game at a line (0-based `line` in,
 * 1-based in the URL, matching what the player expects: `?line=52`).
 */
export function previewUrl(base: string, line: number): string {
  const url = new URL(base);
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

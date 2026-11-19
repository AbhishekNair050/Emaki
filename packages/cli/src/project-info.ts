/**
 * What the launcher shows about a project: its picture, its size and its problems. Working it out compiles the
 * whole game (seconds for a full-length novel), so the launcher runs it in a worker thread and keeps the answer
 * until a story file changes.
 */
import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { buildGraph, type Stmt } from '@emaki/format';
import { compileGame, MAIN_FILE, storyParts } from '@emaki/format/files';

export interface ProjectInfo {
  /** Story files (story.vn and the others in its folder). */
  files: number;
  lines: number;
  scenes: number;
  words: number;
  choices: number;
  /** Scenes the story ends in (as the editor's flowchart counts them). */
  endings: number;
  achievements: number;
  errors: number;
  warnings: number;
  /** The first error (or warning), as `file:line message`. */
  firstProblem: string | null;
  /** The picture that stands for the game, relative to its assets folder: its title image, else its first scene's. */
  picture: string | null;
  /** When it was worked out (ms since 1970). */
  at: number;
}

/** The story files and their sizes and times: when it changes, the info is worked out again. */
export function storySignature(dir: string): string {
  return [MAIN_FILE, ...storyParts(dir)].map((f) => {
    const s = statSync(join(dir, f));
    return `${f}:${s.size}:${s.mtimeMs}`;
  }).join('|');
}

/** Words as a reader counts them: spaced words, and each character of text written without spaces (Japanese, Chinese). */
export function countWords(text: string): number {
  const plain = text.replace(/\{[^}]*\}|\[[^\]]*\]|[*_~`]/g, ' ');
  const cjk = plain.match(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g)?.length ?? 0;
  const spaced = plain.replace(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return cjk + spaced;
}

export function projectInfo(dir: string): ProjectInfo {
  const r = compileGame(dir);
  const program = r.program;
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  const first = errors[0] ?? r.diagnostics[0];
  let words = 0;
  let choices = 0;
  for (const s of r.strings) {
    if (s.kind === 'line') words += countWords(s.text);
    else if (s.kind === 'choice') { words += countWords(s.text); choices++; }
  }
  const lines = [r.main, ...r.parts.map((p) => p.source)].reduce((n, t) => n + t.split('\n').length, 0);
  return {
    files: 1 + r.parts.length,
    lines,
    scenes: program.labels.length,
    words,
    choices,
    endings: buildGraph(program).nodes.filter((n) => n.ending).length,
    achievements: program.achievements.length,
    errors: errors.length,
    warnings: r.diagnostics.length - errors.length,
    firstProblem: first ? `${first.file ?? MAIN_FILE}:${first.line} ${first.message}` : null,
    picture: pictureOf(dir, program),
    at: Date.now(),
  };
}

/** The title image, else the first background the story shows, as long as the file is there. */
function pictureOf(dir: string, program: ReturnType<typeof compileGame>['program']): string | null {
  const meta = new Map(program.meta);
  const images = new Map(program.images.map((i) => [i.name, i.path]));
  const candidates: string[] = [];
  const title = meta.get('title_image');
  if (title) candidates.push(images.get(title) ?? title);
  // A game's own title screen: its first picture that fills the screen (one placed `at` a point is a logo or a button).
  const backdrop = program.screens.find((d) => d.name === 'title')?.items.find((i) => i.kind === 'image' && i.image && !i.at)?.image;
  if (backdrop) candidates.push(backdrop.kind === 'path' ? backdrop.path : images.get(backdrop.name) ?? backdrop.name);
  const startName = meta.get('start');
  const start = program.labels.find((l) => l.name === startName) ?? program.labels[0];
  // The start scene first, then the rest of the story in order.
  const order = start ? [start, ...program.labels.filter((l) => l !== start)] : [];
  // A background (`scene`) first; a story built from layers (`show picture as layer`) has its first picture shown.
  for (const find of [firstScene, firstShown]) {
    const found = order.map((l) => find(l.body)).find((x) => x);
    if (found) candidates.push(images.get(found) ?? found);
  }
  for (const c of candidates) {
    const file = assetFile(dir, c);
    if (file) return relative(join(dir, 'assets'), file).replace(/\\/g, '/');
  }
  return null;
}

function firstScene(stmts: Stmt[]): string | null {
  for (const s of stmts) {
    if (s.type === 'scene' && s.image && s.image !== 'black') return s.image;
    if (s.type === 'menu') for (const c of s.choices) { const f = firstScene(c.body); if (f) return f; }
    if (s.type === 'if') for (const b of s.branches) { const f = firstScene(b.body); if (f) return f; }
  }
  return null;
}

function firstShown(stmts: Stmt[]): string | null {
  for (const s of stmts) {
    if (s.type === 'show' && s.as && s.tag !== 'screen') return [s.tag, ...s.attrs].join(' ');
    if (s.type === 'menu') for (const c of s.choices) { const f = firstShown(c.body); if (f) return f; }
    if (s.type === 'if') for (const b of s.branches) { const f = firstShown(b.body); if (f) return f; }
  }
  return null;
}

export const PICTURE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

/** A picture inside the game's assets folder (never outside it), or null. */
export function assetFile(dir: string, path: string): string | null {
  const assets = resolve(dir, 'assets');
  const file = resolve(assets, path.replace(/^\.?\//, ''));
  const inside = relative(assets, file);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null;
  if (!PICTURE_TYPES[extname(file).toLowerCase()]) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

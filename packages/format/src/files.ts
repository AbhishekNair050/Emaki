/**
 * Finding a game's script files on disk (Node only; `@emaki/format/files`).
 *
 * A game is a folder with story.vn (the main file, with the header) and any
 * number of other .vn files, in subfolders too, that make up the same story.
 * Folders that never hold scripts are skipped: assets, translations, builds.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { CompiledStory } from './compiled.ts';
import { compileFiles, voiceMap, type CompileResult, type StoryFile } from './compiler.ts';

export const MAIN_FILE = 'story.vn';
const SKIP_DIRS = new Set(['assets', 'lang', 'dist', 'export', 'node_modules', 'tools']);

/** The game folder for a path to its story.vn (or the folder itself). */
export function gameDirOf(path: string): string {
  return existsSync(path) && statSync(path).isDirectory() ? path : dirname(path);
}

/** Paths (relative to the game folder, with forward slashes) of every .vn file except story.vn, sorted. */
export function storyParts(gameDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) || dir !== gameDir) walk(p);
      } else if (name.endsWith('.vn')) {
        const rel = relative(gameDir, p).split(sep).join('/');
        if (rel !== MAIN_FILE) out.push(rel);
      }
    }
  };
  walk(gameDir);
  return out;
}

/** story.vn's text and the game's other .vn files. */
export function readStory(gameDir: string): { main: string; parts: StoryFile[] } {
  return {
    main: readFileSync(join(gameDir, MAIN_FILE), 'utf8'),
    parts: storyParts(gameDir).map((path) => ({ path, source: readFileSync(join(gameDir, path), 'utf8') })),
  };
}

/** Compile the whole game in a folder (with its voice files). */
export function compileGame(gameDir: string): CompileResult & { parts: StoryFile[]; main: string } {
  const { main, parts } = readStory(gameDir);
  const r = compileFiles(main, parts);
  if (r.story) addVoices(r.story, gameDir);
  return { ...r, main, parts };
}

/**
 * For a header `voice: voice/{id}.ogg`, the voice file of every line that has
 * one in assets/ (lines without one stay silent). Ids are stable while a line's
 * speaker and text stay the same.
 */
export function findVoices(story: CompiledStory, gameDir: string): Record<string, string> {
  return voiceMap(story, (path) => existsSync(join(gameDir, 'assets', path)));
}

/** Fill in `story.voices` from the game folder. */
export function addVoices(story: CompiledStory, gameDir: string): void {
  const voices = findVoices(story, gameDir);
  if (Object.keys(voices).length) story.voices = voices;
}

/** `file:line` for messages, with story.vn for the main file. */
export function where(d: { line: number; file?: string }): string {
  return `${d.file ?? MAIN_FILE}:${d.line}`;
}

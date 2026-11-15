/**
 * Finding a game's script files on disk (Node only; `@emaki/format/files`).
 *
 * A game is a folder with story.vn (the main file, with the header) and any
 * number of other .vn files, in subfolders too, that make up the same story.
 * Folders that never hold scripts are skipped: assets, translations, builds.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Diagnostic } from './ast.ts';
import type { CompiledStory } from './compiled.ts';
import { compileFiles, voiceMap, type CompileCache, type CompileResult, type StoryFile } from './compiler.ts';
import { parseManifest, type PluginManifest } from './plugins.ts';

/** A plugin in the game folder: its manifest and the absolute path of its code. */
export interface GamePlugin { manifest: PluginManifest; main: string }

/**
 * The game's plugins: every plugins/<name>/ with a plugin.json. Problems
 * (bad JSON, a missing index.js) come back as diagnostics on that file.
 */
export function readPlugins(gameDir: string): { plugins: Record<string, GamePlugin>; diagnostics: Diagnostic[] } {
  const dir = join(gameDir, 'plugins');
  const plugins: Record<string, GamePlugin> = {};
  const diagnostics: Diagnostic[] = [];
  if (!existsSync(dir)) return { plugins, diagnostics };
  for (const name of readdirSync(dir).sort()) {
    const folder = join(dir, name);
    if (name.startsWith('.') || !statSync(folder).isDirectory()) continue;
    const file = `plugins/${name}/plugin.json`;
    const fail = (message: string) => diagnostics.push({ severity: 'error', line: 1, file, code: 'bad-plugin', message });
    if (!existsSync(join(folder, 'plugin.json'))) { fail(`plugins/${name}/ has no plugin.json describing it`); continue; }
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(join(folder, 'plugin.json'), 'utf8')); } catch (e) { fail(`plugin.json isn't valid JSON: ${(e as Error).message}`); continue; }
    const r = parseManifest(raw, name);
    for (const m of r.errors) fail(m);
    if (!r.manifest) continue;
    const main = join(folder, r.manifest.main ?? 'index.js');
    if (!existsSync(main)) { fail(`The plugin's code, ${r.manifest.main ?? 'index.js'}, is missing`); continue; }
    plugins[name] = { manifest: r.manifest, main };
  }
  return { plugins, diagnostics };
}

/** Just the manifests, for the compiler. */
export function pluginManifests(plugins: Record<string, GamePlugin>): Record<string, PluginManifest> {
  return Object.fromEntries(Object.entries(plugins).map(([k, v]) => [k, v.manifest]));
}

export const MAIN_FILE = 'story.vn';
const SKIP_DIRS = new Set(['assets', 'lang', 'dist', 'export', 'node_modules', 'tools', 'plugins']);

/** The game folder for a path to its story.vn (or the folder itself). */
export function gameDirOf(path: string): string {
  return existsSync(path) && statSync(path).isDirectory() ? path : dirname(path);
}

/** Paths (relative to the game folder, with forward slashes) of every .vn file except story.vn, sorted. */
export function storyParts(gameDir: string): string[] {
  const out: string[] = [];
  // Files can come and go while we look (a tool rewriting the scripts): skip what's gone.
  const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const name = e.name;
      if (name.startsWith('.')) continue;
      const p = join(dir, name);
      if (e.isSymbolicLink() ? isDir(p) : e.isDirectory()) {
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
/** Compile the game in a folder. Pass the same `cache` each time to recompile only what changed. */
export function compileGame(gameDir: string, cache?: CompileCache): CompileResult & { parts: StoryFile[]; main: string; plugins: Record<string, GamePlugin> } {
  const { main, parts } = readStory(gameDir);
  const { plugins, diagnostics } = readPlugins(gameDir);
  const r = compileFiles(main, parts, { plugins: pluginManifests(plugins), cache });
  if (r.story) addVoices(r.story, gameDir);
  const all = [...diagnostics, ...r.diagnostics];
  return { ...r, story: all.some((d) => d.severity === 'error') ? null : r.story, diagnostics: all, main, parts, plugins };
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

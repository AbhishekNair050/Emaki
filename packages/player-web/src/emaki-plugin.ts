/**
 * Vite plugin: compiles the game's story (story.vn plus its other .vn files)
 * and its translations in lang/ on the fly, and exposes them as
 * `virtual:emaki-game`. Editing, adding or removing a .vn file or a
 * translation triggers a reload; the player resumes at the same line (see
 * Runner.resume).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import type { Plugin } from 'vite';
import {
  buildGraph, compileTranslation, localizedAssets, localizablePaths, parseCatalog,
  type CompiledStory, type CompiledTranslation, type SourceString,
} from '@emaki/format';
import { compileGame, storyParts, where } from '@emaki/format/files';
import { uiSourceStrings } from './ui-strings.ts';

const VIRTUAL = 'virtual:emaki-game';
const RESOLVED = '\0' + VIRTUAL;

/** Translation files: lang/<code>.po or lang/<code>.csv. */
export function translationFiles(gameDir: string): string[] {
  const dir = join(gameDir, 'lang');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(po|csv)$/i.test(f)).sort().map((f) => join(dir, f));
}

/** Compile every translation in lang/, reporting problems with file:line. */
export function loadTranslations(
  gameDir: string, strings: SourceString[], report: (msg: string, isError: boolean) => void, story?: CompiledStory | null,
): CompiledTranslation[] {
  const all = [...strings, ...uiSourceStrings()];
  const localizable = story ? localizablePaths(story) : [];
  const out: CompiledTranslation[] = [];
  for (const file of translationFiles(gameDir)) {
    const name = file.slice(file.lastIndexOf('lang'));
    const { catalog, diagnostics } = parseCatalog(file, readFileSync(file, 'utf8'));
    for (const d of diagnostics) report(`${name}:${d.line}: ${d.message}`, d.severity === 'error');
    const r = compileTranslation(catalog, all);
    // Problems in a translation point at the story line it translates.
    for (const d of r.diagnostics) report(`${name}: ${where(d)}: ${d.message}`, d.severity === 'error');
    // Pictures and movies made again for this language: cg/sign.png → cg/sign.<lang>.png.
    const assets = localizedAssets(localizable, catalog.lang, (p) => existsSync(join(gameDir, 'assets', p)));
    if (Object.keys(assets).length) r.translation.assets = assets;
    out.push(r.translation);
  }
  return out;
}

export function emakiGame(gameDir: string): Plugin {
  const storyPath = resolve(gameDir, 'story.vn');
  const langDir = resolve(gameDir, 'lang');
  // The game's own styles, loaded after the player's (see docs/theming.md).
  const themePath = resolve(gameDir, 'theme.css');
  let devServer = false;
  /** story.vn or one of the story's other files (not a stray .vn in assets/ or a build). */
  const isStoryFile = (f: string) => f === normalize(storyPath)
    || storyParts(gameDir).some((p) => normalize(join(gameDir, p)) === f);

  return {
    name: 'emaki-game',
    configResolved(config) {
      devServer = config.command === 'serve';
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(storyPath);
      for (const part of storyParts(gameDir)) this.addWatchFile(join(gameDir, part));
      const r = compileGame(gameDir);
      for (const d of r.diagnostics) {
        const msg = `${where(d)}: ${d.severity}: ${d.message}`;
        if (d.severity === 'error') this.warn(msg); else this.info?.(msg);
      }
      for (const f of translationFiles(gameDir)) this.addWatchFile(f);
      const translations = r.story
        ? loadTranslations(gameDir, r.strings, (msg, isError) => (isError ? this.warn(msg) : this.info?.(msg)), r.story)
        : [];
      return [
        ...(existsSync(themePath) ? [`import ${JSON.stringify(themePath.replace(/\\/g, '/'))};`] : []),
        `export const story = ${JSON.stringify(r.story)};`,
        `export const translations = ${JSON.stringify(translations)};`,
        `export const diagnostics = ${JSON.stringify(r.diagnostics)};`,
        // Source lines of each file (story.vn under ''), for the error screen.
        `export const sourceLines = ${JSON.stringify(Object.fromEntries([['', r.main], ...r.parts.map((p) => [p.path, p.source])].map(([k, t]) => [k, t!.replace(/\r\n?/g, '\n').split('\n')])))};`,
        // The story map is a dev tool: never ship a spoiler map of the routes in a build.
        `export const graph = ${JSON.stringify(devServer && r.story ? buildGraph(r.program) : null)};`,
      ].join('\n');
    },
    configureServer(server) {
      // New translation files aren't watched yet; watch the folder.
      server.watcher.add(langDir);
      const onLangFile = (file: string) => {
        if (!normalize(file).startsWith(langDir) || !/\.(po|csv)$/i.test(file)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onLangFile);
      server.watcher.on('unlink', onLangFile);
      // Adding or removing theme.css changes what the game imports.
      server.watcher.add(themePath);
      const onTheme = (file: string) => {
        if (normalize(file) !== normalize(themePath)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onTheme);
      server.watcher.on('unlink', onTheme);
      // A new or deleted .vn file changes the story.
      const onScript = (file: string) => {
        const f = normalize(file);
        if (!f.endsWith('.vn') || !f.startsWith(normalize(gameDir)) || !isStoryFile(f)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(gameDir);
      server.watcher.on('add', onScript);
      server.watcher.on('unlink', onScript);
    },
    handleHotUpdate({ file, server }) {
      const f = normalize(file);
      if (!isStoryFile(f) && !(f.startsWith(langDir) && /\.(po|csv)$/i.test(f))) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (mod) server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

/**
 * Vite plugin: compiles the game's story.vn (and its translations in lang/)
 * on the fly and exposes them as `virtual:emaki-game`. Editing the .vn file
 * or a translation triggers a reload; the player resumes at the same line
 * (see Runner.resume).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import type { Plugin } from 'vite';
import {
  buildGraph, compile, compileTranslation, parseCatalog,
  type CompiledTranslation, type SourceString,
} from '@emaki/format';
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
export function loadTranslations(gameDir: string, strings: SourceString[], report: (msg: string, isError: boolean) => void): CompiledTranslation[] {
  const all = [...strings, ...uiSourceStrings()];
  const out: CompiledTranslation[] = [];
  for (const file of translationFiles(gameDir)) {
    const name = file.slice(file.lastIndexOf('lang'));
    const { catalog, diagnostics } = parseCatalog(file, readFileSync(file, 'utf8'));
    for (const d of diagnostics) report(`${name}:${d.line}: ${d.message}`, d.severity === 'error');
    const r = compileTranslation(catalog, all);
    // Problems in a translation point at the story line it translates.
    for (const d of r.diagnostics) report(`${name}: story.vn:${d.line}: ${d.message}`, d.severity === 'error');
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
      const source = readFileSync(storyPath, 'utf8');
      const r = compile(source);
      for (const d of r.diagnostics) {
        const msg = `story.vn:${d.line}: ${d.severity}: ${d.message}`;
        if (d.severity === 'error') this.warn(msg); else this.info?.(msg);
      }
      for (const f of translationFiles(gameDir)) this.addWatchFile(f);
      const translations = r.story
        ? loadTranslations(gameDir, r.strings, (msg, isError) => (isError ? this.warn(msg) : this.info?.(msg)))
        : [];
      return [
        ...(existsSync(themePath) ? [`import ${JSON.stringify(themePath.replace(/\\/g, '/'))};`] : []),
        `export const story = ${JSON.stringify(r.story)};`,
        `export const translations = ${JSON.stringify(translations)};`,
        `export const diagnostics = ${JSON.stringify(r.diagnostics)};`,
        `export const sourceLines = ${JSON.stringify(source.replace(/\r\n?/g, '\n').split('\n'))};`,
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
    },
    handleHotUpdate({ file, server }) {
      const f = normalize(file);
      if (f !== normalize(storyPath) && !(f.startsWith(langDir) && /\.(po|csv)$/i.test(f))) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (mod) server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

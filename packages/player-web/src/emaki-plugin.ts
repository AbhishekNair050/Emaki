/**
 * Vite plugin: compiles the game's story (story.vn plus its other .vn files)
 * and its translations in lang/, which the player fetches as JSON through
 * `virtual:emaki-game` (game.json in a build). Editing, adding or removing a .vn file or a
 * translation triggers a reload; the player resumes at the same line (see
 * Runner.resume).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import {
  buildGraph, compileTranslation, createCompileCache, localizedAssets, localizablePaths, packStory, parseCatalog,
  type CompiledStory, type CompiledTranslation, type Diagnostic, type SourceString, type StoryGraph,
} from '@emaki/format';
import { compileGame, readPlugins, storyParts, where } from '@emaki/format/files';
import { serveAssets } from './assets-middleware.ts';
import { updatePluginTypes } from './plugin-types.ts';
import { uiSourceStrings } from './ui-strings.ts';

const VIRTUAL = 'virtual:emaki-game';
const RESOLVED = '\0' + VIRTUAL;
const PLUGINS = 'virtual:emaki-plugins';
const PLUGINS_RESOLVED = '\0' + PLUGINS;

/**
 * `virtual:emaki-plugins`: each of the game's plugins (plugins/<name>/), its
 * code imported (so it's bundled into builds) and its manifest.
 */
export function pluginModule(gameDir: string): string {
  const { plugins } = readPlugins(gameDir);
  const names = Object.keys(plugins);
  return [
    ...names.map((n, i) => `import p${i} from ${JSON.stringify(plugins[n]!.main.replace(/\\/g, '/'))};`),
    `export const plugins = { ${names.map((n, i) => `${JSON.stringify(n)}: p${i}`).join(', ')} };`,
    `export const manifests = ${JSON.stringify(Object.fromEntries(names.map((n) => [n, plugins[n]!.manifest])))};`,
  ].join('\n');
}

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

/** What the player loads: the story and everything that goes with it (see virtual.d.ts). */
export interface GameData {
  /** Packed (docs/story-format.md); null when the story has errors. */
  story: CompiledStory | null;
  translations: CompiledTranslation[];
  diagnostics: Diagnostic[];
  /** Each file's lines by path ('' for story.vn), for the dev server's error screen: only when the story has errors. */
  sourceLines: Record<string, string[]>;
  /** The story map, a dev tool: never shipped in a build, where it would be a map of every route. */
  graph: StoryGraph | null;
}

/** Where a build puts the game's data, next to index.html. */
const GAME_FILE = 'game.json';
/** Where the dev server answers with it. */
const DEV_GAME_URL = '/@emaki/game.json';

export function emakiGame(gameDir: string): Plugin {
  const storyPath = resolve(gameDir, 'story.vn');
  const langDir = resolve(gameDir, 'lang');
  // The game's own styles, loaded after the player's (see docs/theming.md).
  const themePath = resolve(gameDir, 'theme.css');
  let devServer = false;
  // Edits recompile only the files and labels that changed.
  const cache = createCompileCache();
  /** The dev server's last answer, until a file it came from changes. */
  let devData: string | null = null;
  /** Set by the dev server: compile again on the next load, and reload the page. */
  let changedHook: ((alsoPlugins: boolean) => void) | null = null;
  /** story.vn or one of the story's other files (not a stray .vn in assets/ or a build). */
  const isStoryFile = (f: string) => f === normalize(storyPath)
    || storyParts(gameDir).some((p) => normalize(join(gameDir, p)) === f);

  /** Compile the game; `forBuild` leaves out what only the dev server uses. */
  const gameData = (report: (msg: string, isError: boolean) => void, forBuild: boolean): GameData => {
    const r = compileGame(gameDir, cache);
    for (const d of r.diagnostics) report(`${where(d)}: ${d.severity}: ${d.message}`, d.severity === 'error');
    const translations = r.story ? loadTranslations(gameDir, r.strings, report, r.story) : [];
    const lines = (t: string) => t.replace(/\r\n?/g, '\n').split('\n');
    return {
      story: r.story ? packStory(r.story) : null,
      translations,
      diagnostics: r.diagnostics,
      // Only the error screen shows source lines, and only when there are errors.
      sourceLines: forBuild || r.story ? {} : Object.fromEntries([['', lines(r.main)], ...r.parts.map((p) => [p.path, lines(p.source)])]),
      graph: !forBuild && r.story ? buildGraph(r.program) : null,
    };
  };

  return {
    name: 'emaki-game',
    config(_config, env) {
      if (env.command !== 'serve') return;
      // The dev server reads assets/ from disk as they're asked for (see serveAssets) instead
      // of listing and watching every file, which takes most of a minute for a long game.
      const assets = normalize(resolve(gameDir, 'assets'));
      return {
        publicDir: false,
        server: { watch: { ignored: [(p: string) => normalize(p) === assets || normalize(p).startsWith(assets + sep)] } },
      };
    },
    configResolved(config) {
      devServer = config.command === 'serve';
    },
    buildStart() {
      // A game with plugins keeps its copy of the plugin API's types current.
      updatePluginTypes(gameDir);
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : id === PLUGINS ? PLUGINS_RESOLVED : null;
    },
    load(id) {
      if (id === PLUGINS_RESOLVED) {
        for (const p of Object.values(readPlugins(gameDir).plugins)) this.addWatchFile(join(p.main, '..', 'plugin.json'));
        return pluginModule(gameDir);
      }
      if (id !== RESOLVED) return null;
      // The story is data, fetched as JSON rather than written into this module: a long
      // story would make a module of tens of megabytes for Vite and the browser to parse.
      let url = `${JSON.stringify(DEV_GAME_URL)}`;
      if (!devServer) {
        const data = gameData((msg, isError) => (isError ? this.warn(msg) : this.info?.(msg)), true);
        this.emitFile({ type: 'asset', fileName: GAME_FILE, source: JSON.stringify(data) });
        url = `new URL(${JSON.stringify(GAME_FILE)}, document.baseURI)`;
      }
      return [
        ...(existsSync(themePath) ? [`import ${JSON.stringify(themePath.replace(/\\/g, '/'))};`] : []),
        `import { loadStory } from '@emaki/format';`,
        `export async function loadGame() {`,
        `  const res = await fetch(${url});`,
        `  if (!res.ok) throw new Error('Could not load the game data (' + res.status + ')');`,
        `  const game = await res.json();`,
        `  return { ...game, story: game.story && loadStory(game.story) };`,
        `}`,
      ].join('\n');
    },
    configureServer(server) {
      const log = server.config.logger;
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== DEV_GAME_URL) return next();
        devData ??= JSON.stringify(gameData((msg, isError) => (isError ? log.warn(msg) : log.info(msg)), false));
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(devData);
      });
      server.middlewares.use(serveAssets(resolve(gameDir, 'assets')));
      /** Something the game is made from changed: compile again on the next load, and reload. */
      const changed = (alsoPlugins = false) => {
        devData = null;
        for (const id of alsoPlugins ? [RESOLVED, PLUGINS_RESOLVED] : [RESOLVED]) {
          const mod = server.moduleGraph.getModuleById(id);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      };
      changedHook = changed;
      // New translation files aren't watched yet; watch the folder.
      server.watcher.add(langDir);
      const onLangFile = (file: string) => {
        if (normalize(file).startsWith(langDir) && /\.(po|csv)$/i.test(file)) changed();
      };
      server.watcher.on('add', onLangFile);
      server.watcher.on('unlink', onLangFile);
      // Adding or removing theme.css changes what the game imports.
      server.watcher.add(themePath);
      const onTheme = (file: string) => {
        if (normalize(file) === normalize(themePath)) changed();
      };
      server.watcher.on('add', onTheme);
      server.watcher.on('unlink', onTheme);
      // A new or deleted .vn file changes the story.
      const onScript = (file: string) => {
        const f = normalize(file);
        if (f.endsWith('.vn') && f.startsWith(normalize(gameDir)) && isStoryFile(f)) changed();
      };
      server.watcher.add(gameDir);
      server.watcher.on('add', onScript);
      server.watcher.on('unlink', onScript);
    },
    handleHotUpdate({ file }) {
      const f = normalize(file);
      // A plugin.json describes what the script may write, so it's part of the story.
      if (f.startsWith(normalize(join(gameDir, 'plugins'))) && f.endsWith('plugin.json')) { changedHook?.(true); return []; }
      if (!isStoryFile(f) && !(f.startsWith(langDir) && /\.(po|csv)$/i.test(f))) return;
      changedHook?.(false);
      return [];
    },
  };
}

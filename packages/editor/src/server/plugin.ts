/**
 * Vite plugin for the editor: a tiny API over the game folder.
 *
 *   GET  /__emaki/files   → { files: ['story.vn', 'chapters/two.vn', ...] }
 *   GET  /__emaki/files?text=1 → also { texts: { path: { text, version } } }, every file in one go
 *   POST /__emaki/files   { path } → creates an empty .vn file in the game
 *   GET  /__emaki/story?file=chapters/two.vn   → { text, version }  (default: story.vn)
 *   PUT  /__emaki/story?file=…  { text, base } → { version } or 409 { text, version }
 *   GET  /__emaki/assets  → [{ path, kind, size }]
 *   POST /__emaki/assets?name=file.png  (raw bytes) → { path, kind, size }
 *
 * `virtual:emaki-theme` imports the game's theme.css (if it has one), so the
 * game pane looks like the game; Vite updates it live while it's edited.
 *
 * When a script changes on disk (another editor, git), connected editors get
 * an `emaki:story-changed` event with its file and new version and decide what
 * to do; when .vn files appear or disappear, `emaki:files-changed`; when files
 * appear or disappear under assets/, `emaki:assets-changed`.
 */
import { existsSync, mkdirSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { MAIN_FILE, readPlugins, storyParts } from '@emaki/format/files';
import { pluginModule } from '@emaki/player-web/plugin';
import { updatePluginTypes } from '@emaki/player-web/plugin-types';
import { localHostsOnly } from '@emaki/player-web/host-guard';
import { serveAssets } from '@emaki/player-web/assets-middleware';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { AssetError, AssetStore, MAX_ASSET_BYTES } from './asset-store.ts';
import { StoryFile } from './story-file.ts';

const MAX_BODY = 10 * 1024 * 1024;
const THEME = 'virtual:emaki-theme';
const RESOLVED_THEME = '\0' + THEME;
/** The game's plugins (code and manifests), as the player's dev server gives them. */
const PLUGINS = 'virtual:emaki-plugins';
const RESOLVED_PLUGINS = '\0' + PLUGINS;

export function emakiEditor(gameDir: string): Plugin {
  gameDir = resolve(gameDir);
  const assets = new AssetStore(resolve(gameDir, 'assets'));
  // The story's files, listed again only when a .vn file appears or disappears:
  // every request checks its path against the list, and a long game has hundreds.
  let fileList: string[] | null = null;
  const files = () => (fileList ??= [MAIN_FILE, ...storyParts(gameDir)]);
  const filesChanged = () => { fileList = null; };
  /** The story file at a path from the browser, or null if it isn't one of the story's files. */
  const fileAt = (path: string | null): StoryFile | null => {
    const rel = path ?? MAIN_FILE;
    return files().includes(rel) ? new StoryFile(join(gameDir, rel)) : null;
  };
  const relPath = (abs: string) => relative(gameDir, resolve(abs)).split(sep).join('/');
  const themePath = join(gameDir, 'theme.css');

  return {
    name: 'emaki-editor',
    config() {
      // Assets are read from disk as they're asked for (see serveAssets), not listed and
      // watched one by one through Vite's public folder: slow for a game with thousands.
      const root = resolve(gameDir, 'assets');
      return { publicDir: false, server: { watch: { ignored: [(p: string) => resolve(p) === root || resolve(p).startsWith(root + sep)] } } };
    },
    resolveId(id) {
      return id === THEME ? RESOLVED_THEME : id === PLUGINS ? RESOLVED_PLUGINS : null;
    },
    load(id) {
      if (id === RESOLVED_PLUGINS) {
        for (const p of Object.values(readPlugins(gameDir).plugins)) this.addWatchFile(join(p.main, '..', 'plugin.json'));
        return pluginModule(gameDir);
      }
      if (id !== RESOLVED_THEME) return null;
      return existsSync(themePath) ? `import ${JSON.stringify(themePath.replace(/\\/g, '/'))};` : '';
    },
    configureServer(server) {
      // First of all: the editor's routes below read and write the game's files, and run before Vite's host check (see host-guard.ts).
      server.middlewares.use(localHostsOnly(server.config.server.allowedHosts));
      updatePluginTypes(gameDir); // a game with plugins keeps its copy of the plugin API's types current
      // The game's assets, from the root, exactly where the player looks for them.
      server.middlewares.use(serveAssets(assets.root));
      server.middlewares.use('/__emaki/files', (req, res) => {
        void handleFiles(gameDir, files, req, res, filesChanged).catch((err: unknown) => {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        });
      });

      server.middlewares.use('/__emaki/story', (req, res) => {
        const story = fileAt(new URL(req.url ?? '', 'http://x').searchParams.get('file'));
        if (!story) return send(res, 404, { error: 'That isn’t one of the story’s files.' });
        void handleStory(story, req, res).catch((err: unknown) => {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        });
      });

      server.middlewares.use('/__emaki/assets', (req, res) => {
        void handleAssets(assets, req, res).catch((err: unknown) => {
          send(res, err instanceof AssetError ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
        });
      });

      server.watcher.add(gameDir);
      // One native watch for the whole assets folder (Vite's watcher skips it, see config()).
      let assetTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (existsSync(assets.root)) {
          const w = watch(assets.root, { recursive: true }, () => {
            clearTimeout(assetTimer);
            assetTimer = setTimeout(() => server.ws.send({ type: 'custom', event: 'emaki:assets-changed', data: {} }), 200);
          });
          server.httpServer?.once('close', () => w.close());
        }
      } catch { /* no recursive watching here: the asset list refreshes when the editor reloads */ }
      const isScript = (file: string) => file.endsWith('.vn') && files().includes(relPath(file));
      // Adding or removing theme.css changes what the page imports.
      const themeToggled = (file: string) => {
        if (resolve(file) !== themePath) return false;
        const mod = server.moduleGraph.getModuleById(RESOLVED_THEME);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
        return true;
      };
      const added = (file: string) => {
        if (themeToggled(file)) return;
        if (file.endsWith('.vn')) filesChanged();
        if (isScript(file)) server.ws.send({ type: 'custom', event: 'emaki:files-changed', data: { files: files() } });
      };
      server.watcher.on('add', added);
      server.watcher.on('unlink', (file) => {
        if (themeToggled(file)) return;
        if (file.endsWith('.vn')) {
          filesChanged();
          server.ws.send({ type: 'custom', event: 'emaki:files-changed', data: { files: files() } });
        }
      });
      server.watcher.on('change', (file) => {
        if (!isScript(file)) return;
        const story = new StoryFile(resolve(file));
        server.ws.send({ type: 'custom', event: 'emaki:story-changed', data: { file: relPath(file), version: story.version() } });
      });
    },
  };
}

/** List the story's files, or create a new one (`chapters/two.vn`, inside the game folder, never over an existing file). */
async function handleFiles(gameDir: string, files: () => string[], req: IncomingMessage, res: ServerResponse, changed: () => void): Promise<void> {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Requests from other sites are not allowed.' });
  if (req.method === 'GET') {
    if (!new URL(req.url ?? '', 'http://x').searchParams.has('text')) return send(res, 200, { files: files() });
    const texts = Object.fromEntries(files().map((f) => [f, new StoryFile(join(gameDir, f)).read()]));
    return send(res, 200, { files: files(), texts });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
  if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' });
  const body = JSON.parse(await readBody(req)) as { path?: unknown };
  const path = typeof body.path === 'string' ? newFilePath(body.path) : null;
  if (!path) return send(res, 400, { error: 'Use a name like chapter2.vn or chapters/two.vn: letters, digits, - and _, inside the game folder.' });
  const abs = join(gameDir, path);
  if (existsSync(abs)) return send(res, 409, { error: `${path} already exists.` });
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, '', 'utf8');
  changed();
  send(res, 201, { path, files: files() });
}

/** A safe relative path for a new script: folders and a name of letters, digits, - and _, ending in .vn. */
export function newFilePath(raw: string): string | null {
  let p = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p.endsWith('.vn')) p += '.vn';
  const parts = p.split('/');
  if (!parts.every((x) => /^[A-Za-z0-9_-]+(\.vn)?$/.test(x)) || parts.slice(0, -1).some((x) => x.endsWith('.vn'))) return null;
  if (p === MAIN_FILE) return null;
  // Folders that never hold scripts (see @emaki/format/files).
  if (parts.length > 1 && ['assets', 'lang', 'dist', 'export', 'node_modules', 'tools'].includes(parts[0]!)) return null;
  return p;
}

async function handleStory(story: StoryFile, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Requests from other sites are not allowed.' });
  if (req.method === 'GET') return send(res, 200, story.read());
  if (req.method !== 'PUT') return send(res, 405, { error: 'Use GET or PUT.' });
  if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' });

  const body = JSON.parse(await readBody(req)) as { text?: unknown; base?: unknown };
  if (typeof body.text !== 'string' || typeof body.base !== 'string') return send(res, 400, { error: 'Expected { text, base }.' });
  const result = story.save(body.text, body.base);
  if (result.ok) send(res, 200, { version: result.version });
  else send(res, 409, result.conflict);
}

/**
 * The script is on the writer's disk, so only the editor page itself may
 * touch it: a web page open in another tab must not be able to rewrite it.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return req.headers['sec-fetch-site'] !== 'cross-site';
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function handleAssets(assets: AssetStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Requests from other sites are not allowed.' });
  if (req.method === 'GET') return send(res, 200, assets.list());
  if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
  if (req.headers['content-type'] !== 'application/octet-stream') return send(res, 415, { error: 'Send the file as application/octet-stream.' });
  const name = new URL(req.url ?? '', 'http://x').searchParams.get('name');
  if (!name) return send(res, 400, { error: 'Missing ?name=' });
  const data = await readBytes(req, MAX_ASSET_BYTES);
  send(res, 200, assets.add(name, data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return (await readBytes(req, MAX_BODY)).toString('utf8');
}

function readBytes(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new AssetError(`That file is larger than ${Math.round(max / 1024 / 1024)} MB.`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

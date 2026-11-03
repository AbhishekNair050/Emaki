/**
 * Vite plugin for the editor: a tiny API over the game folder.
 *
 *   GET  /__emaki/files   → { files: ['story.vn', 'chapters/two.vn', ...] }
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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { MAIN_FILE, storyParts } from '@emaki/format/files';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { AssetError, AssetStore, MAX_ASSET_BYTES } from './asset-store.ts';
import { StoryFile } from './story-file.ts';

const MAX_BODY = 10 * 1024 * 1024;
const THEME = 'virtual:emaki-theme';
const RESOLVED_THEME = '\0' + THEME;

export function emakiEditor(gameDir: string): Plugin {
  gameDir = resolve(gameDir);
  const assets = new AssetStore(resolve(gameDir, 'assets'));
  const files = () => [MAIN_FILE, ...storyParts(gameDir)];
  /** The story file at a path from the browser, or null if it isn't one of the story's files. */
  const fileAt = (path: string | null): StoryFile | null => {
    const rel = path ?? MAIN_FILE;
    return files().includes(rel) ? new StoryFile(join(gameDir, rel)) : null;
  };
  const relPath = (abs: string) => relative(gameDir, resolve(abs)).split(sep).join('/');
  const themePath = join(gameDir, 'theme.css');

  return {
    name: 'emaki-editor',
    resolveId(id) {
      return id === THEME ? RESOLVED_THEME : null;
    },
    load(id) {
      if (id !== RESOLVED_THEME) return null;
      return existsSync(themePath) ? `import ${JSON.stringify(themePath.replace(/\\/g, '/'))};` : '';
    },
    configureServer(server) {
      server.middlewares.use('/__emaki/files', (req, res) => {
        void handleFiles(gameDir, files, req, res).catch((err: unknown) => {
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

      server.watcher.add([gameDir, assets.root]);
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
        if (resolve(file).startsWith(assets.root)) server.ws.send({ type: 'custom', event: 'emaki:assets-changed', data: {} });
        else if (isScript(file)) server.ws.send({ type: 'custom', event: 'emaki:files-changed', data: { files: files() } });
      };
      server.watcher.on('add', added);
      server.watcher.on('unlink', (file) => {
        if (themeToggled(file)) return;
        if (resolve(file).startsWith(assets.root)) server.ws.send({ type: 'custom', event: 'emaki:assets-changed', data: {} });
        else if (file.endsWith('.vn')) server.ws.send({ type: 'custom', event: 'emaki:files-changed', data: { files: files() } });
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
async function handleFiles(gameDir: string, files: () => string[], req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Requests from other sites are not allowed.' });
  if (req.method === 'GET') return send(res, 200, { files: files() });
  if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
  if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' });
  const body = JSON.parse(await readBody(req)) as { path?: unknown };
  const path = typeof body.path === 'string' ? newFilePath(body.path) : null;
  if (!path) return send(res, 400, { error: 'Use a name like chapter2.vn or chapters/two.vn: letters, digits, - and _, inside the game folder.' });
  const abs = join(gameDir, path);
  if (existsSync(abs)) return send(res, 409, { error: `${path} already exists.` });
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, '', 'utf8');
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

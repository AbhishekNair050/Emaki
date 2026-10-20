/**
 * Vite plugin for the editor: a tiny API over the game folder.
 *
 *   GET  /__emaki/story   → { text, version }
 *   PUT  /__emaki/story   { text, base } → { version } or 409 { text, version }
 *   GET  /__emaki/assets  → [{ path, kind, size }]
 *   POST /__emaki/assets?name=file.png  (raw bytes) → { path, kind, size }
 *
 * When story.vn changes on disk (another editor, git), connected editors get
 * an `emaki:story-changed` event with the new version and decide what to do;
 * when files appear or disappear under assets/, `emaki:assets-changed`.
 */
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { AssetError, AssetStore, MAX_ASSET_BYTES } from './asset-store.ts';
import { StoryFile } from './story-file.ts';

const MAX_BODY = 10 * 1024 * 1024;

export function emakiEditor(gameDir: string): Plugin {
  const story = new StoryFile(resolve(gameDir, 'story.vn'));
  const assets = new AssetStore(resolve(gameDir, 'assets'));

  return {
    name: 'emaki-editor',
    configureServer(server) {
      server.middlewares.use('/__emaki/story', (req, res) => {
        void handleStory(story, req, res).catch((err: unknown) => {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        });
      });

      server.middlewares.use('/__emaki/assets', (req, res) => {
        void handleAssets(assets, req, res).catch((err: unknown) => {
          send(res, err instanceof AssetError ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
        });
      });

      server.watcher.add([story.path, assets.root]);
      const assetsChanged = (file: string) => {
        if (resolve(file).startsWith(assets.root)) server.ws.send({ type: 'custom', event: 'emaki:assets-changed', data: {} });
      };
      server.watcher.on('add', assetsChanged);
      server.watcher.on('unlink', assetsChanged);
      server.watcher.on('change', (file) => {
        if (resolve(file) !== story.path) return;
        server.ws.send({ type: 'custom', event: 'emaki:story-changed', data: { version: story.version() } });
      });
    },
  };
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

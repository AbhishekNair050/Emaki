import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type ViteDevServer } from 'vite';
import { DEFAULT_PROJECTS_DIR, Projects, projectPath } from './projects.ts';
import { openOnDesktop, Sessions, type SessionKind } from './serve.ts';
import { assetFile, PICTURE_TYPES, storySignature, type ProjectInfo } from './project-info.ts';
import { TARGETS, type Target } from './export.ts';
import { findTools, missingTool, parseCompression, readCompression, writeCompression } from './compress.ts';

interface ExportJob {
  id: number; path: string; target: Target; status: 'running' | 'done' | 'failed';
  log: string; output: string;
}
export interface Launcher {
  server: ViteDevServer;
  url: string;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

/** Browsing and changing local files is available only to this loopback page. */
export function localRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return false;
  return true;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Send a JSON request.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16_384) throw new Error('The request is too large.');
    chunks.push(chunk as Buffer);
  }
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object.');
  return data as Record<string, unknown>;
}

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) throw new Error(`Enter a valid ${key}.`);
  return value;
}

export function browse(input: string): { path: string; parent: string | null; folders: string[]; game: boolean; roots: string[] } {
  const path = resolve(input);
  const folders = readdirSync(path, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && e.isDirectory() && e.name !== 'node_modules')
    .map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const roots = process.platform === 'win32'
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((d) => `${d}:\\`).filter((p) => existsSync(p))
    : ['/'];
  return { path, parent: dirname(path) === path ? null : dirname(path), folders, game: existsSync(join(path, 'story.vn')), roots };
}

export async function startLauncher(opts: { port?: number; stateFile?: string; open?: boolean } = {}): Promise<Launcher> {
  const projects = new Projects(opts.stateFile);
  const sessions = new Sessions();
  const children = new Set<ChildProcess>();
  const jobs: ExportJob[] = [];
  let nextJob = 1;
  let closing = false;
  const known = (path: string) => {
    const project = projects.list().find((p) => p.path === path);
    if (!project) throw new Error('Open this project in the launcher first.');
    return project;
  };
  // Each project's info, worked out in a worker and kept until a story file changes (see project-info.ts).
  const infos = new Map<string, { signature: string; info?: ProjectInfo; error?: string; worker?: Worker }>();
  const infoOf = (path: string): { working: boolean; info: ProjectInfo | null; error: string | null } => {
    let signature: string;
    try { signature = storySignature(path); } catch { return { working: false, info: null, error: 'The story files could not be read.' }; }
    const entry = infos.get(path);
    if (entry && (entry.signature === signature || entry.worker)) {
      return { working: !!entry.worker || entry.signature !== signature, info: entry.info ?? null, error: entry.error ?? null };
    }
    const worker = new Worker(resolve(import.meta.dirname, 'project-info-worker.ts'), { workerData: path });
    const next = { signature, ...(entry?.info ? { info: entry.info } : {}), worker };
    infos.set(path, next);
    const done = (result: { info?: ProjectInfo; error?: string }) => {
      if (infos.get(path) !== next) return;
      infos.set(path, { signature, ...(result.info ? { info: result.info } : next.info ? { info: next.info } : {}), ...(result.error ? { error: result.error } : {}) });
    };
    worker.once('message', done);
    worker.once('error', (err) => done({ error: err.message }));
    worker.once('exit', () => { if (infos.get(path) === next) done({ error: 'The project could not be read.' }); });
    return { working: true, info: entry?.info ?? null, error: null };
  };
  const kindOf = (data: Record<string, unknown>): SessionKind => {
    if (data.kind !== 'editor' && data.kind !== 'play') throw new Error('Choose Editor or Play.');
    return data.kind;
  };

  async function api(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!localRequest(req)) return send(res, 403, { error: 'Only requests from the local launcher are allowed.' });
    if (closing) return send(res, 503, { error: 'The launcher is shutting down.' });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = url.pathname;
    if (req.method === 'GET' && route === '/__launcher/state') {
      return send(res, 200, { projects: projects.list(), sessions: sessions.list(), jobs, defaultDirectory: DEFAULT_PROJECTS_DIR, home: homedir(), platform: process.platform });
    }
    if (req.method === 'GET' && route === '/__launcher/info') {
      const path = url.searchParams.get('path') ?? '';
      known(path);
      return send(res, 200, infoOf(path));
    }
    if (req.method === 'GET' && route === '/__launcher/picture') {
      const path = url.searchParams.get('path') ?? '';
      known(path);
      const picture = infos.get(path)?.info?.picture;
      const file = picture ? assetFile(path, picture) : null;
      if (!file) return send(res, 404, { error: 'This project has no picture yet.' });
      res.writeHead(200, { 'Content-Type': PICTURE_TYPES[extname(file).toLowerCase()]!, 'Cache-Control': 'no-cache' });
      createReadStream(file).pipe(res);
      return;
    }
    if (req.method === 'GET' && route === '/__launcher/compression') {
      const path = projectPath(url.searchParams.get('path') ?? '');
      known(path);
      const tools = findTools(url.searchParams.has('recheck'));
      return send(res, 200, { settings: readCompression(path), missing: { audio: missingTool('audio', tools), video: missingTool('video', tools) } });
    }
    if (req.method === 'GET' && route === '/__launcher/browse') {
      return send(res, 200, browse(url.searchParams.get('path') || homedir()));
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST for this action.' });
    const data = await body(req);
    if (route === '/__launcher/example') return send(res, 200, projects.add(resolve(import.meta.dirname, '../../../games/gullwing')));
    if (route === '/__launcher/open') return send(res, 200, projects.add(text(data, 'path')));
    if (route === '/__launcher/create') return send(res, 201, projects.create(text(data, 'parent'), text(data, 'folder'), text(data, 'title')));
    if (route === '/__launcher/remove') {
      const path = text(data, 'path');
      known(path);
      if (sessions.has(path) || jobs.some((j) => j.path === path && j.status === 'running')) {
        throw new Error('Stop this project’s sessions and wait for its export to finish before removing it from the list.');
      }
      projects.remove(path);
      return send(res, 200, {});
    }
    if (route === '/__launcher/start') {
      const path = text(data, 'path');
      known(path);
      const session = await sessions.start(path, kindOf(data));
      projects.add(path);
      return send(res, 200, session);
    }
    if (route === '/__launcher/stop') {
      const path = text(data, 'path');
      await sessions.stop(path, kindOf(data));
      return send(res, 200, {});
    }
    if (route === '/__launcher/compression') {
      const path = projectPath(text(data, 'path'));
      known(path);
      writeCompression(path, parseCompression(data.settings));
      return send(res, 200, { settings: readCompression(path) });
    }
    if (route === '/__launcher/folder') {
      const path = text(data, 'path');
      known(path);
      const target = data.output === true ? join(projectPath(path), 'export') : path;
      if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error('That folder does not exist yet. Export the game first.');
      await openOnDesktop(target);
      return send(res, 200, {});
    }
    if (route === '/__launcher/export') {
      const path = projectPath(text(data, 'path'));
      known(path);
      if (!TARGETS.includes(data.target as Target)) throw new Error('Choose Web, Desktop, Android or iOS.');
      const target = data.target as Target;
      if (jobs.some((j) => j.status === 'running')) throw new Error('An export is already running. Wait for it to finish.');
      const job: ExportJob = { id: nextJob++, path, target, status: 'running', log: '', output: join(path, 'export', target === 'android' || target === 'ios' ? 'mobile' : target) };
      // Keep memory bounded, including after many exports in a long launcher session.
      if (jobs.length >= 10) jobs.shift();
      jobs.push(job);
      const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
      delete env.NODE_ENV;
      // In Emaki Studio, process.execPath is the app itself: run it as plain Node for the export.
      if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
      const child = spawn(process.execPath, [resolve(import.meta.dirname, 'main.ts'), 'export', target, path], {
        cwd: resolve(import.meta.dirname, '../../..'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      children.add(child);
      const append = (chunk: Buffer) => { job.log = (job.log + chunk.toString('utf8')).slice(-80_000); };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.on('error', (err) => { job.log += `\n${err.message}`; job.status = 'failed'; });
      child.on('close', (code) => { children.delete(child); job.status = code === 0 ? 'done' : 'failed'; });
      return send(res, 202, job);
    }
    send(res, 404, { error: 'Unknown launcher action.' });
  }

  const server = await createServer({
    configFile: false, root: resolve(import.meta.dirname, '../launcher'), clearScreen: false,
    // The launcher has no browser dependencies to prebundle.
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: opts.port ?? 5175, open: false, fs: { allow: [resolve(import.meta.dirname, '../../..')] } },
    plugins: [{
      name: 'emaki-launcher',
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/__launcher/')) return next();
          void api(req, res).catch((err: unknown) => send(res, 400, { error: err instanceof Error ? err.message : String(err) }));
        });
      },
    }],
  });
  try { await server.listen(); } catch (err) { await server.close(); throw err; }
  const url = server.resolvedUrls?.local[0];
  if (!url) { await server.close(); throw new Error('The launcher could not start.'); }
  const close = async () => {
    closing = true;
    for (const child of children) child.kill();
    for (const entry of infos.values()) void entry.worker?.terminate();
    await sessions.close();
    await server.close();
  };
  if (opts.open !== false) await openOnDesktop(url).catch(() => console.log(`Open ${url} in your browser.`));
  return { server, url, close };
}

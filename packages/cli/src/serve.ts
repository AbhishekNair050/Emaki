import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { gameConfig } from '@emaki/player-web/build';
import { editorConfig } from '@emaki/editor/config';
import { projectPath } from './projects.ts';

export type SessionKind = 'editor' | 'play';
export interface Session { path: string; kind: SessionKind; url: string }

/** Open a URL or folder without shell interpolation (including paths with spaces). */
export function openOnDesktop(target: string): Promise<void> {
  const [command, args] = process.platform === 'win32'
    ? ['explorer.exe', [target]] as const
    : process.platform === 'darwin' ? ['open', [target]] as const : ['xdg-open', [target]] as const;
  return new Promise((done, reject) => {
    const child = spawn(command, [...args], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); done(); });
  });
}

/** Owns Vite servers, reusing one per project and mode; closing the launcher closes them. */
export class Sessions {
  private readonly servers = new Map<string, { server: ViteDevServer; session: Session }>();
  private readonly pending = new Map<string, Promise<Session>>();

  list(): Session[] { return [...this.servers.values()].map((s) => s.session); }

  has(path: string): boolean {
    return this.list().some((s) => s.path === path)
      || (['editor', 'play'] as const).some((kind) => this.pending.has(`${kind}:${path}`));
  }

  async start(input: string, kind: SessionKind): Promise<Session> {
    const path = projectPath(input);
    const key = `${kind}:${path}`;
    const existing = this.servers.get(key);
    if (existing) return existing.session;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const task = this.create(path, kind, key);
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }

  private async create(path: string, kind: SessionKind, key: string): Promise<Session> {
    const config = kind === 'editor' ? editorConfig(path) : gameConfig(path, resolve(path, 'dist'));
    const cache = createHash('sha256').update(path).digest('hex').slice(0, 16);
    const server = await createServer({
      ...config, configFile: false,
      // Several games can be open at once without replacing each other's optimized dependencies.
      cacheDir: resolve(import.meta.dirname, '../../../node_modules/.vite/emaki-sessions', `${kind}-${cache}`),
      server: { ...config.server, host: '127.0.0.1', port: kind === 'editor' ? 5174 : 5173, open: false },
    });
    try {
      await server.listen();
      const url = server.resolvedUrls?.local[0];
      if (!url) throw new Error('The preview server did not return an address.');
      const session = { path, kind, url };
      this.servers.set(key, { server, session });
      return session;
    } catch (err) { await server.close(); throw err; }
  }

  async stop(path: string, kind: SessionKind): Promise<void> {
    const key = `${kind}:${path}`;
    await this.pending.get(key);
    const entry = this.servers.get(key);
    if (entry) { await entry.server.close(); this.servers.delete(key); }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.pending.values());
    await Promise.all([...this.servers.values()].map((s) => s.server.close()));
    this.servers.clear();
  }
}

export function installShutdown(close: () => Promise<void>): void {
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void close().then(() => process.exit(0), (err: unknown) => { console.error(err); process.exit(1); });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLauncher, type Launcher } from '../src/launcher.ts';

describe('local launcher API', () => {
  let root: string;
  let launcher: Launcher;
  const post = (route: string, data: unknown, headers: Record<string, string> = {}) => fetch(`${launcher.url}__launcher/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data),
  });
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'emaki-launcher-http-'));
    launcher = await startLauncher({ port: 0, stateFile: join(root, 'launcher.json'), open: false });
  }, 20_000);
  afterAll(async () => { await launcher?.close(); if (root) rmSync(root, { recursive: true, force: true }); });

  it('rejects requests from another origin before reading or modifying files', async () => {
    expect((await post('create', { parent: root, folder: 'blocked', title: 'Blocked' }, { Origin: 'https://example.com' })).status).toBe(403);
    expect((await fetch(`${launcher.url}__launcher/state`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  });

  it('creates, browses, reopens and forgets a game without deleting its files', async () => {
    const response = await post('create', { parent: root, folder: 'A game with spaces', title: 'A <story>' });
    expect(response.status).toBe(201);
    const p = await response.json() as { path: string; title: string };
    const browse = await fetch(`${launcher.url}__launcher/browse?path=${encodeURIComponent(p.path)}`);
    expect(await browse.json()).toMatchObject({ path: p.path, game: true, folders: ['assets'] });
    expect((await post('open', { path: join(p.path, 'story.vn') })).status).toBe(200);
    const state = await fetch(`${launcher.url}__launcher/state`).then((r) => r.json()) as { projects: unknown[] };
    expect(state.projects).toHaveLength(1);
    expect((await post('create', { parent: root, folder: 'A game with spaces', title: 'Overwrite' })).status).toBe(400);
    expect((await post('remove', { path: p.path })).status).toBe(200);
    expect(readFileSync(join(p.path, 'story.vn'), 'utf8')).toContain('A <story>');
  });

  it('works out a project’s info off the main thread, then serves its picture', async () => {
    const p = await (await post('create', { parent: root, folder: 'Info game', title: 'Info' })).json() as { path: string };
    const info = `${launcher.url}__launcher/info?path=${encodeURIComponent(p.path)}`;
    let r = await fetch(info).then((x) => x.json()) as { working: boolean; info: { scenes: number; errors: number } | null };
    for (let i = 0; i < 100 && r.working; i++) {
      await new Promise((ok) => setTimeout(ok, 50));
      r = await fetch(info).then((x) => x.json()) as typeof r;
    }
    expect(r.working).toBe(false);
    expect(r.info).toMatchObject({ errors: 0 });
    expect(r.info!.scenes).toBeGreaterThan(0);
    // Only known projects are read.
    expect((await fetch(`${launcher.url}__launcher/info?path=${encodeURIComponent(root)}`)).status).toBe(400);
    const picture = await fetch(`${launcher.url}__launcher/picture?path=${encodeURIComponent(p.path)}`);
    expect([200, 404]).toContain(picture.status);
    await post('remove', { path: p.path });
  });

  it('refuses to start an arbitrary unregistered folder or invalid session type', async () => {
    expect((await post('start', { path: root, kind: 'editor' })).status).toBe(400);
    expect((await post('export', { path: root, target: 'anything' })).status).toBe(400);
  });
});

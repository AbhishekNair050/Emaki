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

  it('refuses to start an arbitrary unregistered folder or invalid session type', async () => {
    expect((await post('start', { path: root, kind: 'editor' })).status).toBe(400);
    expect((await post('export', { path: root, target: 'anything' })).status).toBe(400);
  });
});

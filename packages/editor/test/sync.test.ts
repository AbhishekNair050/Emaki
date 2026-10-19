import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorySync, type SaveStatus, type StoryText } from '../src/sync.ts';

/** An in-memory stand-in for the editor server: same rules as StoryFile. */
function fakeServer(text: string) {
  let n = 0;
  const disk = { text, version: 'v0' };
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (!init || init.method !== 'PUT') return Response.json({ ...disk });
    const body = JSON.parse(String(init.body)) as { text: string; base: string };
    if (body.base !== disk.version) return Response.json({ ...disk }, { status: 409 });
    disk.text = body.text;
    disk.version = `v${++n}`;
    return Response.json({ version: disk.version });
  });
  /** Someone else edits the file. */
  const editElsewhere = (t: string) => { disk.text = t; disk.version = `x${++n}`; return disk.version; };
  return { disk, fetch: fetch as unknown as typeof globalThis.fetch, editElsewhere };
}

function setup(text = 'A') {
  const server = fakeServer(text);
  const log: SaveStatus[] = [];
  const reloads: string[] = [];
  const conflicts: StoryText[] = [];
  const sync = new StorySync({ text, version: 'v0' }, {
    status: (s) => log.push(s),
    reload: (t) => reloads.push(t),
    conflict: (c) => conflicts.push(c),
  }, { fetch: server.fetch, autosaveMs: 100 });
  return { server, sync, log, reloads, conflicts };
}

describe('StorySync', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('saves on its own shortly after typing stops', async () => {
    const { server, sync, log } = setup();
    sync.changed('AB');
    sync.changed('ABC');
    expect(log.at(-1)).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(150);
    expect(server.disk.text).toBe('ABC');
    expect(log.at(-1)).toBe('saved');
    expect(sync.dirty).toBe(false);
  });

  it('typing back to the saved text needs no save', async () => {
    const { server, sync, log } = setup();
    sync.changed('AB');
    sync.changed('A');
    expect(log.at(-1)).toBe('saved');
    await vi.advanceTimersByTimeAsync(150);
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('loads changes made on disk when there are no unsaved edits', async () => {
    const { server, sync, reloads } = setup();
    const v = server.editElsewhere('From VS Code');
    await sync.external(v);
    expect(reloads).toEqual(['From VS Code']);
    sync.changed('From VS Code, then the editor');
    await vi.advanceTimersByTimeAsync(150);
    expect(server.disk.text).toBe('From VS Code, then the editor');
  });

  it('asks which version to keep when both sides changed', async () => {
    const { server, sync, conflicts, log } = setup();
    sync.changed('Mine');
    server.editElsewhere('Theirs');
    await vi.advanceTimersByTimeAsync(150);
    expect(conflicts.map((c) => c.text)).toEqual(['Theirs']);
    expect(log.at(-1)).toBe('conflict');
    expect(server.disk.text).toBe('Theirs');
    // No autosave while the question is open.
    sync.changed('Mine, still typing');
    await vi.advanceTimersByTimeAsync(500);
    expect(server.disk.text).toBe('Theirs');

    await sync.keepMine();
    expect(server.disk.text).toBe('Mine, still typing');
    expect(log.at(-1)).toBe('saved');
  });

  it('can drop local edits in favour of the file', async () => {
    const { server, sync, reloads } = setup();
    sync.changed('Mine');
    const v = server.editElsewhere('Theirs');
    await sync.external(v);
    sync.takeTheirs();
    expect(reloads).toEqual(['Theirs']);
    expect(sync.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(server.disk.text).toBe('Theirs');
  });

  it('ignores the change event caused by its own save', async () => {
    const { server, sync, reloads, conflicts } = setup();
    sync.changed('AB');
    await sync.saveNow();
    await sync.external(server.disk.version);
    expect(reloads).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it('keeps retrying when the server is unreachable', async () => {
    const { server, sync, log } = setup();
    const real = server.fetch;
    let down = true;
    const flaky = vi.fn((url: string, init?: RequestInit) => (down ? Promise.reject(new TypeError('offline')) : real(url, init)));
    const s2 = new StorySync({ text: 'A', version: 'v0' }, { status: (s) => log.push(s), reload() {}, conflict() {} },
      { fetch: flaky as unknown as typeof fetch, autosaveMs: 100, retryMs: 1000 });
    void sync;
    s2.changed('AB');
    await vi.advanceTimersByTimeAsync(150);
    expect(log.at(-1)).toBe('error');
    down = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.disk.text).toBe('AB');
    expect(log.at(-1)).toBe('saved');
  });
});

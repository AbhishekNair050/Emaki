import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadLines } from '../src/read-lines.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings.ts';

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  let writes = 0;
  return {
    data,
    get writes() { return writes; },
    get: (k: string) => data[k] ?? null,
    set: (k: string, v: string) => { writes++; data[k] = v; },
  };
}

afterEach(() => vi.useRealTimers());

describe('read lines', () => {
  it('remembers ids across sessions, writing in batches', () => {
    vi.useFakeTimers();
    const store = memory();
    const read = new ReadLines('g:read', store, 500);
    for (let i = 0; i < 100; i++) read.add(`id${i}`);
    read.add('id5');
    expect(store.writes).toBe(0);
    vi.advanceTimersByTime(500);
    expect(store.writes).toBe(1);
    const again = new ReadLines('g:read', store);
    expect(again.has('id42')).toBe(true);
    expect(again.has('nope')).toBe(false);
    expect(again.size).toBe(100);
  });

  it('flushes on demand and survives corrupt data', () => {
    const store = memory({ 'g:read': '{oops' });
    const read = new ReadLines('g:read', store);
    expect(read.size).toBe(0);
    read.add('a');
    read.flush();
    expect(JSON.parse(store.data['g:read']!)).toEqual(['a']);
    read.flush();
    expect(store.writes).toBe(1);
  });

  it('skip mode is a setting that defaults to read text only', () => {
    expect(DEFAULT_SETTINGS.skipMode).toBe('read');
    expect(sanitizeSettings({ skipMode: 'all' }).skipMode).toBe('all');
    expect(sanitizeSettings({ skipMode: 'everything' }).skipMode).toBe('read');
  });
});

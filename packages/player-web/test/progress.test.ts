import { describe, expect, it } from 'vitest';
import { Progress } from '../src/progress.ts';
import { titleButtons } from '../src/player.ts';

describe('extras progress', () => {
  it('remembers gallery images and endings across sessions', () => {
    const data: Record<string, string> = {};
    const store = { get: (k: string) => data[k] ?? null, set: (k: string, v: string) => { data[k] = v; } };
    const p = new Progress('g', store);
    expect(p.seeImage('beach')).toBe(true);
    expect(p.seeImage('beach')).toBe(false);
    expect(p.reachEnding('sunrise')).toBe(true);
    const again = new Progress('g', store);
    expect(again.hasSeen('beach')).toBe(true);
    expect(again.hasReached('sunrise')).toBe(true);
    expect(again.hasReached('alone')).toBe(false);
    data['g:gallery'] = 'nonsense';
    expect(new Progress('g', store).hasSeen('beach')).toBe(false);
  });

  it('puts Extras among the default title buttons', () => {
    expect(titleButtons(undefined)).toEqual(['start', 'load', 'extras', 'settings', 'quit']);
    expect(titleButtons('start, settings')).toEqual(['start', 'settings']);
  });
});

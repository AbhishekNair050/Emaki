import { describe, expect, it } from 'vitest';
import { nearest } from '../src/gamepad.ts';

/** A stand-in element at a place on screen. */
const at = (name: string, left: number, top: number, w = 100, h = 40) =>
  ({ name, getBoundingClientRect: () => ({ left, top, width: w, height: h }) }) as unknown as HTMLElement & { name: string };
const rect = (left: number, top: number, w = 100, h = 40) => ({ left, top, width: w, height: h }) as DOMRect;

describe('gamepad focus', () => {
  // A title menu in a column, and a Back button off to the right.
  const all = [at('start', 100, 100), at('load', 100, 160), at('quit', 100, 220), at('back', 600, 160)];
  const pick = (from: DOMRect | null, dir: 'up' | 'down' | 'left' | 'right') => (nearest(from, dir, all) as unknown as { name: string } | null)?.name;

  it('goes to the nearest control in the direction pressed', () => {
    expect(pick(rect(100, 100), 'down')).toBe('load');
    expect(pick(rect(100, 160), 'down')).toBe('quit');
    expect(pick(rect(100, 160), 'up')).toBe('start');
    expect(pick(rect(100, 160), 'right')).toBe('back');
    expect(pick(rect(600, 160), 'left')).toBe('load');
  });

  it('stays put at an edge, and starts at the first control', () => {
    expect(pick(rect(100, 220), 'down')).toBeUndefined();
    expect(pick(null, 'down')).toBe('start');
  });
});

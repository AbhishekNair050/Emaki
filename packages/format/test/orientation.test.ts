import { describe, expect, it } from 'vitest';
import { compile, gameOrientation } from '@emaki/format';

describe('orientation header', () => {
  it('is landscape for a game drawn on a fixed canvas, and any otherwise, unless the header says', () => {
    expect(gameOrientation({})).toBe('any');
    expect(gameOrientation({ aspect: '4:3' })).toBe('any');
    expect(gameOrientation({ canvas: '1920x1080' })).toBe('landscape');
    expect(gameOrientation({ canvas: '800x600', orientation: 'any' })).toBe('any');
    expect(gameOrientation({ orientation: ' portrait ' })).toBe('portrait');
    expect(gameOrientation({ orientation: 'landscape' })).toBe('landscape');
    // An unknown value is warned about and falls back to the default.
    expect(gameOrientation({ canvas: '1920x1080', orientation: 'sideways' })).toBe('landscape');
  });

  it('warns about a value it would ignore', () => {
    const bad = compile('---\norientation: sideways\n---\nlabel start:\n  "Hi."\n');
    expect(bad.diagnostics.map((d) => d.code)).toEqual(['bad-orientation']);
    for (const v of ['landscape', 'portrait', 'any']) {
      expect(compile(`---\norientation: ${v}\n---\nlabel start:\n  "Hi."\n`).diagnostics).toEqual([]);
    }
  });
});

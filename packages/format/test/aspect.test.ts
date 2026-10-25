import { describe, expect, it } from 'vitest';
import { compile, parseAspect } from '@emaki/format';

describe('aspect header', () => {
  it('reads width:height shapes', () => {
    expect(parseAspect('4:3')).toBeCloseTo(4 / 3);
    expect(parseAspect('16/9')).toBeCloseTo(16 / 9);
    expect(parseAspect(' 21 x 9 ')).toBeCloseTo(21 / 9);
    expect(parseAspect('wide')).toBeNull();
    expect(parseAspect('10:1')).toBeNull();
  });

  it('warns about a shape the player would ignore', () => {
    const bad = compile('---\naspect: wide\n---\nlabel start:\n  "Hi."\n');
    expect(bad.diagnostics.map((d) => d.code)).toEqual(['bad-aspect']);
    const good = compile('---\naspect: 4:3\n---\nlabel start:\n  "Hi."\n');
    expect(good.diagnostics).toEqual([]);
    expect(good.story!.meta.aspect).toBe('4:3');
  });
});

import { describe, expect, it } from 'vitest';
import { parsePreview, previewQuery } from '../src/preview.ts';

const declared = { trust: 0, read_letter: false, name: 'Ren' };

describe('preview links', () => {
  it('reads the line and converts variables to their declared types', () => {
    expect(parsePreview('?line=52&trust=2&read_letter=true&name=Kai', declared)).toEqual({
      line: 52, vars: { trust: 2, read_letter: true, name: 'Kai' }, ignored: [],
    });
  });

  it('ignores unknown variables and values of the wrong type', () => {
    expect(parsePreview('?line=7&trust=lots&read_letter=maybe&nope=1', declared)).toEqual({
      line: 7, vars: {}, ignored: ['trust', 'read_letter', 'nope'],
    });
  });

  it('needs a positive whole line number', () => {
    expect(parsePreview('', declared)).toBeNull();
    expect(parsePreview('?trust=2', declared)).toBeNull();
    expect(parsePreview('?line=abc', declared)).toBeNull();
    expect(parsePreview('?line=0', declared)).toBeNull();
    expect(parsePreview('?line=1.5', declared)).toBeNull();
  });

  it('round-trips through previewQuery', () => {
    const q = previewQuery(52, { trust: 2, read_letter: true, name: 'A & B' });
    expect(parsePreview(q, declared)).toEqual({ line: 52, vars: { trust: 2, read_letter: true, name: 'A & B' }, ignored: [] });
  });
});

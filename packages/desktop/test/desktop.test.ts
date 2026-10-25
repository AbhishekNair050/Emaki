import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { productName, pruneLocales, semver } from '../src/export.ts';
import { pngToIco } from '../src/icon.ts';

/** The smallest valid PNG header for a w×h image (enough for the .ico wrapper). */
function fakePng(w: number, h: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

describe('desktop export helpers', () => {
  it('wrap a PNG in an .ico', () => {
    const ico = pngToIco(fakePng(512, 512));
    const d = new DataView(ico.buffer);
    expect([d.getUint16(0, true), d.getUint16(2, true), d.getUint16(4, true)]).toEqual([0, 1, 1]);
    expect([ico[6], ico[7]]).toEqual([0, 0]); // 0 = 256 or more
    expect(d.getUint32(14, true)).toBe(40);
    expect(d.getUint32(18, true)).toBe(22);
    expect([...ico.slice(22, 26)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(pngToIco(fakePng(64, 48)).slice(6, 8)).toEqual(new Uint8Array([64, 48]));
    expect(() => pngToIco(new Uint8Array(40))).toThrow(/PNG/);
  });

  it('make titles safe as file names', () => {
    expect(productName('The Keeper: Part 2/3?')).toBe('The Keeper Part 23');
    expect(productName('   ')).toBe('Emaki Game');
    expect(semver('0.3')).toBe('0.3.0');
  });

  it('keep English and the game\'s languages from Chromium\'s locales', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emaki-locales-'));
    mkdirSync(join(dir, 'locales'));
    for (const f of ['en-US.pak', 'en-GB.pak', 'fr.pak', 'pt-BR.pak', 'pt-PT.pak', 'ja.pak', 'de.pak']) writeFileSync(join(dir, 'locales', f), '');
    pruneLocales(dir, ['fr', 'pt-BR']);
    expect(readdirSync(join(dir, 'locales')).sort()).toEqual(['en-US.pak', 'fr.pak', 'pt-BR.pak', 'pt-PT.pak']);
    rmSync(dir, { recursive: true, force: true });
  });
});

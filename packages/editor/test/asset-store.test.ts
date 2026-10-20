import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetStore, kindOf, safeName } from '../src/server/asset-store.ts';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('AssetStore', () => {
  let dir: string;
  let store: AssetStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'emaki-assets-'));
    mkdirSync(join(dir, 'bg'));
    writeFileSync(join(dir, 'bg', 'kitchen.svg'), '<svg/>');
    writeFileSync(join(dir, 'theme.mp3'), 'mp3');
    writeFileSync(join(dir, 'CREDITS.md'), '# credits');
    writeFileSync(join(dir, '.DS_Store'), '');
    store = new AssetStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists images and audio with / paths, skipping everything else', () => {
    expect(store.list()).toEqual([
      { path: 'bg/kitchen.svg', kind: 'image', size: 6 },
      { path: 'theme.mp3', kind: 'audio', size: 3 },
    ]);
  });

  it('adds files to images/ or audio/', () => {
    expect(store.add('Hall at Night.PNG', bytes('png')).path).toBe('images/Hall_at_Night.png');
    expect(store.add('rain.ogg', bytes('ogg')).path).toBe('audio/rain.ogg');
    expect(readFileSync(join(dir, 'images', 'Hall_at_Night.png'), 'utf8')).toBe('png');
  });

  it('never overwrites: same content is reused, different content gets a new name', () => {
    expect(store.add('a.png', bytes('one')).path).toBe('images/a.png');
    expect(store.add('a.png', bytes('one')).path).toBe('images/a.png');
    expect(store.add('a.png', bytes('two')).path).toBe('images/a-2.png');
    expect(readFileSync(join(dir, 'images', 'a.png'), 'utf8')).toBe('one');
  });

  it('refuses files that are not images or audio, and path tricks', () => {
    expect(() => store.add('notes.txt', bytes('x'))).toThrow(/isn't an image or audio/);
    expect(store.add('../../evil.png', bytes('x')).path).toBe('images/evil.png');
  });

  it('cleans names', () => {
    expect(safeName('C:\\Users\\me\\Café crème.JPG')).toBe('Cafe_creme.jpg');
    expect(safeName('...png')).toBe('file.png');
    expect(kindOf('x.WebP')).toBe('image');
    expect(kindOf('x.flac')).toBe('audio');
    expect(kindOf('x.psd')).toBeNull();
  });
});

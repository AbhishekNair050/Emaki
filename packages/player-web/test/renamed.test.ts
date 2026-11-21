import { afterEach, describe, expect, it } from 'vitest';
import { asset, setRenamedAssets } from '../src/player.ts';
import { pictureSize, setPictureSizes } from '../src/picture-size.ts';

describe('asset URLs in a compressed export', () => {
  afterEach(() => setRenamedAssets({}));

  it('use the new name of a file the export converted, and the path as it is otherwise', () => {
    setRenamedAssets({ 'bg/sea.png': 'bg/sea.webp', 'voice/a1.wav': 'voice/a1.ogg' });
    expect(asset('bg/sea.png')).toBe('./bg/sea.webp');
    expect(asset('voice/a1.wav')).toBe('./voice/a1.ogg');
    expect(asset('bg/sky.png')).toBe('./bg/sky.png');
    expect(asset('toString')).toBe('./toString');
    expect(asset('https://example.com/a.png')).toBe('https://example.com/a.png');
    setRenamedAssets({});
    expect(asset('bg/sea.png')).toBe('./bg/sea.png');
  });
});

describe('pictures a compressed export made smaller', () => {
  afterEach(() => setPictureSizes({}));

  /** Just what pictureSize reads of an <img>. */
  const img = (src: string, w: number, h: number) => ({ getAttribute: () => src, naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement;

  it('are sized as they were before, and other pictures by their pixels', () => {
    setPictureSizes({ 'bg/sea.webp': [3840, 2160] });
    expect(pictureSize(img(asset('bg/sea.webp'), 1920, 1080))).toEqual([3840, 2160]);
    expect(pictureSize(img(asset('bg/sky.png'), 1280, 720))).toEqual([1280, 720]);
    expect(pictureSize(img('./toString', 10, 20))).toEqual([10, 20]);
  });
});

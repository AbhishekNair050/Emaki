import { afterEach, describe, expect, it } from 'vitest';
import { asset, setRenamedAssets } from '../src/player.ts';

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

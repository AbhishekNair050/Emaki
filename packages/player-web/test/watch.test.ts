import { resolve } from 'node:path';
import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import { emakiGame } from '../src/emaki-plugin.ts';
import { emakiEditor } from '../../editor/src/server/plugin.ts';

const game = resolve('/games/my-game');

/** The `ignored` test a dev server's watcher gets from the plugin's config. */
function ignoredBy(config: UserConfig | null | void): (path: string) => boolean {
  const ignored = config?.server?.watch?.ignored;
  if (!Array.isArray(ignored) || typeof ignored[0] !== 'function') throw new Error('no ignore function');
  return ignored[0] as (path: string) => boolean;
}

describe('what the dev servers watch in a game folder', () => {
  // A watched folder stays open on Windows, so an export made while the game is open couldn't replace it.
  const player = ignoredBy((emakiGame(game).config as (c: UserConfig, e: { command: string }) => UserConfig)({}, { command: 'serve' }));
  const editor = ignoredBy((emakiEditor(game).config as () => UserConfig)());

  it.each([['player', player], ['editor', editor]])('the %s skips assets and exports, and watches the story', (_name, ignored) => {
    expect(ignored(resolve(game, 'export'))).toBe(true);
    expect(ignored(resolve(game, 'export/web/audio'))).toBe(true);
    expect(ignored(resolve(game, 'assets/bg/sea.png'))).toBe(true);
    expect(ignored(resolve(game, 'story.vn'))).toBe(false);
    expect(ignored(resolve(game, 'scripts/day1.vn'))).toBe(false);
    expect(ignored(resolve(game, 'exported-notes.vn'))).toBe(false);
  });
});

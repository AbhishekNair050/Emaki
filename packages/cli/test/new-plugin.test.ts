import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compileGame } from '@emaki/format/files';
import { pluginTypes } from '@emaki/player-web/plugin-types';
import { newGame } from '../src/new.ts';
import { newPlugin } from '../src/new-plugin.ts';

const scratch: string[] = [];
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

describe('emaki plugin', () => {
  it('starts a plugin the story can use at once, with the API types beside it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emaki-plugin-'));
    scratch.push(dir);
    const game = join(dir, 'game');
    newGame(game, 'Plugins');
    expect(newPlugin(game, 'notes')).toEqual(['plugins/notes/plugin.json', 'plugins/notes/index.js', 'plugins/emaki-plugin.d.ts']);
    expect(newPlugin(game, 'hp_bar', true)[1]).toBe('plugins/hp_bar/index.ts');
    expect(readFileSync(join(game, 'plugins/notes/index.js'), 'utf8')).toContain("@type {import('../emaki-plugin').PluginSetup}");
    expect(readFileSync(join(game, 'plugins/hp_bar/index.ts'), 'utf8')).toContain('const hpBar: PluginSetup');
    expect(readFileSync(join(game, 'plugins/emaki-plugin.d.ts'), 'utf8')).toBe(pluginTypes());
    // The story can use both right away.
    const story = join(game, 'story.vn');
    writeFileSync(story, readFileSync(story, 'utf8').replace('label start:\n', 'label start:\n  @notes note text="Hi" seconds=1\n  @hp_bar note text="TS"\n'));
    const r = compileGame(game);
    expect(r.diagnostics).toEqual([]);
    expect(Object.keys(r.plugins)).toEqual(['hp_bar', 'notes']);
  });

  it('refuses a bad name, an existing plugin, or a folder that is not a game', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emaki-plugin-'));
    scratch.push(dir);
    expect(() => newPlugin(dir, 'notes')).toThrow(/isn't a game folder/);
    newGame(join(dir, 'g'), 'G');
    expect(() => newPlugin(join(dir, 'g'), 'Notes')).toThrow(/lowercase/);
    newPlugin(join(dir, 'g'), 'notes');
    expect(() => newPlugin(join(dir, 'g'), 'notes')).toThrow(/already exists/);
  });
});

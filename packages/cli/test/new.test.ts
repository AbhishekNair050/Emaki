import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, print } from '@emaki/format';
import { compileGame } from '@emaki/format/files';
import { newGame, titleFromFolder } from '../src/new.ts';

describe('emaki new', () => {
  it('starts a game that compiles cleanly, is formatted and has its background', () => {
    const root = mkdtempSync(join(tmpdir(), 'emaki-new-'));
    const dir = join(root, 'my-first_game');
    expect(newGame(dir)).toEqual(['story.vn', 'theme.css', 'assets/bg/sky.svg', 'LICENSE-starter.txt']);
    const r = compileGame(dir);
    expect(r.diagnostics).toEqual([]);
    expect(r.story!.meta.title).toBe('My First Game');
    const src = readFileSync(join(dir, 'story.vn'), 'utf8');
    expect(print(parse(src).program)).toBe(src);
    expect(existsSync(join(dir, 'assets', 'sprites'))).toBe(true);
    // Never over an existing game.
    expect(() => newGame(dir)).toThrow(/already has files/);
    expect(newGame(join(root, 'other'), 'The Pier')).toHaveLength(4);
    expect(readFileSync(join(root, 'other', 'story.vn'), 'utf8')).toContain('title: The Pier');
    rmSync(root, { recursive: true, force: true });
  });

  it('names a game after its folder', () => {
    expect(titleFromFolder('my-first_game')).toBe('My First Game');
    expect(titleFromFolder('---')).toBe('My Game');
  });
});

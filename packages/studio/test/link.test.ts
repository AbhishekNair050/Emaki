import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { linkPackages } from '../src/link.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function installed(): string {
  const root = mkdtempSync(join(tmpdir(), 'emaki-studio-'));
  dirs.push(root);
  for (const [dir, name] of [['format', '@emaki/format'], ['cli', '@emaki/cli'], ['vscode', 'emaki-vscode']]) {
    mkdirSync(join(root, 'packages', dir, 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', dir, 'package.json'), JSON.stringify({ name }));
    writeFileSync(join(root, 'packages', dir, 'src', 'index.ts'), `export const name = '${name}';`);
  }
  mkdirSync(join(root, 'packages', 'notes'));
  mkdirSync(join(root, 'node_modules', 'vite'), { recursive: true });
  return root;
}

describe('linking the engine packages in an installed Studio', () => {
  it('links each @emaki package by name, to the folder it really is in', () => {
    const root = installed();
    expect(linkPackages(root).map((l) => l.slice(root.length + 1).replaceAll('\\', '/')).sort()).toEqual(['node_modules/@emaki/cli', 'node_modules/@emaki/format']);
    expect(realpathSync(join(root, 'node_modules/@emaki/format'))).toBe(realpathSync(join(root, 'packages/format')));
    expect(readFileSync(join(root, 'node_modules/@emaki/cli/src/index.ts'), 'utf8')).toContain('@emaki/cli');
    expect(existsSync(join(root, 'node_modules/emaki-vscode'))).toBe(false);
  });

  it('keeps links already in place, and points links elsewhere back at this install', () => {
    const root = installed();
    linkPackages(root);
    expect(linkPackages(root)).toEqual([]);
    const elsewhere = mkdtempSync(join(tmpdir(), 'emaki-old-'));
    dirs.push(elsewhere);
    writeFileSync(join(elsewhere, 'keep.txt'), 'an older install');
    rmSync(join(root, 'node_modules/@emaki/cli'), { recursive: false, force: true });
    symlinkSync(elsewhere, join(root, 'node_modules/@emaki/cli'), 'junction');
    expect(linkPackages(root)).toHaveLength(1);
    expect(realpathSync(join(root, 'node_modules/@emaki/cli'))).toBe(realpathSync(join(root, 'packages/cli')));
    expect(readFileSync(join(elsewhere, 'keep.txt'), 'utf8')).toBe('an older install');
  });
});

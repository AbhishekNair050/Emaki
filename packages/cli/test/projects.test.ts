import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileGame } from '@emaki/format/files';
import { compile, parse, print } from '@emaki/format';
import { Projects, projectPath } from '../src/projects.ts';

const roots: string[] = [];
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'emaki-launcher-'));
  roots.push(root);
  const file = join(root, 'preferences', 'launcher.json');
  return { root, file, projects: new Projects(file) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('launcher project library', () => {
  it('creates a playable game outside the engine and persists a deduplicated recent list', () => {
    const { root, file, projects } = workspace();
    const p = projects.create(root, 'My Game', 'The Pier');
    expect(compileGame(p.path).story?.meta.title).toBe('The Pier');
    expect(projectPath(join(p.path, 'story.vn'))).toBe(p.path);
    projects.add(join(p.path, 'story.vn'));
    projects.add(p.path);
    expect(new Projects(file).list()).toEqual([expect.objectContaining({ path: p.path, title: 'The Pier', available: true })]);
    projects.remove(p.path);
    expect(new Projects(file).list()).toEqual([]);
    expect(existsSync(join(p.path, 'story.vn'))).toBe(true);
  });

  it('does not write into an existing folder or permit paths and header injection as names', () => {
    const { root, projects } = workspace();
    mkdirSync(join(root, 'existing'));
    for (const folder of ['existing', '../escape', 'nested/game', 'CON', 'trailing ']) {
      expect(() => projects.create(root, folder, 'Title')).toThrow();
    }
    expect(() => projects.create(root, 'valid', 'Title\nstart: injected')).toThrow();
    expect(existsSync(join(root, 'existing', 'story.vn'))).toBe(false);
    expect(existsSync(join(root, 'valid'))).toBe(false);
  });

  it('keeps moved projects visible and refreshes titles from disk', () => {
    const { root, projects } = workspace();
    const p = projects.create(root, 'old', 'Before');
    writeFileSync(join(p.path, 'story.vn'), '---\ntitle: After\n---\n');
    expect(projects.list()[0]?.title).toBe('After');
    renameSync(p.path, join(root, 'moved'));
    expect(projects.list()[0]).toMatchObject({ path: p.path, available: false });
    expect(() => projects.add(p.path)).toThrow(/story.vn/);
  });

  it('preserves a damaged preferences file and explains how to recover', () => {
    const { root } = workspace();
    const file = join(root, 'broken.json');
    writeFileSync(file, '{broken');
    expect(() => new Projects(file)).toThrow(/Move it aside/);
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });

  it('preserves titles containing script comment markers through creation, listing and formatting', () => {
    const { root, projects } = workspace();
    const title = 'A story # with a subtitle';
    const p = projects.create(root, 'title-check', title);
    const source = readFileSync(join(p.path, 'story.vn'), 'utf8');
    expect(p.title).toBe(title);
    expect(compile(print(parse(source).program)).story?.meta.title).toBe(title);
  });
});

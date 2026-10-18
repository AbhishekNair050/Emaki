import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoryFile } from '../src/server/story-file.ts';

describe('StoryFile', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'emaki-editor-'));
    path = join(dir, 'story.vn');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads text with \\n line endings and a version', () => {
    writeFileSync(path, 'label a:\r\n  "Hi."\r\n');
    const r = new StoryFile(path).read();
    expect(r.text).toBe('label a:\n  "Hi."\n');
    expect(r.version).toMatch(/\S/);
  });

  it('saves when the file is unchanged since it was read', () => {
    writeFileSync(path, 'label a:\n  "Hi."\n');
    const f = new StoryFile(path);
    const { version } = f.read();
    const r = f.save('label a:\n  "Hello."\n', version);
    expect(r.ok).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('label a:\n  "Hello."\n');
    expect(r.ok && r.version).toBe(f.version());
    expect(r.ok && r.version).not.toBe(version);
  });

  it('keeps Windows line endings', () => {
    writeFileSync(path, 'label a:\r\n  "Hi."\r\n');
    const f = new StoryFile(path);
    f.save('label a:\n  "Bye."\n', f.read().version);
    expect(readFileSync(path, 'utf8')).toBe('label a:\r\n  "Bye."\r\n');
  });

  it('refuses to overwrite changes made elsewhere, and returns them', () => {
    writeFileSync(path, 'label a:\n  "Hi."\n');
    const f = new StoryFile(path);
    const { version } = f.read();
    writeFileSync(path, 'label a:\n  "Edited in another editor."\n');
    const r = f.save('label a:\n  "Mine."\n', version);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.conflict.text).toContain('another editor');
    expect(readFileSync(path, 'utf8')).toContain('another editor');
  });

  it('saving identical text is a no-op that keeps the version', () => {
    writeFileSync(path, 'label a:\n  "Hi."\n');
    const f = new StoryFile(path);
    const { text, version } = f.read();
    expect(f.save(text, version)).toEqual({ ok: true, version });
  });
});

import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assetFile, countWords, projectInfo, storySignature } from '../src/project-info.ts';

const demo = resolve(import.meta.dirname, '../../../games/gullwing');
const scratch: string[] = [];
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

describe('project info', () => {
  it('counts words as a reader would, markup and variables aside', () => {
    expect(countWords('The lamp *turns*,[w] {name}. Again!')).toBe(4);
    expect(countWords('日本語です')).toBe(5);
    expect(countWords('Hello 世界')).toBe(3);
  });

  it('sums up the demo: its scenes, endings, problems and title picture', () => {
    const info = projectInfo(demo);
    expect(info).toMatchObject({ files: 1, scenes: 8, endings: 3, choices: 7, errors: 0, warnings: 0, firstProblem: null, picture: 'bg/cliff_road_dusk.svg' });
    expect(info.words).toBeGreaterThan(500);
  });

  it('reports the first error, and finds a picture from the title screen or the first scene', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emaki-info-'));
    scratch.push(dir);
    cpSync(join(demo, 'assets'), join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'story.vn'), 'image hall = "bg/kitchen_night.svg"\nlabel start:\n  scene hall\n  jump nowhere\n');
    const broken = projectInfo(dir);
    expect(broken.errors).toBe(1);
    expect(broken.firstProblem).toMatch(/^story\.vn:4 /);
    expect(broken.picture).toBe('bg/kitchen_night.svg');
    writeFileSync(join(dir, 'story.vn'), 'label start:\n  "Hi."\n\nscreen title:\n  image "bg/shore_dawn.svg"\n  image "bg/cliff_road_dusk.svg" at 10px 10px\n');
    expect(projectInfo(dir).picture).toBe('bg/shore_dawn.svg');
  });

  it('changes its signature when a story file changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emaki-info-'));
    scratch.push(dir);
    writeFileSync(join(dir, 'story.vn'), 'label start:\n  "Hi."\n');
    const before = storySignature(dir);
    writeFileSync(join(dir, 'chapter.vn'), 'label two:\n  "Two."\n');
    expect(storySignature(dir)).not.toBe(before);
  });

  it('only ever serves pictures from inside the assets folder', () => {
    expect(assetFile(demo, 'bg/kitchen_night.svg')).toBeTruthy();
    expect(assetFile(demo, '../story.vn')).toBeNull();
    expect(assetFile(demo, '../../../package.json')).toBeNull();
    expect(assetFile(demo, 'audio/CREDITS.md')).toBeNull();
  });
});

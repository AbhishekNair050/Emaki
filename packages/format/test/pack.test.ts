import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile, compileFiles, loadStory, packStory, PACKED_VERSION } from '../src/index.ts';

const demo = compile(readFileSync(fileURLToPath(new URL('../../../games/gullwing/story.vn', import.meta.url)), 'utf8')).story!;

describe('packed stories', () => {
  it('load back exactly as compiled', () => {
    const packed = JSON.parse(JSON.stringify(packStory(demo)));
    expect(packed.version).toBe(PACKED_VERSION);
    expect(loadStory(packed)).toEqual(demo);
  });

  it('are smaller: file and label are written only when they change', () => {
    const packed = packStory(demo);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(demo).length * 0.85);
    const srcs = packed.code.map((i) => i.src as { file?: string; label?: string });
    expect(srcs.filter((s) => s.label !== undefined).length).toBeLessThan(srcs.length / 3);
    const say = packed.code.find((i) => i.op === 'say' && i.who === undefined);
    expect(say).toBeDefined();
  });

  it('keep which file each instruction came from, including going back to story.vn', () => {
    const main = '---\ntitle: T\n---\nlabel start:\n  "One."\n  call other\n  "Three."\n';
    const r = compileFiles(main, [{ path: 'parts/other.vn', source: 'label other:\n  "Two."\n' }]);
    const story = r.story!;
    expect(story.code.some((i) => i.src.file === 'parts/other.vn')).toBe(true);
    expect(loadStory(JSON.parse(JSON.stringify(packStory(story))))).toEqual(story);
  });

  it('leave an unpacked story as it is', () => {
    expect(loadStory(demo)).toBe(demo);
  });
});

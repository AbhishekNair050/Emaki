import { describe, expect, it } from 'vitest';
import { Analysis } from '../src/index.ts';

const MAIN = `---
title: Two Files
---
define ann "Ann"
var met = false

label start:
  ann: Hello.
  jump chapter_two
`;
const PART = `label chapter_two:
  set met = true
  ann: We meet again.
  jump nowhere
`;
const files = [{ path: 'story.vn', source: MAIN }, { path: 'chapters/two.vn', source: PART }];

describe('analysis across files', () => {
  it('knows names from the other files and reports only its own problems', () => {
    const main = new Analysis(MAIN, { file: 'story.vn', files });
    expect(main.problems()).toEqual([]); // chapter_two is defined in the other file
    const part = new Analysis(PART, { file: 'chapters/two.vn', files });
    expect(part.problems().map((p) => [p.range.line, p.code])).toEqual([[3, 'unknown-label']]);
    expect(new Analysis(PART).problems().length).toBeGreaterThan(1); // alone, ann and met are unknown
  });

  it('jumps to definitions in other files', () => {
    const main = new Analysis(MAIN, { file: 'story.vn', files });
    expect(main.definitionAt(8, 8)).toMatchObject({ name: 'chapter_two', kind: 'label', file: 'chapters/two.vn', line: 0 });
    const part = new Analysis(PART, { file: 'chapters/two.vn', files });
    const ann = part.definitionAt(2, 3)!;
    expect(ann).toMatchObject({ name: 'ann', kind: 'character', line: 3 });
    expect(ann.file).toBeUndefined(); // story.vn
    expect(part.hoverAt(0, 8)).toBeUndefined(); // its own definition line
    expect(main.hoverAt(8, 8)).toContain('chapters/two.vn line 1');
    expect(part.completionsAt(1, 6).map((c) => c.label)).toContain('met');
    expect(part.ownSymbols().map((s) => s.name)).toEqual(['chapter_two']);
  });
});

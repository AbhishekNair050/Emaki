import { describe, expect, it } from 'vitest';
import { createCompileCache } from '@emaki/format';
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

  it('with a cache, edits are analysed the same as from scratch', () => {
    const cache = createCompileCache();
    expect(new Analysis(PART, { file: 'chapters/two.vn', files, cache }).problems().map((p) => p.code)).toEqual(['unknown-label']);
    const fixed = PART.replace('jump nowhere', 'jump start');
    const a = new Analysis(fixed, { file: 'chapters/two.vn', files, cache });
    expect(a.symbols().map((s) => s.name)).toContain('chapter_two');
    expect(a.problems()).toEqual([]);
    // story.vn sees the other file's edited text too when it's passed in.
    const edited = [{ path: 'story.vn', source: MAIN.replace('var met = false\n', '') }, { path: 'chapters/two.vn', source: fixed }];
    expect(new Analysis(fixed, { file: 'chapters/two.vn', files: edited, cache }).problems().map((p) => p.code)).toEqual(['unknown-variable']);
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

describe('scene edits across files', async () => {
  const { addScene, connectScenes, deleteScene, renameScene } = await import('../src/edits.ts');
  const ctxForPart = { others: ['start'], start: 'start' };

  it('renames the scene in its file and the jumps to it in the others', () => {
    const inPart = renameScene(PART, 'chapter_two', 'reunion', { others: ['start'] });
    expect(inPart.ok && inPart.text).toContain('label reunion:');
    const inMain = renameScene(MAIN, 'chapter_two', 'reunion', { others: ['chapter_two'] });
    expect(inMain.ok && inMain.text).toContain('jump reunion');
    if (inMain.ok) expect(inMain.text.split('\n')[inMain.line - 1]).toBe('  jump reunion');
    expect(renameScene(MAIN, 'nope', 'x', { others: ['chapter_two'] })).toMatchObject({ ok: false });
    expect(renameScene(PART, 'chapter_two', 'start', ctxForPart)).toMatchObject({ ok: false, error: "There is already a scene called 'start'." });
  });

  it('adds, connects and deletes knowing the other files', () => {
    expect(addScene(PART, 'start', undefined, ctxForPart)).toMatchObject({ ok: false });
    const c = connectScenes(PART, 'chapter_two', 'start', ctxForPart);
    expect(c.ok && c.text).toContain('start');
    // The only scene in a part file can go, as long as it isn't where the story starts.
    expect(deleteScene(PART, 'chapter_two', ctxForPart).ok).toBe(true);
    expect(deleteScene(PART, 'chapter_two', { others: ['start'], start: 'chapter_two' })).toMatchObject({ ok: false });
  });
});

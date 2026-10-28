import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compileFiles, updateCatalog } from '@emaki/format';
import { compileGame, storyParts, where } from '../src/files.ts';

const MAIN = `---
title: Two Files
---
define ann "Ann"
var met = false

label start:
  ann: Hello.
  jump chapter_two
`;
const PART = `image room = "bg/room.png"

label chapter_two:
  scene room
  set met = true
  ann: We meet again.
  jump the_end

label the_end:
  "Fin."
`;

describe('multi-file stories', () => {
  it('shares labels, characters, images and variables across files', () => {
    const r = compileFiles(MAIN, [{ path: 'chapters/two.vn', source: PART }]);
    expect(r.diagnostics).toEqual([]);
    const say = r.story!.code.find((i) => i.op === 'say' && i.text === 'We meet again.')!;
    expect(say.src).toEqual({ line: 6, file: 'chapters/two.vn', label: 'chapter_two' });
    const first = r.story!.code.find((i) => i.op === 'say')!;
    expect(first.src).toEqual({ line: 8, label: 'start' });
    expect(r.strings.find((s) => s.text === 'We meet again.')).toMatchObject({ line: 6, file: 'chapters/two.vn' });
    const cat = updateCatalog(r.strings, null, 'fr');
    expect(cat.entries.find((e) => e.source === 'We meet again.')!.ref).toBe('chapters/two.vn:6');
  });

  it('reports problems in the file they are in', () => {
    const r = compileFiles(MAIN, [{ path: 'b.vn', source: '---\ntitle: x\n---\nlabel chapter_two:\n  jump nowhere\n  ann: "Unclosed\n' }]);
    expect(r.diagnostics.map((d) => `${where(d)} ${d.code}`)).toEqual([
      'b.vn:1 header-in-part',
      'b.vn:5 unknown-label',
      'b.vn:6 bad-string',
    ].sort((a, b) => Number(a.split(':')[1]!.split(' ')[0]) - Number(b.split(':')[1]!.split(' ')[0])));
  });

  it('finds duplicates across files', () => {
    const r = compileFiles(MAIN, [{ path: 'b.vn', source: 'label start:\n  "Again."\n' }]);
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ file: 'b.vn', line: 1, code: 'duplicate' }));
  });
});

describe('game folders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'emaki-files-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads story.vn plus every other .vn file, skipping assets and builds', () => {
    writeFileSync(join(dir, 'story.vn'), MAIN);
    mkdirSync(join(dir, 'chapters'));
    writeFileSync(join(dir, 'chapters', 'two.vn'), PART);
    for (const skip of ['assets', 'dist', 'lang']) {
      mkdirSync(join(dir, skip));
      writeFileSync(join(dir, skip, 'stray.vn'), 'label oops:\n  "x"\n');
    }
    expect(storyParts(dir)).toEqual(['chapters/two.vn']);
    const r = compileGame(dir);
    expect(r.diagnostics).toEqual([]);
    expect(Object.keys(r.story!.labels).sort()).toEqual(['chapter_two', 'start', 'the_end']);
  });
});


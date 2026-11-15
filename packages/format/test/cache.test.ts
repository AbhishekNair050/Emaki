import { describe, expect, it } from 'vitest';
import { compileFiles, createCompileCache, type StoryFile } from '../src/index.ts';

const MAIN = `---
title: Cache
---
define mira "Mira"
image mira smile = "mira.png"
image kitchen = "kitchen.png"
var trust = 0

label start:
  scene kitchen
  mira smile: Hello.
  call chapter
  menu:
    "Stay.":
      set trust += 1
    "Go." if trust > 0:
      jump the_end
  jump the_end
`;
const CHAPTER = `label chapter:
  "A chapter."
  if trust > 1:
    "Trusted."
  else:
    "Not yet."

label the_end:
  "The end."
  end
`;

const fresh = (main: string, parts: StoryFile[]) => compileFiles(main, parts);
/** A compile result without the AST, which a cache shares between compiles. */
const out = (r: ReturnType<typeof compileFiles>) => ({ story: r.story, diagnostics: r.diagnostics, strings: r.strings });

describe('compile cache', () => {
  it('gives the same story, messages and strings as compiling from scratch', () => {
    const cache = createCompileCache();
    const parts = [{ path: 'chapter.vn', source: CHAPTER }];
    expect(out(compileFiles(MAIN, parts, { cache }))).toEqual(out(fresh(MAIN, parts)));
    // Again with everything cached.
    expect(out(compileFiles(MAIN, parts, { cache }))).toEqual(out(fresh(MAIN, parts)));
  });

  it('picks up an edit to one file, and keeps the others', () => {
    const cache = createCompileCache();
    compileFiles(MAIN, [{ path: 'chapter.vn', source: CHAPTER }], { cache });
    const chapterLabels = cache.files.get('chapter.vn')!.result.program.labels;
    const edited = [{ path: 'chapter.vn', source: CHAPTER.replace('"A chapter."', '"A longer chapter."\n  "With two lines."') }];
    const r = compileFiles(MAIN, edited, { cache });
    expect(out(r)).toEqual(out(fresh(MAIN, edited)));
    expect(cache.files.get('chapter.vn')!.result.program.labels).not.toBe(chapterLabels);
    // story.vn's label moved nothing but was reused, and its jumps still land on the right labels.
    expect(r.story!.code[r.story!.labels.the_end!]!.src.label).toBe('the_end');
  });

  it('checks unchanged labels again when the declarations change', () => {
    const cache = createCompileCache();
    const parts = [{ path: 'chapter.vn', source: CHAPTER }];
    compileFiles(MAIN, parts, { cache });
    const noTrust = MAIN.replace('var trust = 0\n', '');
    const r = compileFiles(noTrust, parts, { cache });
    expect(out(r)).toEqual(out(fresh(noTrust, parts)));
    expect(r.diagnostics.some((d) => d.file === 'chapter.vn' && d.code === 'unknown-variable')).toBe(true);
  });

  it('changes the story hash when any label changes, and only then', () => {
    const cache = createCompileCache();
    const parts = [{ path: 'chapter.vn', source: CHAPTER }];
    const a = compileFiles(MAIN, parts, { cache }).story!.hash;
    expect(compileFiles(MAIN, parts, { cache }).story!.hash).toBe(a);
    expect(compileFiles(MAIN, [{ path: 'chapter.vn', source: CHAPTER.replace('The end.', 'The End.') }], { cache }).story!.hash).not.toBe(a);
  });
});

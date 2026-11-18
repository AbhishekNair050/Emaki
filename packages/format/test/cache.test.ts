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

  it('reuses labels that only moved, exactly as compiling them again (lines, messages, strings, hash)', () => {
    const cache = createCompileCache();
    // A label with a warning, translatable lines, a menu and jumps, below the line that moves.
    const chapter = `${CHAPTER}
label later:
  show nobody
  mira smile: After.
  menu:
    "Back.":
      jump chapter
    "On.":
      jump the_end
`;
    const parts = [{ path: 'chapter.vn', source: chapter }];
    compileFiles(MAIN, parts, { cache });
    const before = cache.files.get('chapter.vn')!.result.program.labels.find((l) => l.name === 'later')!;
    const laterCode = cache.labels.get(before)!;
    for (const edit of [
      chapter.replace('"A chapter."', '"A chapter."\n  "Two."\n  "Three."'), // lines added above
      chapter.replace('  if trust > 1:\n    "Trusted."\n  else:\n    "Not yet."\n', ''), // lines removed above
      chapter.replace('label chapter:', '# a comment\nlabel chapter:'), // a line before every label
    ]) {
      const edited = [{ path: 'chapter.vn', source: edit }];
      const r = compileFiles(MAIN, edited, { cache });
      expect(out(r)).toEqual(out(fresh(MAIN, edited)));
      const now = cache.files.get('chapter.vn')!.result.program.labels.find((l) => l.name === 'later')!;
      // Not compiled again: its code was moved.
      expect(cache.labels.get(now)!.code.length).toBe(laterCode.code.length);
      expect(r.diagnostics.find((d) => d.code === 'unknown-image')?.line).toBe(now.loc.line + 1);
    }
  });

  it('keeps only the labels of the last compile', () => {
    const cache = createCompileCache();
    const parts = [{ path: 'chapter.vn', source: CHAPTER }];
    for (let i = 0; i < 5; i++) compileFiles(MAIN.replace('Hello.', `Hello ${i}.`), parts, { cache });
    expect(cache.byText.size).toBe(3);
  });
});

describe('compile cache on random edits', () => {
  it('always matches compiling from scratch', async () => {
    const { readFileSync } = await import('node:fs');
    const demo = readFileSync(new URL('../../../games/gullwing/story.vn', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const cache = createCompileCache();
    let lines = demo.split('\n');
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 30; i++) {
      const at = rand(lines.length);
      const kind = rand(3);
      if (kind === 0) lines.splice(at, 0, rand(2) ? '' : '# a note');
      else if (kind === 1 && !/^(label|---)/.test(lines[at] ?? '')) lines.splice(at, 1);
      else lines.splice(at, 0, lines[at] ?? '');
      const src = lines.join('\n');
      expect(out(compileFiles(src, [], { cache })), `edit ${i}`).toEqual(out(fresh(src, [])));
    }
  });
});

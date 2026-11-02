import { describe, expect, it } from 'vitest';
import { compile } from '@emaki/format';
import { Runner, type SayBlock } from '../src/index.ts';

const SRC = `define mira "Mira"
define ren "Ren"
image side mira = "side/mira.png"
image side mira smile = "side/mira_smile.png"
image side mira smile coat = "side/mira_smile_coat.png"
image mira coat = "mira_coat.png"

label start:
  mira: Default portrait.
  mira smile: Smiling, off screen.
  mira: Still smiling.
  ren: Ren has no portrait.
  show mira coat
  mira smile: Hm.
  "Narration."
`;

const side = (b: unknown) => (b as SayBlock).side ?? null;

describe('side images', () => {
  it('follow the speaker\'s latest attributes, on screen or off', () => {
    const r = compile(SRC);
    expect(r.diagnostics).toEqual([]); // `mira smile:` is fine with only a side image for it
    const run = new Runner(r.story!);
    expect(side(run.start().block)).toBe('side/mira.png');
    expect(side(run.advance().block)).toBe('side/mira_smile.png');
    expect(side(run.advance().block)).toBe('side/mira_smile.png');
    expect(side(run.advance().block)).toBeNull();
    // `show mira coat` replaces her attributes (plain images swap all of them).
    const shown = run.advance();
    expect(side(shown.block)).toBe('side/mira_smile.png');
    expect(side(run.advance().block)).toBeNull();
    expect(run.back()).not.toBeNull();
    expect(side(run.block)).toBe('side/mira_smile.png');
  });

  it('pick the most specific portrait, and survive starting from a line', () => {
    const src = SRC.replace('show mira coat\n  mira smile: Hm.', 'mira smile coat: Both.');
    const run = new Runner(compile(src).story!);
    run.startAtLine(13);
    expect(side(run.block)).toBe('side/mira_smile_coat.png');
    const r2 = new Runner(compile(SRC).story!);
    r2.startAtLine(11);
    expect(side(r2.block)).toBe('side/mira_smile.png');
  });

  it('keep no extra state in stories without side images', () => {
    const run = new Runner(compile('define a "A"\nimage a happy = "a.png"\nlabel start:\n  show a happy\n  a: Hi.\n').story!);
    run.start();
    expect(run.save().state.faces).toBeUndefined();
  });
});

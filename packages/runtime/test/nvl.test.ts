import { describe, expect, it } from 'vitest';
import { compile, parse, print } from '@emaki/format';
import { Runner } from '../src/index.ts';

const SRC = `define ann "Ann"
image room = "room.png"

label start:
  "In the text box."
  nvl on
  "First paragraph."
  ann: Second, spoken.
  nvl clear
  "A new page."
  scene room
  "After the scene change."
  nvl off
  "Back in the box."
`;

function texts(page: { text: string }[] | null) {
  return page?.map((b) => b.text) ?? null;
}

describe('NVL mode', () => {
  it('parses and prints back', () => {
    const p = parse(SRC);
    expect(p.diagnostics).toEqual([]);
    expect(print(p.program)).toContain('  nvl on\n');
    expect(compile('label start:\n  nvl sideways\n  "x"\n').diagnostics.map((d) => d.code)).toEqual(['bad-nvl']);
  });

  it('collects lines on a page until cleared, a new scene, or nvl off', () => {
    const run = new Runner(compile(SRC).story!);
    run.start();
    expect(run.nvlPage).toBeNull();
    run.advance();
    expect(texts(run.nvlPage)).toEqual(['First paragraph.']);
    run.advance();
    expect(texts(run.nvlPage)).toEqual(['First paragraph.', 'Second, spoken.']);
    expect(run.nvlPage![1]!.who?.name).toBe('Ann');
    run.advance();
    expect(texts(run.nvlPage)).toEqual(['A new page.']);
    run.advance();
    expect(texts(run.nvlPage)).toEqual(['After the scene change.']);
    run.advance();
    expect(run.nvlPage).toBeNull();
  });

  it('restores the page on rollback and load', () => {
    const run = new Runner(compile(SRC).story!);
    run.start();
    run.advance();
    run.advance();
    const save = run.save();
    run.advance();
    run.back();
    expect(texts(run.nvlPage)).toEqual(['First paragraph.', 'Second, spoken.']);
    const other = new Runner(compile(SRC).story!);
    other.load(save);
    expect(texts(other.nvlPage)).toEqual(['First paragraph.', 'Second, spoken.']);
  });

  it('can start in NVL mode from the header, and from a line', () => {
    const run = new Runner(compile('---\nnvl: on\n---\nlabel start:\n  "One."\n  "Two."\n').story!);
    run.start();
    expect(texts(run.nvlPage)).toEqual(['One.']);
    const r2 = new Runner(compile(SRC).story!);
    r2.startAtLine(8);
    expect(texts(r2.nvlPage)).toEqual(['Second, spoken.']);
  });
});

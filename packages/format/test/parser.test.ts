import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile, parse, print } from '../src/index.ts';

const demo = readFileSync(fileURLToPath(new URL('../../../games/gullwing/story.vn', import.meta.url)), 'utf8');

const HEADER = `define mira "Mira"
image mira neutral = "m.svg"
image mira smile = "s.svg"
image room = "room.svg"
var trust = 0
`;

const codes = (src: string) => compile(src).diagnostics.map((d) => `${d.line}:${d.code}`);

/** Remove source locations so ASTs can be compared structurally. */
function stripLoc<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, val) => (k === 'loc' ? undefined : val)));
}

describe('parser', () => {
  it('parses the demo story without problems', () => {
    const r = compile(demo);
    expect(r.diagnostics).toEqual([]);
    expect(r.story).not.toBeNull();
  });

  it('reads frontmatter, dialogue with attributes, and narration', () => {
    const { program, diagnostics } = parse(`---
title: Test
---
${HEADER}
label start:
  "Narration."
  mira smile: Hello: with a colon.
  mira: "Quoted, with \\"escapes\\"."
`);
    expect(diagnostics).toEqual([]);
    expect(program.meta).toEqual([['title', 'Test']]);
    const body = program.labels[0].body;
    expect(body[0]).toMatchObject({ type: 'say', who: null, text: 'Narration.' });
    expect(body[1]).toMatchObject({ type: 'say', who: 'mira', attrs: ['smile'], text: 'Hello: with a colon.' });
    expect(body[2]).toMatchObject({ type: 'say', who: 'mira', text: 'Quoted, with "escapes".' });
  });

  it('parses show/scene/hide options', () => {
    const { program } = parse(`${HEADER}
label start:
  scene room with fade
  show mira smile at left with dissolve
  hide mira with dissolve
`);
    expect(stripLoc(program.labels[0].body)).toEqual([
      { type: 'scene', image: 'room', transition: 'fade' },
      { type: 'show', tag: 'mira', attrs: ['smile'], at: 'left', transition: 'dissolve' },
      { type: 'hide', tag: 'mira', transition: 'dissolve' },
    ]);
  });

  it('reports every problem with a line number, without stopping', () => {
    const src = `${HEADER}
label start:
  bob: Who am I?
  jump nowhere
  set missing = 1
  show ghost
  menu:
    "Go" if trust >:
      "x"
  if trust > 0:
    "ok"
  elif:
    "bad"
  "Value is {nope}."
`;
    expect(codes(src)).toEqual([
      '13:bad-expression',
      '17:bad-if',
      '8:unknown-character',
      '9:unknown-label',
      '10:unknown-variable',
      '11:unknown-image',
      '19:unknown-variable',
    ].sort((a, b) => parseInt(a) - parseInt(b)));
  });

  it('suggests close matches for typos', () => {
    const msgs = compile(`${HEADER}\nlabel start:\n  set trsut += 1\n  jump strat\n  mria: Hi\n`).diagnostics.map((d) => d.message);
    expect(msgs).toEqual([
      "Unknown name 'trsut'. Did you mean 'trust'?",
      "Unknown name 'strat'. Did you mean 'start'?",
      "Unknown name 'mria'. Did you mean 'mira'?",
    ]);
  });

  it('rejects story lines outside a label and bad indentation', () => {
    expect(codes(`${HEADER}\n"stray"\nlabel start:\n  "a"\n    "b"\n`)).toEqual(['7:bad-toplevel', '10:unexpected-indent']);
  });

  it('warns about unreachable labels', () => {
    const r = compile(`${HEADER}\nlabel start:\n  "a"\nlabel orphan:\n  "b"\n`);
    expect(r.story).not.toBeNull();
    expect(r.diagnostics.map((d) => d.code)).toEqual(['unreachable-label']);
  });

  it('gives stable ids to dialogue (unchanged lines keep their id)', () => {
    const a = compile(`${HEADER}\nlabel start:\n  mira: One.\n  mira: Two.\n`).story!;
    const b = compile(`${HEADER}\nlabel start:\n  mira: One.\n  "Inserted line."\n  mira: Two.\n`).story!;
    const ids = (s: typeof a) => s.code.flatMap((i) => (i.op === 'say' ? [`${i.text}=${i.id}`] : []));
    expect(ids(b)).toEqual(expect.arrayContaining(ids(a)));
  });
});

describe('printer round-trip', () => {
  it('parse(print(ast)) == ast for the demo story', () => {
    const first = parse(demo).program;
    const printed = print(first);
    const second = parse(printed);
    expect(second.diagnostics).toEqual([]);
    expect(stripLoc(second.program)).toEqual(stripLoc(first));
  });

  it('printing is idempotent', () => {
    const once = print(parse(demo).program);
    expect(print(parse(once).program)).toBe(once);
  });
});

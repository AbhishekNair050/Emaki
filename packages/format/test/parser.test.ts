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

  it('the demo story is already in canonical form', () => {
    expect(print(parse(demo).program)).toBe(demo.replace(/\r\n?/g, '\n'));
  });
});

describe('comments and blank lines', () => {
  // Canonical text with comments in every position the format allows.
  const canonical = `---
title: Comments
---

# Cast
define a "Alice"
define b "Bob"

image room = "room.png"

# Variables
var n = 0
# Mood starts neutral
var mood = "neutral"

# The opening scene.
# Two lines of notes.
label start:
  # Set the stage
  scene room
  "First line."

  # A new beat after a blank line
  a: Hello.
  menu:
    # The safe option
    "Stay":
      set n += 1

    # The bold option
    "Go" if n > 0:
      # TODO: write this branch
      b: Off we go.
  if n > 1:
    "Lots."

  # Only when n is exactly 1
  elif n == 1:
    "One."
  # Everything else
  else:
    "None."

label second:
  "Done."

# Notes at the end of the file.
`;

  it('keeps every comment and blank line, byte for byte', () => {
    const { program, diagnostics } = parse(canonical);
    expect(diagnostics).toEqual([]);
    expect(print(program)).toBe(canonical);
  });

  it('attaches comments to the line that follows them', () => {
    const { program } = parse(canonical);
    expect(program.labels[0].leading).toEqual(['# The opening scene.', '# Two lines of notes.']);
    const body = program.labels[0].body;
    expect(body[0].leading).toEqual(['# Set the stage']);
    expect(body[2].leading).toEqual(['', '# A new beat after a blank line']);
    const menu = body[3];
    if (menu.type !== 'menu') throw new Error('expected a menu');
    expect(menu.choices[1].leading).toEqual(['', '# The bold option']);
    expect(menu.choices[1].body[0].leading).toEqual(['# TODO: write this branch']);
    const ifs = body[4];
    if (ifs.type !== 'if') throw new Error('expected an if');
    expect(ifs.branches[1].leading).toEqual(['', '# Only when n is exactly 1']);
    expect(program.trailing).toEqual(['# Notes at the end of the file.']);
  });

  it('normalizes messy spacing into canonical form', () => {
    const messy = '\n\n# cast\ndefine a "A"\n\n\n\nlabel start:\n\n  a: Hi.\n\n\n\n  "Bye."\nlabel next:\n  "x"\n\n\n';
    const once = print(parse(messy).program);
    expect(once).toBe('# cast\ndefine a "A"\n\nlabel start:\n  a: Hi.\n\n  "Bye."\n\nlabel next:\n  "x"\n');
    expect(print(parse(once).program)).toBe(once);
  });

  it('does not change what the story compiles to', () => {
    const plain = compile(canonical.replace(/^\s*#.*$/gm, '')).story!;
    const commented = compile(canonical).story!;
    expect(commented.code).toEqual(plain.code.map((i, n) => ({ ...i, src: commented.code[n].src })));
  });
});

describe('end-of-line comments', () => {
  const canonical = `---
# The working title
title: Comments  # for now
start: start
# shown in the window
---

define a "Alice" color=#c33  # red-haired

var n = 0  # times she waved

layered a:  # three layers
  always "a/body.png"  # never changes
  group face:
    smile "a/smile.png"  # the default

screen hud:  # top corner
  text "Day {n}" at 4% 4%  # the day counter

label start:  # the opening
  scene black  # nothing yet
  a: Room #4, please.  # # without a space after is text
  a: "Quoted # stays text."
  a: Escaped \\# stays text too.
  menu:  # the first choice
    "Wave":  # friendly
      set n += 1  # count it
  if n > 0:  # waved
    "Yes."
  elif n == 0:  # didn't
    "No."
  else:  # can't happen
    "?"
`;

  it('keep every comment, byte for byte', () => {
    const { program, diagnostics } = parse(canonical);
    expect(diagnostics).toEqual([]);
    expect(print(program)).toBe(canonical);
  });

  it('are not part of the line', () => {
    const { program } = parse(canonical);
    expect(program.meta).toEqual([['title', 'Comments'], ['start', 'start']]);
    expect(program.metaTrivia).toEqual({ 0: { leading: ['# The working title'], comment: '# for now' } });
    expect(program.metaTrailing).toEqual(['# shown in the window']);
    expect(program.characters[0]).toMatchObject({ color: '#c33', comment: '# red-haired' });
    const body = program.labels[0]!.body;
    expect(body.slice(1, 4).map((s) => s.type === 'say' && s.text)).toEqual(['Room #4, please.', 'Quoted # stays text.', 'Escaped \\# stays text too.']);
    expect(body[1]!.comment).toBe('# # without a space after is text');
    const story = compile(canonical).story!;
    expect(story.meta.title).toBe('Comments');
    const says = story.code.filter((i) => i.op === 'say').map((i) => (i as { text: unknown }).text);
    expect(JSON.stringify(says)).toContain('Escaped # stays text too.');
  });

  it('move to the end of the line when formatted', () => {
    const messy = 'label start:   # opening\n  "Hi."    #  note  \n';
    expect(print(parse(messy).program)).toBe('label start:  # opening\n  "Hi."  #  note\n');
  });
});

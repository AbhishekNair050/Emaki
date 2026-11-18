import { readFileSync } from 'node:fs';
import { parse } from '@emaki/format';
import { describe, expect, it } from 'vitest';
import { beatsOf } from '../src/timeline.ts';

const demo = readFileSync(new URL('../../../games/gullwing/story.vn', import.meta.url), 'utf8');

describe('beatsOf', () => {
  it('makes a column for each line of dialogue and each choice, with what leads up to it', () => {
    const { program } = parse(`label a:
  scene kitchen with dissolve
  play music theme
  show mira neutral at right
  "Narration."
  mira smile: Hello.  # a comment
  menu:
    "Stay.":
      set trust += 1
      mira: Good.
    "Go.":
      jump b
  hide mira
  jump b
`);
    const beats = beatsOf(program.labels[0]!);
    expect(beats.map((b) => [b.line, b.kind, b.who, b.depth])).toEqual([
      [5, 'say', null, 0],
      [6, 'say', 'mira', 0],
      [7, 'menu', null, 0],
      [10, 'say', 'mira', 1],
      [14, 'end', null, 0],
    ]);
    expect(beats[0]).toMatchObject({ picture: ['scene kitchen with dissolve', 'show mira neutral at right'], sound: ['play music theme'], flow: [] });
    expect(beats[2]!.text).toBe('Stay. / Go.');
    expect(beats[3]!.flow).toEqual(['choice: Stay.', 'set trust += 1']);
    expect(beats[4]).toMatchObject({ picture: ['hide mira'], flow: ['choice: Go.', 'jump b', 'jump b'] });
  });

  it('keeps every beat of the demo in line order', () => {
    const { program } = parse(demo);
    for (const label of program.labels) {
      const lines = beatsOf(label).map((b) => b.line);
      expect(lines, label.name).toEqual([...lines].sort((x, y) => x - y));
      expect(lines.length, label.name).toBeGreaterThan(0);
    }
  });
});

import { readFileSync } from 'node:fs';
import { parse } from '@emaki/format';
import { describe, expect, it } from 'vitest';
import { beatsOf } from '../src/timeline.ts';

const demo = readFileSync(new URL('../../../games/gullwing/story.vn', import.meta.url), 'utf8');

describe('beatsOf', () => {
  it('makes a column for each line of dialogue and each choice, with the stage as it is there', () => {
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
  stop music
  jump b
`);
    const beats = beatsOf(program.labels[0]!);
    expect(beats.map((b) => [b.line, b.kind, b.who, b.depth])).toEqual([
      [5, 'say', null, 0],
      [6, 'say', 'mira', 0],
      [7, 'menu', null, 0],
      [10, 'say', 'mira', 1],
      [15, 'end', null, 0],
    ]);
    // The first line: the background and the music start, Mira is on stage at the right.
    expect(beats[0]).toMatchObject({ bg: 'kitchen', bgChanged: true, music: 'theme', musicChanged: true, cast: { mira: { look: 'neutral', at: 'right' } } });
    // Speaking with a look changes it; the stage carries on.
    expect(beats[1]).toMatchObject({ bgChanged: false, musicChanged: false, cast: { mira: { look: 'smile', at: 'right' } } });
    expect(beats[2]).toMatchObject({ text: 'Stay. / Go.', branch: ['2 choices'] });
    expect(beats[3]!.branch).toEqual(['“Stay.”']);
    // After the menu: Mira leaves, the music stops, and the scene jumps on.
    expect(beats[4]).toMatchObject({ cast: {}, music: null, musicChanged: true, branch: ['“Go.”', 'jump b', 'jump b'] });
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

import { compile } from '@emaki/format';
import { describe, expect, it } from 'vitest';
import { sceneStats } from '../src/scene-stats.ts';

describe('sceneStats', () => {
  it('counts lines, words and choices of each scene, and what it sets and shows', () => {
    const { story } = compile(`define mira "Mira"
image kitchen = "bg/kitchen.png"
var trust = 0
label a:
  scene kitchen
  set trust += 1
  "One two three."
  mira: Four *five*.[w] Six.
  menu:
    "Go.":
      jump b
label b:
  "日本語です"
`);
    const stats = sceneStats(story!);
    expect(stats.get('a')).toMatchObject({ lines: 2, words: 6, choices: 1, sets: ['trust'], picture: 'bg/kitchen.png' });
    expect(stats.get('a')!.ids).toHaveLength(2);
    // No spaces in Japanese: each character counts.
    expect(stats.get('b')).toMatchObject({ lines: 1, words: 5, choices: 0, sets: [], picture: null });
  });
});

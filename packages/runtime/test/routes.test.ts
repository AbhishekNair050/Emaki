import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from '@emaki/format';
import { describe, expect, it } from 'vitest';
import { findRoutes } from '../src/index.ts';

const demo = compile(readFileSync(fileURLToPath(new URL('../../../games/gullwing/story.vn', import.meta.url)), 'utf8')).story!;

const story = (src: string) => {
  const r = compile(src);
  if (!r.story) throw new Error(r.diagnostics.map((d) => d.message).join('\n'));
  return r.story;
};

describe('findRoutes', () => {
  it('finds every ending of the demo, with the choices that lead there', () => {
    const r = findRoutes(demo);
    expect(r.complete).toBe(true);
    expect(r.routes.map((x) => x.ending).sort()).toEqual(['ending_light_holds', 'ending_rough_water', 'ending_two_keepers']);
    const best = r.routes.find((x) => x.ending === 'ending_two_keepers')!;
    // Two Keepers needs trust 2 and the boat safe: the scene starts with those values.
    expect(best.scenes.at(-1)).toMatchObject({ label: 'ending_two_keepers' });
    const night = best.scenes.find((s) => s.label === 'the_long_night')!;
    expect(night.vars.boat_safe).toBe(true);
    expect(Number(night.vars.trust)).toBeGreaterThanOrEqual(2);
    expect(best.choices.map((c) => c.label)).toEqual(['arrival', 'kitchen_talk', 'lamp_room_trouble']);
    expect(best.choices[0]!.line).toBeGreaterThan(0);
    // Each scene knows which of the route's choices it made: kitchen_talk made the second one.
    const kitchen = best.scenes.findIndex((s) => s.label === 'kitchen_talk');
    expect(best.scenes[kitchen]!.choicesBefore).toBe(1);
    expect(best.scenes[kitchen + 1]!.choicesBefore).toBe(2);
  });

  it('names declared endings and skips choices it has already explored in the same state', () => {
    const s = story(`
ending good "The Good End"
var n = 0
label a:
  menu:
    "One.":
      set n += 1
    "Also one.":
      set n += 1
  menu:
    "Win.":
      end good
    "Lose.":
      end
`);
    const r = findRoutes(s);
    expect(r.routes.map((x) => [x.ending, x.name])).toEqual([['good', 'The Good End'], ['a', undefined]]);
    // The second menu is reached with n = 1 both ways: explored once.
    expect(r.states).toBe(2);
    expect(r.routes[0]!.choices.map((c) => c.text)).toEqual(['One.', 'Win.']);
  });

  it('stops when its time runs out, and says so', () => {
    let t = 0;
    const r = findRoutes(demo, { budgetMs: 5, now: () => (t += 10) });
    expect(r.complete).toBe(false);
  });

  it('survives loops that never reach a choice', () => {
    const r = findRoutes(story('label a:\n  "Again."\n  jump a\n'), { budgetMs: 50 });
    expect(r.routes).toEqual([]);
    expect(r.complete).toBe(false);
  });
});

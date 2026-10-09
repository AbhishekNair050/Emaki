import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '@emaki/format';
import { Runner, StoryError, type Block, type Step } from '../src/index.ts';

const demoSrc = readFileSync(fileURLToPath(new URL('../../../games/gullwing/story.vn', import.meta.url)), 'utf8');
const demo = compile(demoSrc).story!;

function story(src: string) {
  const r = compile(src);
  if (!r.story) throw new Error(r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n'));
  return r.story;
}

/** Play to the end, picking menu options by matching text. Returns all blocks seen. */
function playthrough(r: Runner, picks: string[]): Block[] {
  const seen: Block[] = [];
  let step: Step = r.start();
  const queue = [...picks];
  for (let guard = 0; guard < 1000; guard++) {
    seen.push(step.block);
    const b = step.block;
    if (b.type === 'end') return seen;
    if (b.type === 'menu') {
      const want = queue.shift();
      if (want === undefined) throw new Error(`Ran out of picks at menu: ${b.choices.map((c) => c.text).join(' | ')}`);
      const c = b.choices.find((x) => x.text.startsWith(want));
      if (!c) throw new Error(`No choice starting with "${want}" in: ${b.choices.map((x) => x.text).join(' | ')}`);
      step = r.choose(c.index);
    } else step = r.advance();
  }
  throw new Error('Playthrough did not finish');
}

const lastSay = (blocks: Block[]) =>
  [...blocks].reverse().find((b): b is Extract<Block, { type: 'say' }> => b.type === 'say')!.text;

describe('demo story: every ending is reachable', () => {
  it('Two Keepers (trusting path)', () => {
    const r = new Runner(demo);
    const blocks = playthrough(r, ['I wanted to see', 'Leave it alone', 'Tell me what to do']);
    expect(lastSay(blocks)).toBe('Ending: Two Keepers.');
    expect(r.vars).toMatchObject({ trust: 3, boat_safe: true, lamp_fixed: true, read_letter: false });
  });

  it('Two Keepers after reading the letter mentions it', () => {
    const r = new Runner(demo);
    const blocks = playthrough(r, ['I wanted to see', 'Read the letter', 'Tell me what to do']);
    expect(lastSay(blocks)).toBe('Ending: Two Keepers.');
    expect(blocks.some((b) => b.type === 'say' && b.text === 'You read my letter.')).toBe(true);
  });

  it('The Light Holds', () => {
    const blocks = playthrough(new Runner(demo), ['The driver', 'Read the letter', "I'll crank"]);
    expect(lastSay(blocks)).toBe('Ending: The Light Holds.');
  });

  it('Rough Water', () => {
    const blocks = playthrough(new Runner(demo), ['The driver', 'Leave it alone', "I'll take the radio"]);
    expect(lastSay(blocks)).toBe('Ending: Rough Water.');
  });

  it('hides the trust-gated choice when trust is 0', () => {
    const r = new Runner(demo);
    expect(() => playthrough(r, ['The driver', 'Read the letter', 'Tell me what to do'])).toThrow(/No choice starting/);
  });
});

describe('runner mechanics', () => {
  const src = `define a "Alice" color=#f00
image a happy = "a_happy.png"
image a sad = "a_sad.png"
image room = "room.png"
var n = 0

label start:
  scene room with fade
  show a happy at left
  a: Hi, n is {n}.
  menu:
    "Add":
      set n += 5
    "Skip":
      "Skipped."
  a sad: Now n is {n}.
  call sub
  "After sub, n is {n}."

label sub:
  set n = n * 2
  "In sub."
  return
`;

  it('emits effects before the blocking line and interpolates variables', () => {
    const r = new Runner(story(src));
    const s = r.start();
    expect(s.effects.map((e) => e.type)).toEqual(['scene', 'show']);
    expect(s.effects[1]).toMatchObject({ path: 'a_happy.png', at: 'left', isNew: true });
    expect(s.block).toMatchObject({ type: 'say', text: 'Hi, n is 0.', who: { name: 'Alice', color: '#f00' } });
  });

  it('changes sprite attributes from dialogue, runs call/return', () => {
    const r = new Runner(story(src));
    r.start();
    const menu = r.advance();
    expect(menu.block.type).toBe('menu');
    const s = r.choose(0);
    expect(s.effects).toEqual([expect.objectContaining({ type: 'show', path: 'a_sad.png', isNew: false })]);
    expect(s.block).toMatchObject({ text: 'Now n is 5.' });
    expect(r.advance().block).toMatchObject({ text: 'In sub.' });
    expect(r.advance().block).toMatchObject({ text: 'After sub, n is 10.' });
    expect(r.advance().block.type).toBe('end');
  });

  it('rolls back through choices, undoing variable changes', () => {
    const r = new Runner(story(src));
    r.start();
    r.advance();
    r.choose(0);
    expect(r.vars.n).toBe(5);
    const back = r.back()!;
    expect(back.block.type).toBe('menu');
    expect(r.vars.n).toBe(0);
    expect(r.choose(1).block).toMatchObject({ text: 'Skipped.' });
  });

  it('restores scene state on rollback', () => {
    const r = new Runner(story(src));
    r.start();
    r.advance();
    r.choose(0); // a sad
    r.back();
    expect(r.scene()).toEqual({ bg: 'room', sprites: [{ tag: 'a', attrs: ['happy'], at: 'left' }] });
  });

  it('saves and loads mid-story', () => {
    const st = story(src);
    const r1 = new Runner(st);
    r1.start();
    r1.advance();
    r1.choose(0);
    const save = JSON.parse(JSON.stringify(r1.save()));

    const r2 = new Runner(st);
    expect(r2.load(save)).toEqual({ ok: true, mismatch: false });
    expect(r2.block).toMatchObject({ text: 'Now n is 5.' });
    expect(r2.scene().sprites[0].attrs).toEqual(['sad']);
    expect(r2.advance().block).toMatchObject({ text: 'In sub.' });
  });

  it('remembers the line a menu responds to, across save/load', () => {
    const st = story(src);
    const r1 = new Runner(st);
    r1.start();
    r1.advance(); // at menu
    const r2 = new Runner(st);
    r2.load(JSON.parse(JSON.stringify(r1.save())));
    expect(r2.block?.type).toBe('menu');
    expect(r2.lastSay).toMatchObject({ text: 'Hi, n is 0.' });
  });

  it('resumes at the same line after the script is edited', () => {
    const r1 = new Runner(story(src));
    r1.start();
    r1.advance();
    r1.choose(0); // "Now n is 5."
    const save = r1.save();
    const edited = story(src.replace('label start:\n', 'label start:\n  "A new opening line."\n'));
    const r2 = new Runner(edited);
    const step = r2.resume(save)!;
    expect(step.block).toMatchObject({ text: 'Now n is 5.' });
    expect(r2.vars.n).toBe(5);
  });

  it('tags every line with the label it belongs to', () => {
    const r = new Runner(story(src));
    expect(r.start().block).toMatchObject({ label: 'start' });
    r.advance();
    r.choose(0);
    expect(r.advance().block).toMatchObject({ text: 'In sub.', label: 'sub' });
  });

  it('starts from any label, with overridden variables and kept scene', () => {
    const r = new Runner(demo);
    r.start();
    const scene = r.scene();
    const step = r.startAt('the_long_night', { vars: { trust: 3, boat_safe: true, nonsense: 1 }, scene });
    expect(step.block).toMatchObject({ label: 'the_long_night', text: 'By dawn the storm has blown itself out over the headland.' });
    expect(r.vars).toMatchObject({ trust: 3, boat_safe: true });
    expect(r.vars).not.toHaveProperty('nonsense');
    let b = step.block;
    while (b.type !== 'end') b = r.advance().block;
    expect(r.log.at(-1)!.text).toBe('Ending: Two Keepers.');
    expect(() => r.startAt('nowhere')).toThrow(StoryError);
  });

  it('lets tools change declared variables only', () => {
    const r = new Runner(demo);
    r.start();
    r.setVar('trust', 5);
    expect(r.vars.trust).toBe(5);
    expect(() => r.setVar('trsut', 1)).toThrow(StoryError);
  });

  it('rejects garbage saves', () => {
    const r = new Runner(story(src));
    expect(r.load({} as never).ok).toBe(false);
  });

  it('detects infinite loops with no dialogue', () => {
    const r = new Runner(story(`var x = 0\nlabel start:\n  set x += 1\n  jump start\n`));
    expect(() => r.start()).toThrow(StoryError);
  });

  it('ends the story when a jumped-to label runs out of lines', () => {
    const r = new Runner(story(`label start:\n  "Only line."\n`));
    r.start();
    expect(r.advance().block.type).toBe('end');
  });
});

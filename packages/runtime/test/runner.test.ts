import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '@emaki/format';
import { Runner, StoryError, type Block, type SayBlock, type Step } from '../src/index.ts';

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

  it('starts at a script line, with the scene rebuilt from the top of its label', () => {
    const r = new Runner(demo);
    const step = r.startAtLine(57);
    expect(step.block).toMatchObject({ type: 'say', line: 57, label: 'kitchen_talk' });
    expect(r.scene()).toEqual({ bg: 'kitchen', sprites: [{ tag: 'mira', attrs: ['neutral'], at: 'right' }] });
    // A blank or declaration line starts at the next thing that happens.
    expect(r.startAtLine(52).block).toMatchObject({ line: 56, label: 'kitchen_talk' });
    expect(() => r.startAtLine(10_000)).toThrow(/past the end/);
  });

  it('applies chosen variables when starting at a line', () => {
    const r = new Runner(demo);
    expect(r.startAtLine(72, { vars: { read_letter: true, nope: 1 } }).block).toMatchObject({ line: 72 });
    expect((r.advance().block as SayBlock).text).toMatch(/^Her eyes go to the letter/);
    expect(r.vars).not.toHaveProperty('nope');
    expect(r.startAtLine(72).block).toMatchObject({ line: 72 });
    expect(r.advance().block).toMatchObject({ who: { id: 'mira' }, text: "You poured me one. That's a start." });
  });

  it('lets tools change declared variables only', () => {
    const r = new Runner(demo);
    r.start();
    r.setVar('trust', 5);
    expect(r.vars.trust).toBe(5);
    expect(() => r.setVar('trsut', 1)).toThrow(StoryError);
  });

  it('fills variables into styled spans and choices', () => {
    const r = new Runner(story(`define a "A"
var who = "Mira"
label start:
  a: Hello, **{who}**!
  menu:
    "*Wave* at {who}":
      end
`));
    expect(r.start().block).toMatchObject({ text: 'Hello, Mira!', spans: [{ text: 'Hello, ' }, { text: 'Mira', b: true }, { text: '!' }] });
    const menu = r.advance().block;
    expect(menu).toMatchObject({ type: 'menu', choices: [{ text: 'Wave at Mira', spans: [{ text: 'Wave', i: true }, { text: ' at Mira' }] }] });
  });

  it('looks ahead for images to preload, nearest first, down every branch', () => {
    const r = new Runner(demo);
    // Before starting: the opening background and Mira come into view within a few lines.
    expect(r.upcomingImages(4)).toEqual(['bg/cliff_road_dusk.svg', 'sprites/mira_neutral.svg']);
    r.start();
    for (let i = 0; i < 6; i++) r.advance(); // "You're early." — the first menu is next
    const ahead = r.upcomingImages(3);
    // Menu → a choice's first line (1) → the shared line after the menu (2) → jump into the kitchen (3).
    // Both branches are followed, so the smile that only one of them shows is included.
    expect(ahead).toContain('sprites/mira_smile.svg');
    expect(ahead).toContain('bg/kitchen_night.svg');
    expect(ahead).not.toContain('bg/lamp_room.svg');
    expect(r.upcomingImages(0)).toEqual([]); // just the menu itself: nothing to load yet
  });

  it('looks ahead through calls and back out again', () => {
    const r = new Runner(story([
      'image a = "a.png"', 'image b = "b.png"', 'image c = "c.png"',
      'label start:', '  "One."', '  call sub', '  scene c', '  "Three."',
      'label sub:', '  scene a', '  "Two."', '  scene b',
    ].join('\n')));
    r.start();
    expect(r.upcomingImages(0)).toEqual(['a.png']); // before "Two."
    expect(r.upcomingImages(1)).toEqual(['a.png', 'b.png', 'c.png']); // after it, and back in the caller
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

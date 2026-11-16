import { describe, expect, it } from 'vitest';
import { compile } from '@emaki/format';
import { Runner, type Effect } from '../src/index.ts';

const SRC = `---
canvas: 1920x1080
---
image street = "bg/street.png"
image street night = "bg/street_night.png"
image glow = "fx/glow.png"
image mira smile = "mira/smile.png"

label start:
  show street as far at 960 540 zoom 0.65 depth 26
  show street as near at 0 0 anchor 0% 0%
  show glow at 25% 50% blend add
  with dissolve 0.4
  "One."
  show street night as far
  animate far zoom 0.7 over 3 ease in-out-sine
  "Two."
  hide near
  animate near opacity 0 over 1
  "Three."
`;

const story = () => compile(SRC).story!;
const of = <T extends Effect['type']>(effects: Effect[], type: T) => effects.filter((e) => e.type === type) as Extract<Effect, { type: T }>[];

describe('free layers in the runtime (D-062)', () => {
  it('keeps one layer per name, each with its picture and properties', () => {
    const run = new Runner(story());
    const step = run.start();
    const shows = of(step.effects, 'show');
    expect(shows.map((s) => [s.tag, s.path])).toEqual([['far', 'bg/street.png'], ['near', 'bg/street.png'], ['glow', 'fx/glow.png']]);
    expect(shows[0]!.props).toEqual({ x: 50, y: 50, zoom: [0.65, 0.65], depth: 26 });
    expect(of(step.effects, 'with')).toEqual([{ type: 'with', transition: 'dissolve', duration: 0.4 }]);
    // `with` comes after the changes it shows
    expect(step.effects.map((e) => e.type)).toEqual(['show', 'show', 'show', 'with']);
    const sprites = run.save().state.scene.sprites;
    expect(sprites.map((s) => [s.tag, s.image])).toEqual([['far', 'street'], ['near', 'street'], ['glow', undefined]]);
  });

  it('changes a named layer\'s picture in place, and animates toward targets the state keeps', () => {
    const run = new Runner(story());
    run.start();
    const step = run.advance();
    const show = of(step.effects, 'show')[0]!;
    expect(show).toMatchObject({ tag: 'far', path: 'bg/street_night.png', isNew: false, props: { x: 50, depth: 26 } });
    expect(of(step.effects, 'animate')).toEqual([{ type: 'animate', tag: 'far', props: { zoom: [0.7, 0.7] }, duration: 3, ease: 'in-out-sine' }]);
    const far = run.save().state.scene.sprites.find((s) => s.tag === 'far')!;
    expect(far).toMatchObject({ image: 'street', attrs: ['night'], props: { zoom: [0.7, 0.7], depth: 26 } });
    expect(run.spriteLayers(far)).toEqual(['bg/street_night.png']);
  });

  it('animating a layer that isn\'t on screen does nothing', () => {
    const run = new Runner(story());
    run.start();
    run.advance();
    const step = run.advance();
    expect(of(step.effects, 'hide').map((h) => h.tag)).toEqual(['near']);
    expect(of(step.effects, 'animate')).toEqual([]);
  });

  it('hides by name, and rebuilds layers when starting at a line', () => {
    const run = new Runner(story());
    run.start();
    run.advance();
    run.advance();
    expect(run.save().state.scene.sprites.map((s) => s.tag)).toEqual(['far', 'glow']);
    const at = new Runner(story());
    at.startAtLine(17); // "Two."
    const far = at.save().state.scene.sprites.find((s) => s.tag === 'far')!;
    expect(far).toMatchObject({ image: 'street', attrs: ['night'], props: { zoom: [0.7, 0.7] } });
  });

  it('saves and loads layers', () => {
    const run = new Runner(story());
    run.start();
    run.advance();
    const save = JSON.parse(JSON.stringify(run.save()));
    const other = new Runner(story());
    expect(other.load(save).ok).toBe(true);
    expect(other.save().state.scene.sprites).toEqual(run.save().state.scene.sprites);
  });

  it('plays animations: one that ends leaves its last key, a loop is kept for after a load', () => {
    const run = new Runner(compile(`image glow = "g.png"
animation pulse loop:
  0 opacity 0.5
  1 opacity 1
animation fade:
  0 opacity 1
  2 opacity 0 zoom 2
label start:
  show glow
  animate glow with pulse
  "One."
  animate glow with fade
  "Two."
  animate glow stop
  "Three."
`).story!);
    const one = run.start();
    expect(of(one.effects, 'animate')).toEqual([{ type: 'animate', tag: 'glow', props: {}, duration: 0, ease: 'linear', animation: 'pulse' }]);
    expect(run.save().state.scene.sprites[0]).toMatchObject({ track: 'pulse', props: { opacity: 0.5 } });
    run.advance();
    const glow = run.save().state.scene.sprites[0]!;
    expect(glow.track).toBeUndefined();
    expect(glow.props).toEqual({ opacity: 0, zoom: [2, 2] });
    expect(of(run.advance().effects, 'animate')[0]).toMatchObject({ animation: null });
  });

  it('starting at a line shows what the labels running straight into its label put on screen', () => {
    const run = new Runner(compile(`image room = "room.png"
image cat = "cat.png"
label start:
  scene room
  "In the room."
  jump next
label next:
  show cat as pet at 50% 50%
  "A cat."
`).story!);
    run.startAtLine(9);
    const scene = run.save().state.scene;
    expect(scene.bg).toBe('room');
    expect(scene.sprites.map((s) => s.tag)).toEqual(['pet']);
  });
});
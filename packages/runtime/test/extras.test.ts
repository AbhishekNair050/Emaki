import { describe, expect, it } from 'vitest';
import { compile, parse, print } from '@emaki/format';
import { Runner } from '../src/index.ts';

const SRC = `image beach = "cg/beach.png"

audio theme = "music/theme.ogg" music "Forget Me Not"
audio rain = "sound/rain.ogg"

var met = false

replay meeting "The Meeting" image beach
replay walk "A Walk" until after

label start:
  "Prologue."
  jump meeting

label meeting:
  set met = true
  "We meet."
  call aside
  "We part."
  jump walk

label aside:
  "An aside."
  return

label walk:
  "Walking."
  jump more

label more:
  "Still walking."
  jump after

label after:
  "Home."
`;

describe('music room and replays', () => {
  it('parse, print back and compile', () => {
    const p = parse(SRC);
    expect(p.diagnostics).toEqual([]);
    expect(print(p.program)).toBe(SRC);
    const r = compile(SRC);
    expect(r.diagnostics).toEqual([]);
    expect(r.story!.music).toEqual([{ name: 'theme', title: 'Forget Me Not', path: 'music/theme.ogg' }]);
    expect(r.story!.replays).toEqual([
      { label: 'meeting', name: 'The Meeting', image: 'cg/beach.png' },
      { label: 'walk', name: 'A Walk', until: 'after' },
    ]);
    expect(r.strings.filter((s) => s.kind === 'replay' || s.kind === 'music').map((s) => s.id)).toEqual(['replay.meeting', 'replay.walk', 'music.theme']);
  });

  it('explain mistakes', () => {
    const codes = (top: string) => compile(`${top}\nlabel start:\n  "x"\n`).diagnostics.map((d) => d.code);
    expect(codes('replay nowhere "X"')).toContain('unknown-label');
    expect(codes('replay start "X" image nope')).toEqual(['unknown-image']);
    expect(codes('replay start "X" until nowhere')).toEqual(['unknown-label']);
    expect(codes('replay start "X"\nreplay start "Y"')).toEqual(['duplicate']);
    expect(codes('replay start')).toEqual(['bad-replay']);
    expect(codes('audio a = "a.ogg" music')).toEqual(['bad-audio']);
    expect(codes('audio a = "a.ogg" loud')).toEqual(['bad-audio']);
  });

  it('replay a scene until the story leaves its label, calls included', () => {
    const run = new Runner(compile(SRC).story!);
    expect(run.startReplay('meeting').block).toMatchObject({ text: 'We meet.' });
    expect(run.inReplay).toBe(true);
    expect(run.vars.met).toBe(true);
    expect(run.advance().block).toMatchObject({ text: 'An aside.' });   // a call stays in the scene
    expect(run.advance().block).toMatchObject({ text: 'We part.' });
    expect(run.advance().block).toEqual({ type: 'end' });              // jumping to walk ends it
  });

  it('replay across labels up to `until`, and stop replaying on a new game', () => {
    const run = new Runner(compile(SRC).story!);
    run.startReplay('walk', 'after');
    expect(run.advance().block).toMatchObject({ text: 'Still walking.' });
    expect(run.advance().block).toEqual({ type: 'end' });
    run.start();
    expect(run.inReplay).toBe(false);
    run.advance();
    expect(run.block).toMatchObject({ text: 'We meet.' });              // a normal game goes on past the scene
  });
});

describe('extras screen elements', () => {
  it('compile scenes and music lists', () => {
    const src = SRC.replace('label start:', 'screen extras:\n  scenes 6 columns 3 gap 2%\n  music 8\n  button "Next" -> page next\n\nlabel start:');
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.story!.screens!.extras!.items.map((i) => [i.kind, i.count, i.columns])).toEqual([['scenes', 6, 3], ['music', 8, undefined], ['button', undefined, undefined]]);
    expect(print(parse(src).program)).toBe(src);
  });
});

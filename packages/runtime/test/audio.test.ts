import { describe, expect, it } from 'vitest';
import { compile, parse, print } from '@emaki/format';
import { Runner } from '../src/index.ts';

const SRC = `label a:
  play sound "audio/rain.ogg" loop
  play voice "voice/001.ogg"
  play sound "audio/door.ogg"
  "It's raining."
  stop sound
  "It stopped."
`;

function runner() {
  const r = compile(SRC);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return new Runner(r.story!);
}

describe('sound and voice channels', () => {
  it('keeps a looping sound in the state, but not one-shots or voices', () => {
    const run = runner();
    const step = run.start();
    expect(step.effects.map((e) => e.type === 'play' && `${e.channel}:${e.loop}`)).toEqual(['sound:true', 'voice:false', 'sound:false']);
    expect(run.audio().sound).toEqual({ path: 'audio/rain.ogg', loop: true });
    run.advance();
    expect(run.audio().sound).toBeNull();
  });

  it('brings the looping sound back on load and rollback', () => {
    const run = runner();
    run.start();
    const save = run.save();
    run.advance();
    expect(run.audio().sound).toBeNull();
    run.back();
    expect(run.audio().sound?.path).toBe('audio/rain.ogg');
    const other = runner();
    expect(other.load(save).ok).toBe(true);
    expect(other.audio().sound?.path).toBe('audio/rain.ogg');
  });

  it('rebuilds the looping sound when starting at a line', () => {
    const run = runner();
    run.startAtLine(5);
    expect(run.audio().sound?.path).toBe('audio/rain.ogg');
  });
});

describe('the ambience channel', () => {
  const AMB = `label a:
  play music "audio/theme.ogg"
  play ambience "audio/rain.ogg" fade 2
  play sound "audio/door.ogg"
  "Rain under the music."
  stop sound
  "Effects stopped; the rain goes on."
  stop ambience fade 1
  "Quiet."
`;

  it('loops by default, is part of the state, and is separate from sound', () => {
    const run = new Runner(compile(AMB).story!);
    const step = run.start();
    expect(step.effects.map((e) => e.type === 'play' && `${e.channel}:${e.loop}`)).toEqual(['music:true', 'ambience:true', 'sound:false']);
    expect(run.audio().ambience).toEqual({ path: 'audio/rain.ogg' });
    run.advance();
    expect(run.audio().ambience).toEqual({ path: 'audio/rain.ogg' });
    const save = run.save();
    run.advance();
    expect(run.audio().ambience).toBeNull();
    expect(run.back()).not.toBeNull();
    expect(run.audio().ambience?.path).toBe('audio/rain.ogg');
    const other = new Runner(compile(AMB).story!);
    other.load(save);
    expect(other.audio().ambience?.path).toBe('audio/rain.ogg');
    other.startAtLine(7);
    expect(other.audio().ambience?.path).toBe('audio/rain.ogg');
  });

  it('plays several named loops at once, stops one by name, and all without one', () => {
    const SRC2 = `label a:
  play ambience "audio/rain.ogg" as rain
  play ambience "audio/wind.ogg" as wind fade 1
  play ambience "audio/crowd.ogg"
  "Everything at once."
  stop ambience wind fade 2
  "The wind dies down."
  stop ambience
  "Quiet."
`;
    const r = compile(SRC2);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const run = new Runner(r.story!);
    const step = run.start();
    expect(step.effects.map((e) => e.type === 'play' && e.slot)).toEqual(['rain', 'wind', undefined]);
    expect(run.audio().ambiences).toEqual({ rain: { path: 'audio/rain.ogg' }, wind: { path: 'audio/wind.ogg' } });
    expect(run.audio().ambience).toEqual({ path: 'audio/crowd.ogg' });
    const save = run.save();
    expect(run.advance().effects).toContainEqual({ type: 'stop', channel: 'ambience', fade: 2, slot: 'wind' });
    expect(run.audio().ambiences).toEqual({ rain: { path: 'audio/rain.ogg' } });
    run.advance();
    expect(run.audio().ambiences).toBeUndefined();
    expect(run.audio().ambience).toBeNull();
    const other = new Runner(r.story!);
    other.load(save);
    expect(Object.keys(other.audio().ambiences ?? {})).toEqual(['rain', 'wind']);
  });

  it('prints named loops back, and only ambience loops have names', () => {
    const src = 'label a:\n  play ambience "audio/rain.ogg" as rain fade 1\n  stop ambience rain\n  "x"\n';
    expect(print(parse(src).program)).toContain('  play ambience "audio/rain.ogg" as rain fade 1\n  stop ambience rain\n');
    expect(compile('label a:\n  play music "m.ogg" as theme\n  "x"\n').diagnostics.map((d) => d.message).join()).toMatch(/Only ambience loops have names/);
    expect(compile('label a:\n  stop music theme\n  "x"\n').diagnostics.map((d) => d.message).join()).toMatch(/Only ambience loops have names/);
  });
});

import { describe, expect, it } from 'vitest';
import { compile } from '@emaki/format';
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

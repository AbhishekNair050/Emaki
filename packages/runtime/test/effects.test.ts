import { describe, expect, it } from 'vitest';
import { compile, parse, print } from '@emaki/format';
import { Runner } from '../src/index.ts';

const SRC = `define flash "Flash"
image room = "room.png"
image street = "street.png"
image mira = "mira.png"

label start:
  scene room
  show mira at left
  show mira at right with move 0.8
  shake
  flash red 0.3
  camera zoom 1.5 at 70% 30% over 2
  "Zoomed in."
  camera reset over 1
  flash: I'm a character, not an effect.
  camera zoom 2
  "Zoomed again."
  scene street
  "A new scene."
`;

const codes = (src: string) => compile(src).diagnostics.map((d) => d.code);

describe('movement and screen effects', () => {
  it('parse and print back', () => {
    const p = parse(SRC);
    expect(p.diagnostics).toEqual([]);
    const out = print(p.program);
    for (const line of ['show mira at right with move 0.8', 'shake', 'flash red 0.3', 'camera zoom 1.5 at 70% 30% over 2', 'camera reset over 1', 'flash: I\'m a character', 'camera zoom 2']) {
      expect(out).toContain(`  ${line}`);
    }
    expect(print(parse(out).program)).toBe(out);
  });

  it('reject malformed effects', () => {
    const at = (line: string) => codes(`label start:\n  ${line}\n  "x"\n`);
    expect(at('shake hard')).toEqual(['bad-shake']);
    expect(at('shake 30')).toEqual(['bad-shake']);
    expect(at('flash purple')).toEqual(['bad-flash']);
    expect(at('flash #fff 0.2')).toEqual([]);
    expect(at('camera zoom 0.5')).toEqual(['bad-camera']);
    expect(at('camera zoom 2 at 50%')).toEqual(['bad-camera']);
    expect(at('camera zoom 2 at 120% 10%')).toEqual(['bad-camera']);
    expect(at('camera spin')).toEqual(['bad-camera']);
    expect(at('camera reset over')).toEqual(['bad-camera']);
  });

  it('emit effects, and keep the camera with the scene', () => {
    const run = new Runner(compile(SRC).story!);
    const first = run.start();
    const types = first.effects.map((e) => e.type);
    expect(types).toEqual(['scene', 'show', 'show', 'shake', 'flash', 'camera']);
    expect(first.effects[2]).toMatchObject({ type: 'show', at: 'right', transition: 'move', duration: 0.8, isNew: false });
    expect(first.effects[4]).toEqual({ type: 'flash', color: 'red', duration: 0.3 });
    expect(first.effects[5]).toEqual({ type: 'camera', camera: { zoom: 1.5, x: 70, y: 30 }, duration: 2 });
    expect(run.save().state.scene.camera).toEqual({ zoom: 1.5, x: 70, y: 30 });

    const second = run.advance();
    expect(second.effects).toEqual([{ type: 'camera', camera: null, duration: 1 }]);
    expect(second.block).toMatchObject({ who: { name: 'Flash' } });
    expect(run.save().state.scene.camera).toBeNull();

    run.advance();
    expect(run.save().state.scene.camera).toEqual({ zoom: 2, x: 50, y: 50 });
    run.advance(); // a new scene shows the whole picture again
    expect(run.save().state.scene.camera ?? null).toBeNull();
    expect(run.back()!.scene.camera).toEqual({ zoom: 2, x: 50, y: 50 });
  });

  it('restores the camera when starting from a line', () => {
    const run = new Runner(compile(SRC).story!);
    run.startAtLine(13);
    expect(run.save().state.scene.camera).toEqual({ zoom: 1.5, x: 70, y: 30 });
  });
});

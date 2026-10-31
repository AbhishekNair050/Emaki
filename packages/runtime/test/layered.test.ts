import { describe, expect, it } from 'vitest';
import { compile, compileFiles, parse, print } from '@emaki/format';
import { Runner, type Effect } from '../src/index.ts';

const SRC = `define mira "Mira"
image room = "room.png"

# Mira: one body, two outfits, three faces.
layered mira:
  always "mira/body.png"
  group outfit:
    casual "mira/casual.png"
    coat "mira/coat.png"
  # faces go on top of the outfit
  group face:
    neutral "mira/neutral.png"
    smile "mira/smile.png"
    sad "mira/sad.png"
  group blush optional:
    blush "mira/blush.png"

label start:
  scene room
  show mira
  "Defaults."
  show mira coat
  "The outfit changes; the face stays."
  mira smile blush: Oh!
  mira -blush: Ahem.
  show mira sad casual at left
  "Both groups at once."
`;

const layersOf = (fx: Effect[]) => fx.filter((e) => e.type === 'show').map((e) => (e as Extract<Effect, { type: 'show' }>).layers);

describe('layered characters', () => {
  it('parse and print back, comments included', () => {
    const p = parse(SRC);
    expect(p.diagnostics).toEqual([]);
    expect(p.program.layered[0]!.layers.map((l) => (l.kind === 'group' ? l.name : 'always'))).toEqual(['always', 'outfit', 'face', 'blush']);
    const out = print(p.program);
    expect(out).toContain('layered mira:\n  always "mira/body.png"\n  group outfit:\n    casual "mira/casual.png"');
    expect(out).toContain('  # faces go on top of the outfit\n  group face:');
    expect(out).toContain('  group blush optional:\n');
    expect(out).toContain('  mira -blush: Ahem.');
    expect(print(parse(out).program)).toBe(out);
  });

  it('swap one group at a time, and take optional layers off', () => {
    const run = new Runner(compile(SRC).story!);
    expect(layersOf(run.start().effects)).toEqual([['mira/body.png', 'mira/casual.png', 'mira/neutral.png']]);
    expect(layersOf(run.advance().effects)).toEqual([['mira/body.png', 'mira/coat.png', 'mira/neutral.png']]);
    expect(layersOf(run.advance().effects)).toEqual([['mira/body.png', 'mira/coat.png', 'mira/smile.png', 'mira/blush.png']]);
    expect(layersOf(run.advance().effects)).toEqual([['mira/body.png', 'mira/coat.png', 'mira/smile.png']]);
    const last = run.advance();
    expect(layersOf(last.effects)).toEqual([['mira/body.png', 'mira/casual.png', 'mira/sad.png']]);
    expect(run.save().state.scene.sprites[0]).toEqual({ tag: 'mira', attrs: ['casual', 'sad'], at: 'left' });
    expect(run.spriteLayers(run.save().state.scene.sprites[0]!)).toEqual(['mira/body.png', 'mira/casual.png', 'mira/sad.png']);
  });

  it('rebuild the layers when starting from a line', () => {
    const run = new Runner(compile(SRC).story!);
    run.startAtLine(25);
    expect(run.save().state.scene.sprites[0]!.attrs).toEqual(['coat', 'smile']);
  });

  it('check options, groups and plain images', () => {
    const codes = (body: string) => compile(SRC.replace(/label start:[\s\S]*/, `label start:\n${body}\n  "x"\n`)).diagnostics.map((d) => d.code);
    expect(codes('  show mira grin')).toEqual(['unknown-image']);
    expect(codes('  show mira smile sad')).toEqual(['bad-attribute']);
    expect(codes('  show mira -smile')).toEqual(['bad-attribute']);
    expect(codes('  show mira -blush')).toEqual([]);
    expect(codes('  show room -dim')).toEqual(['bad-attribute']);
    const clash = compile(`image mira happy = "x.png"\nlayered mira:\n  always "b.png"\nlabel start:\n  "x"\n`);
    expect(clash.diagnostics.map((d) => d.code)).toEqual(['duplicate']);
    const twice = compile(`layered mira:\n  group a:\n    x "1.png"\n  group b:\n    x "2.png"\nlabel start:\n  "x"\n`);
    expect(twice.diagnostics.map((d) => d.code)).toEqual(['duplicate']);
    expect(compile(`layered mira:\n  sometimes "b.png"\nlabel start:\n  "x"\n`).diagnostics.map((d) => d.code)).toEqual(['bad-layered']);
  });

  it('can live in another file', () => {
    const main = 'label start:\n  show mira smile\n  "Hi."\n';
    const part = SRC.replace(/\nlabel start:[\s\S]*/, '\n');
    const r = compileFiles(main, [{ path: 'characters.vn', source: part }]);
    expect(r.diagnostics).toEqual([]);
    expect(Object.keys(r.story!.layered!)).toEqual(['mira']);
  });
});

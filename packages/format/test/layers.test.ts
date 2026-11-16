import { describe, expect, it } from 'vitest';
import { compile, ease, EASES, parse, print, type Instr } from '../src/index.ts';

const SRC = `---
title: Layers
canvas: 1920x1080
---
image street = "bg/street.png"
image street night = "bg/street_night.png"
image glow = "fx/glow.png"
image mira smile = "mira/smile.png"

label start:
  show street as far at 960 540 anchor 50% 47.5% zoom 0.65 rotate -17.3 opacity 0.87 depth 26
  show glow at 25% 50% zoom 1.2 0.8 blend add
  show mira smile at left
  with dissolve 0.4
  "One."
  show street night as far
  animate far zoom 0.7 at 480 270 over 3 ease in-out-sine
  animate glow opacity 0 over 0.5
  with dissolve
  "Two."
  hide far
`;

const shows = (code: Instr[]) => code.filter((i) => i.op === 'show') as Extract<Instr, { op: 'show' }>[];

describe('free layers (D-062)', () => {
  it('parse names, points and properties, and print them back', () => {
    const { program, diagnostics } = parse(SRC);
    expect(diagnostics).toEqual([]);
    const body = program.labels[0]!.body;
    expect(body[0]).toMatchObject({
      type: 'show', tag: 'street', attrs: [], as: 'far', at: null,
      props: { x: { v: 960, unit: 'px' }, y: { v: 540, unit: 'px' }, anchor: [50, 47.5], zoom: [0.65, 0.65], rotate: -17.3, opacity: 0.87, depth: 26 },
    });
    expect(body[1]).toMatchObject({ type: 'show', tag: 'glow', props: { x: { v: 25, unit: '%' }, zoom: [1.2, 0.8], blend: 'add' } });
    expect(body[2]).toMatchObject({ type: 'show', tag: 'mira', attrs: ['smile'], at: 'left' });
    expect(body[2]).not.toHaveProperty('props');
    expect(body[3]).toMatchObject({ type: 'with', transition: 'dissolve', duration: 0.4 });
    expect(body[6]).toMatchObject({ type: 'animate', target: 'far', over: 3, ease: 'in-out-sine', props: { zoom: [0.7, 0.7], x: { v: 480, unit: 'px' } } });
    const printed = print(program);
    expect(printed).toContain('  show street as far at 960 540 anchor 50% 47.5% zoom 0.65 rotate -17.3 opacity 0.87 depth 26');
    expect(printed).toContain('  show glow at 25% 50% zoom 1.2 0.8 blend add');
    expect(printed).toContain('  animate far at 480 270 zoom 0.7 over 3 ease in-out-sine');
    expect(printed).toContain('  with dissolve 0.4\n');
    expect(print(parse(printed).program)).toBe(printed);
  });

  it('compile canvas pixels to percentages of the screen', () => {
    const r = compile(SRC);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const [far, glow, mira, night] = shows(r.story!.code);
    expect(far).toMatchObject({ tag: 'street', layer: 'far', props: { x: 50, y: 50, zoom: [0.65, 0.65], depth: 26 } });
    expect(glow!.props).toMatchObject({ x: 25, y: 50, blend: 'add' });
    expect(mira!.props).toBeUndefined();
    expect(night).toMatchObject({ tag: 'street', attrs: ['night'], layer: 'far' });
    const anim = r.story!.code.find((i) => i.op === 'animate');
    expect(anim).toMatchObject({ layer: 'far', duration: 3, ease: 'in-out-sine', props: { x: 25, y: 25, zoom: [0.7, 0.7] } });
    expect(r.story!.code.filter((i) => i.op === 'with')).toHaveLength(2);
    expect(r.diagnostics.find((d) => d.code === 'unknown-image')).toBeUndefined(); // `hide far` knows the name
  });

  it('explain mistakes', () => {
    const bad = (line: string) => compile(`image a = "a.png"\nlabel start:\n  ${line}\n`).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(bad('show a at 50%% 40%')[0]).toMatch(/Unknown position|at/);
    expect(bad('show a zoom')[0]).toMatch(/'zoom' needs a number/);
    expect(bad('show a opacity 2')[0]).toMatch(/out of range/);
    expect(bad('show a blend glow')[0]).toMatch(/Unknown blend 'glow'/);
    expect(bad('show a as')[0]).toMatch(/'as' needs a name/);
    expect(bad('animate a zoom 2')[0]).toMatch(/needs 'over'/);
    expect(bad('animate a depth 3 over 1')[0]).toMatch(/can't be animated/);
    expect(bad('animate a zoom 2 over 1 ease wobbly')[0]).toMatch(/Unknown ease 'wobbly'/);
    expect(bad('animate nobody zoom 2 over 1')[0]).toMatch(/can't be animated|No image|nobody/);
    expect(bad('with')[0]).toMatch(/needs a transition name/);
  });

  it('ease along Penner curves', () => {
    expect(EASES).toHaveLength(41);
    for (const e of EASES) {
      expect(ease(e, 0)).toBe(0);
      expect(ease(e, 1)).toBe(1);
    }
    expect(ease('linear', 0.25)).toBe(0.25);
    expect(ease('in-quad', 0.5)).toBe(0.25);
    expect(ease('out-quad', 0.5)).toBe(0.75);
    expect(ease('in-out-cubic', 0.5)).toBeCloseTo(0.5);
    expect(ease('out-back', 0.6)).toBeGreaterThan(1); // overshoots
  });

  it('declare keyed animations, play and stop them', () => {
    const src = `---
canvas: 1920x1080
---
image glow = "fx/glow.png"

animation flicker loop:
  0 opacity 0.6
  0.4 opacity 1 ease out-sine
  1.2 opacity 0.6

animation rise:
  0 at 960 1080
  3 at 960 540 zoom 1.2 ease in-out-cubic

label start:
  show glow
  animate glow with flicker
  "One."
  animate glow stop
  animate glow with rise
  "Two."
`;
    const p = parse(src);
    expect(p.diagnostics).toEqual([]);
    expect(p.program.animations).toHaveLength(2);
    expect(p.program.animations![0]).toMatchObject({ name: 'flicker', loop: true, keys: [{ time: 0, props: { opacity: 0.6 } }, { time: 0.4, ease: 'out-sine' }, { time: 1.2 }] });
    const printed = print(p.program);
    expect(printed).toContain('animation flicker loop:\n  0 opacity 0.6\n  0.4 opacity 1 ease out-sine\n  1.2 opacity 0.6\n');
    expect(printed).toContain('  animate glow with flicker\n');
    expect(printed).toContain('  animate glow stop\n');
    expect(print(parse(printed).program)).toBe(printed);
    const r = compile(src);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.story!.animations!.rise).toEqual({ loop: false, duration: 3, keys: [{ t: 0, props: { x: 50, y: 100 }, ease: 'linear' }, { t: 3, props: { x: 50, y: 50, zoom: [1.2, 1.2] }, ease: 'in-out-cubic' }] });
    expect(r.story!.code.filter((i) => i.op === 'animate').map((i) => (i as { animation?: string | null }).animation)).toEqual(['flicker', null, 'rise']);
  });

  it('explain mistakes in animations', () => {
    const bad = (body: string) => compile(`image a = "a.png"\n${body}\nlabel start:\n  show a\n  animate a with wobble\n`).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(bad('animation wobble:\n  zoom 1')[0]).toMatch(/starts with its time/);
    expect(bad('animation wobble:\n  2 zoom 1\n  1 zoom 2')[0]).toMatch(/order of time/);
    expect(bad('animation wobble:\n  0 depth 3')[0]).toMatch(/can't be animated/);
    expect(bad('animation other:\n  0 zoom 1')[0]).toMatch(/No animation named 'wobble'/);
    expect(bad('animation wobble loop:\n  0 zoom 1')[0]).toMatch(/needs keys after 0/);
  });

  it('leave scripts without layer properties as they were', () => {
    const r = compile('image mira smile = "m.png"\nlabel start:\n  show mira smile at 30% with dissolve\n  "Hi."\n');
    expect(shows(r.story!.code)[0]).toEqual(expect.objectContaining({ tag: 'mira', attrs: ['smile'], at: '30%', transition: 'dissolve' }));
    expect(shows(r.story!.code)[0]).not.toHaveProperty('props');
    expect(shows(r.story!.code)[0]).not.toHaveProperty('layer');
  });
});

import { describe, expect, it } from 'vitest';
import { compile, ease, EASES, gradeChannel, parse, print, type Instr } from '../src/index.ts';

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

  it('declare colour grades and put them, silhouettes, brightness, contrast and blur on layers', () => {
    const src = `---
canvas: 1920x1080
---
image sky = "bg/sky.png"
image sky bright = "bg/sky_bright.png"
image mira = "m.png"

grade dusk: gamma 0.94 0.78 0.57 levels #000010 #546b90 tint #ff6500 14% overlay tint #d73d00 8%
grade old: gray gamma 1.1

label start:
  show sky bright
  show sky as back grade dusk bright 1.2 contrast 0.8 blur 8
  show mira silhouette #000000
  "One."
  show mira silhouette none grade none
`;
    const p = parse(src);
    expect(p.diagnostics).toEqual([]);
    expect(p.program.grades![0]).toMatchObject({ name: 'dusk', grade: { gamma: [0.94, 0.78, 0.57], levels: [[0, 0, 16], [84, 107, 144]], tints: [{ color: [255, 101, 0], amount: 0.14, mode: 'overlay' }, { color: [215, 61, 0], amount: 0.08, mode: 'normal' }] } });
    const body = p.program.labels[0]!.body;
    expect(body[0]).toMatchObject({ tag: 'sky', attrs: ['bright'] }); // an expression called 'bright' is still the image
    expect(body[0]).not.toHaveProperty('props');
    expect(body[1]).toMatchObject({ props: { grade: 'dusk', bright: 1.2, contrast: 0.8, blur: { v: 8, unit: 'px' } } });
    const printed = print(p.program);
    expect(printed).toContain('grade dusk: gamma 0.94 0.78 0.57 levels #000010 #546b90 tint #ff6500 14% overlay tint #d73d00 8%\ngrade old: gray gamma 1.1\n');
    expect(printed).toContain('  show sky as back grade dusk bright 1.2 contrast 0.8 blur 8\n');
    expect(print(parse(printed).program)).toBe(printed);
    const r = compile(src);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Object.keys(r.story!.grades!)).toEqual(['dusk', 'old']);
    expect(shows(r.story!.code)[1]!.props).toMatchObject({ grade: 'dusk', blur: 8 / 19.2 });
    expect(shows(r.story!.code)[3]!.props).toEqual({ silhouette: 'none', grade: 'none' });
  });

  it('draw a grade as curves on each channel, as the original engine does', () => {
    expect(gradeChannel(undefined, 0, 100)).toBeCloseTo(100); // nothing: unchanged
    expect(gradeChannel({ levels: [[255, 255, 255], [0, 0, 0]] }, 1, 55)).toBeCloseTo(200); // a negative
    expect(gradeChannel({ gamma: [0.5, 1, 1] }, 0, 127.5)).toBeCloseTo(63.75); // gamma below 1 darkens
    expect(gradeChannel({ tints: [{ color: [255, 0, 0], amount: 0.5, mode: 'normal' }] }, 0, 0)).toBeCloseTo(127.5);
    expect(gradeChannel(undefined, 2, 100, 1 + 20 / 255)).toBeCloseTo(120); // brightness adds
    expect(gradeChannel(undefined, 2, 127.5, 1, 0.5)).toBeCloseTo(127.5); // contrast turns about the middle
    expect(gradeChannel(undefined, 2, 255, 1, 0)).toBeCloseTo(127.5 + 127.5 * 55 / 255);
  });

  it('explain mistakes in grades', () => {
    const bad = (decl: string, line = 'show a grade dusk') => compile(`image a = "a.png"\n${decl}\nlabel start:\n  ${line}\n`).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(bad('grade dusk: gamma 1 2')[0]).toMatch(/one number, or three/);
    expect(bad('grade dusk: tint #ff0000')[0]).toMatch(/'tint' needs a colour and how much/);
    expect(bad('grade dusk: sparkle')[0]).toMatch(/Unexpected 'sparkle'/);
    expect(bad('grade dusky: gray')[0]).toMatch(/No grade named 'dusk'|dusky/);
    expect(bad('grade dusk: gray', 'show a silhouette black')[0]).toMatch(/silhouette black/); // no colour after it: read as the image's name
    expect(bad('grade dusk: gray', 'animate a bright 2 over 1')[0]).toMatch(/can't be animated/);
  });

  it('wipe through a rule picture, and take the text off the picture', () => {
    const src = `image a = "a.png"
image rule_13 = "rules/RULE_13.png"

label start:
  show a
  with wipe rule_13 0.8
  textbox hide over 0.5
  wait 1
  show a
  with wipe "rules/RULE_02.png"
  textbox show
  "Back."
`;
    const p = parse(src);
    expect(p.diagnostics).toEqual([]);
    const body = p.program.labels[0]!.body;
    expect(body[1]).toEqual({ type: 'with', transition: 'wipe', rule: 'rule_13', duration: 0.8, loc: { line: 6 } });
    expect(body[2]).toMatchObject({ type: 'textbox', show: false, over: 0.5 });
    const printed = print(p.program);
    expect(printed).toContain('  with wipe rule_13 0.8\n  textbox hide over 0.5\n');
    expect(printed).toContain('  with wipe "rules/RULE_02.png"\n  textbox show\n');
    expect(print(parse(printed).program)).toBe(printed);
    const r = compile(src);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const withs = r.story!.code.filter((i) => i.op === 'with');
    expect(withs.map((w) => (w as { rule?: string }).rule)).toEqual(['rules/RULE_13.png', 'rules/RULE_02.png']);
    expect(r.story!.code.filter((i) => i.op === 'textbox')).toMatchObject([{ show: false, duration: 0.5 }, { show: true }]);
    const bad = (line: string) => compile(`image a = "a.png"\nlabel start:\n  ${line}\n`).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(bad('with wipe 0.8')[0]).toMatch(/needs a rule picture/);
    expect(bad('with wipe nothing')[0]).toMatch(/No image named 'nothing'/);
    expect(bad('show a with wipe rule')[0]).toMatch(/on its own line/);
    expect(bad('textbox away')[0]).toMatch(/textbox hide/);
  });

  it('leave scripts without layer properties as they were', () => {
    const r = compile('image mira smile = "m.png"\nlabel start:\n  show mira smile at 30% with dissolve\n  "Hi."\n');
    expect(shows(r.story!.code)[0]).toEqual(expect.objectContaining({ tag: 'mira', attrs: ['smile'], at: '30%', transition: 'dissolve' }));
    expect(shows(r.story!.code)[0]).not.toHaveProperty('props');
    expect(shows(r.story!.code)[0]).not.toHaveProperty('layer');
  });
});

import { describe, expect, it } from 'vitest';
import { animationFrames, easingCss, freeBox, layerStyle } from '../src/layers.ts';
import { curve } from '../src/grades.ts';
import { wipeAlpha } from '../src/wipe.ts';

const canvas: [number, number] = [1920, 1080];

describe('drawing free layers (D-062)', () => {
  it('places a picture so its anchor is at the point, sized from its pixels on the canvas', () => {
    expect(freeBox({ x: 50, y: 50 }, [960, 540], canvas)).toEqual({ left: 25, top: 25, width: 50, height: 50 });
    expect(freeBox({ x: 50, y: 100, anchor: [50, 100] }, [960, 540], canvas)).toEqual({ left: 25, top: 50, width: 50, height: 50 });
    const s = layerStyle({ x: 50, y: 50, zoom: [2, -1], rotate: 10, opacity: 0.5, depth: 3, blend: 'add' }, [960, 540], canvas);
    expect(s).toMatchObject({ left: '25%', top: '25%', width: '50%', height: '50%', scale: '2 -1', rotate: '10deg', opacity: '0.5', zIndex: '3', mixBlendMode: 'plus-lighter', transformOrigin: '50% 50%' });
  });

  it('leaves a picture that has not loaded unsized, and a character on its bottom line', () => {
    expect(layerStyle({ x: 50, y: 50 }, null, canvas).left).toBeUndefined();
    expect(layerStyle({ opacity: 0.4 }, [960, 540], canvas)).not.toHaveProperty('left');
  });

  it('turns eases into CSS timing', () => {
    expect(easingCss('linear')).toBe('linear');
    const css = easingCss('out-back');
    expect(css).toMatch(/^linear\(0 0%, .* 1 100%\)$/);
    expect(Math.max(...[...css.matchAll(/([\d.]+) [\d.]+%/g)].map((m) => Number(m[1])))).toBeGreaterThan(1); // overshoots
  });

  it('makes keyframes for an animation, every value spelled out, holding what a key leaves out', () => {
    const { frames, end } = animationFrames({ x: 50, y: 50, opacity: 1 }, {
      loop: false, duration: 2,
      keys: [{ t: 1, props: { opacity: 0 }, ease: 'in-quad' }, { t: 2, props: { x: 75, zoom: [2, 2] }, ease: 'linear' }],
    }, [960, 540], canvas);
    expect(frames).toHaveLength(3); // the start, then each key
    expect(frames[0]).toMatchObject({ offset: 0, left: '25%', top: '25%', opacity: '1', scale: '1 1', rotate: '0deg', transformOrigin: '50% 50%' });
    expect(frames[1]).toMatchObject({ offset: 0.5, left: '25%', opacity: '0' });
    expect(frames[1]!.easing).toMatch(/^linear\(/);
    expect(frames[2]).toMatchObject({ offset: 1, left: '50%', opacity: '0', scale: '2 2' });
    expect(end).toEqual({ x: 75, y: 50, opacity: 0, zoom: [2, 2] });
  });

  it('blurs, and draws a grade as a table on each channel', () => {
    expect(layerStyle({ blur: 0.5 }, null, canvas).filter).toBe('blur(0.5cqw)');
    expect(layerStyle({}, null, canvas).filter).toBe('');
    const neg = curve({ levels: [[255, 255, 255], [0, 0, 0]] }, 0, 1, 1);
    expect(neg[0]).toBe(1);
    expect(neg.at(-1)).toBe(0);
    expect(curve(undefined, 0, 1, 1)[64]).toBeCloseTo(0.5, 2);
  });

  it('wipes the old picture away where the rule is dark first', () => {
    expect(wipeAlpha(0, 0)).toBe(1);   // at the start the old picture is whole
    expect(wipeAlpha(255, 0)).toBe(1);
    expect(wipeAlpha(0, 1)).toBe(0);   // at the end it has gone
    expect(wipeAlpha(255, 1)).toBe(0);
    expect(wipeAlpha(30, 0.5)).toBeLessThan(wipeAlpha(220, 0.5)); // halfway: gone from the dark parts first
  });
});
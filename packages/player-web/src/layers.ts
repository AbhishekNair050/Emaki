/**
 * Drawing free layers (D-062): a layer is a `.sprite.free` box placed so its anchor sits at (x, y), sized from its
 * picture's pixels on the game's canvas, and turned and zoomed about that anchor. Each property is its own CSS
 * property (`left`, `top`, `scale`, `rotate`, `opacity`), so `animate` can move each one on its own clock.
 *
 * Characters without a point (`show mira at left`) keep their bottom-line placement; their zoom, rotation, opacity,
 * depth and blend still apply.
 */
import { ease, type Blend, type CompiledAnimation, type LayerProps } from '@emaki/format';

/**
 * CSS for each blend. CSS has no subtract: the layer adds (plus-lighter) between two inversions of everything behind it,
 * 1 - ((1 - b) + s) = b - s, kept at 0 or more (see invertsFor).
 */
export const BLEND_CSS: Record<Blend, string> = {
  normal: 'normal', add: 'plus-lighter', subtract: 'plus-lighter', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  darken: 'darken', lighten: 'lighten', dodge: 'color-dodge', burn: 'color-burn', 'hard-light': 'hard-light',
  'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion',
};

const easings = new Map<string, string>();
/** A CSS timing function for a named ease: `linear()` through points on the curve, which also overshoots for back and elastic. */
export function easingCss(name: string): string {
  if (name === 'linear') return 'linear';
  let css = easings.get(name);
  if (!css) {
    const n = /elastic|bounce/.test(name) ? 60 : 24;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) pts.push(`${round(ease(name, i / n))} ${round((i / n) * 100)}%`);
    css = `linear(${pts.join(', ')})`;
    easings.set(name, css);
  }
  return css;
}

const round = (v: number) => Math.round(v * 10000) / 10000;

/** Whether the layer is placed at a point (a free layer), rather than on the bottom line like a character. */
export const isFree = (p: LayerProps | undefined): boolean => p?.x !== undefined && p?.y !== undefined;

/** A free layer's box, in percent of the stage: its picture's size on the canvas, and its top left with the anchor at (x, y). */
export function freeBox(p: LayerProps, size: [number, number], canvas: [number, number]): { left: number; top: number; width: number; height: number } {
  const width = (size[0] / canvas[0]) * 100;
  const height = (size[1] / canvas[1]) * 100;
  const [ax, ay] = p.anchor ?? [50, 50];
  return { left: (p.x ?? 50) - (ax / 100) * width, top: (p.y ?? 50) - (ay / 100) * height, width, height };
}

/** The CSS a layer's properties come to. `size` is its first picture's natural size (null until it has loaded). */
export function layerStyle(p: LayerProps, size: [number, number] | null, canvas: [number, number]): Record<string, string> {
  const s: Record<string, string> = {};
  const [zx, zy] = p.zoom ?? [1, 1];
  s.scale = zx === 1 && zy === 1 ? '' : `${round(zx)} ${round(zy)}`;
  s.rotate = p.rotate ? `${round(p.rotate)}deg` : '';
  s.opacity = p.opacity === undefined || p.opacity === 1 ? '' : String(round(p.opacity));
  s.zIndex = p.depth ? String(p.depth) : '';
  s.mixBlendMode = p.blend && p.blend !== 'normal' ? BLEND_CSS[p.blend] : '';
  if (isFree(p)) {
    const [ax, ay] = p.anchor ?? [50, 50];
    s.transformOrigin = `${round(ax)}% ${round(ay)}%`;
    if (size) {
      const b = freeBox(p, size, canvas);
      s.left = `${round(b.left)}%`;
      s.top = `${round(b.top)}%`;
      s.width = `${round(b.width)}%`;
      s.height = `${round(b.height)}%`;
    }
  }
  return s;
}

/** The CSS properties each animatable layer property moves. */
const MOVES: Record<string, string[]> = { x: ['left'], y: ['top'], anchor: ['left', 'top', 'transform-origin'], zoom: ['scale'], rotate: ['rotate'], opacity: ['opacity'] };

/**
 * Put a layer's properties on its box. With `move`, the properties it names glide there over `ms` along `ease` (each
 * keeps its own transition, so a zoom and a fade started at different times both run to their ends).
 */
export function applyLayer(node: HTMLElement, p: LayerProps, size: [number, number] | null, canvas: [number, number], move?: { keys: string[]; ms: number; ease: string }): void {
  node.classList.toggle('free', isFree(p));
  node.dataset.props = JSON.stringify(p);
  const runs = transitions(node);
  if (move) {
    for (const k of move.keys) for (const css of MOVES[k] ?? []) {
      if (move.ms > 0) runs.set(css, `${css} ${Math.round(move.ms)}ms ${easingCss(move.ease)}`);
      else runs.delete(css);
    }
  } else runs.clear();
  node.style.transition = [...runs.values()].join(', ');
  const style = layerStyle(p, size, canvas);
  // a clipped layer sits in a box the size of the screen that shows only the clip; that box stacks and blends
  const box = clipBox(node, p);
  if (box) {
    box.style.zIndex = style.zIndex!;
    box.style.mixBlendMode = style.mixBlendMode!;
    style.zIndex = '';
    style.mixBlendMode = '';
  }
  for (const [k, v] of Object.entries(style)) (node.style as unknown as Record<string, string>)[k] = v;
  invertsFor(node);
  if (!move) {
    // nothing glides into place: drop the transitions once this frame has settled
    node.dataset.transitions = '';
  } else node.dataset.transitions = JSON.stringify([...runs]);
}

function transitions(node: HTMLElement): Map<string, string> {
  try { return new Map(JSON.parse(node.dataset.transitions || '[]') as Array<[string, string]>); } catch { return new Map(); }
}

/** The layer's properties, as last put on it. */
export function layerProps(node: HTMLElement): LayerProps {
  try { return JSON.parse(node.dataset.props || '{}') as LayerProps; } catch { return {}; }
}

/** The moving part of a layer's CSS with every value spelled out, as a keyframe needs it. */
function keyStyle(p: LayerProps, size: [number, number], canvas: [number, number]): Keyframe {
  const [zx, zy] = p.zoom ?? [1, 1];
  const k: Keyframe = { scale: `${round(zx)} ${round(zy)}`, rotate: `${round(p.rotate ?? 0)}deg`, opacity: String(round(p.opacity ?? 1)) };
  if (isFree(p)) {
    const b = freeBox(p, size, canvas);
    const [ax, ay] = p.anchor ?? [50, 50];
    k.left = `${round(b.left)}%`;
    k.top = `${round(b.top)}%`;
    k.transformOrigin = `${round(ax)}% ${round(ay)}%`;
  }
  return k;
}

/**
 * Keyframes for an `animation` (D-062) on a layer that starts at `start`: each key's properties over the ones before
 * it, its ease toward the next key. Returns the keyframes and where the layer ends (its last key's values).
 */
export function animationFrames(start: LayerProps, anim: CompiledAnimation, size: [number, number], canvas: [number, number]): { frames: Keyframe[]; end: LayerProps } {
  const frames: Keyframe[] = [];
  const total = anim.duration || 1;
  let p: LayerProps = { ...start };
  if (!anim.keys.length || anim.keys[0]!.t > 0) frames.push({ ...keyStyle(p, size, canvas), offset: 0, easing: 'linear' });
  for (const key of anim.keys) {
    p = { ...p, ...key.props };
    frames.push({ ...keyStyle(p, size, canvas), offset: Math.min(1, key.t / total), easing: easingCss(key.ease) });
  }
  return { frames, end: p };
}
/** The box a layer is in when it is clipped (made, or taken away, as its clip comes and goes), or null. */
function clipBox(node: HTMLElement, p: LayerProps): HTMLElement | null {
  let box = node.parentElement?.classList.contains('clip') ? node.parentElement : null;
  if (!p.clip) {
    if (box) { box.replaceWith(node); }
    return null;
  }
  if (!box) {
    box = document.createElement('div');
    box.className = 'clip';
    if (node.parentElement) node.replaceWith(box);
    box.append(node);
  }
  const [x, y, w, h] = p.clip;
  const [fx, fy] = p.feather ?? [0, 0];
  const across = `linear-gradient(to right, transparent ${round(x)}%, #000 ${round(x + Math.min(fx, w / 2))}%, #000 ${round(x + w - Math.min(fx, w / 2))}%, transparent ${round(x + w)}%)`;
  const down = `linear-gradient(to bottom, transparent ${round(y)}%, #000 ${round(y + Math.min(fy, h / 2))}%, #000 ${round(y + h - Math.min(fy, h / 2))}%, transparent ${round(y + h)}%)`;
  box.style.maskImage = `${across}, ${down}`;
  box.style.maskComposite = 'intersect';
  return box;
}

/** What to put on the stage (or take off) for a layer: its clip box when it has one. */
export const outerOf = (node: HTMLElement): HTMLElement => (node.parentElement?.classList.contains('clip') ? node.parentElement : node);
/**
 * A subtracting layer's two inversions (see BLEND_CSS): screen-sized boxes that invert what is behind them, one just
 * under the layer and one just over it, at its depth. Where the layer has nothing, the two cancel out. Made, moved or
 * taken away to match the layer's blend; call again once a new layer is on the stage.
 */
export function invertsFor(node: HTMLElement): void {
  const outer = outerOf(node);
  const tag = node.dataset.tag ?? '';
  const parent = outer.parentElement;
  const mine = parent ? [...parent.children].filter((e) => e.classList.contains('invert') && (e as HTMLElement).dataset.for === tag) as HTMLElement[] : [];
  if (layerProps(node).blend !== 'subtract' || !parent) { mine.forEach((e) => e.remove()); return; }
  const make = () => { const d = document.createElement('div'); d.className = 'invert'; d.dataset.for = tag; return d; };
  const [under, over] = mine.length === 2 ? mine : (mine.forEach((e) => e.remove()), [make(), make()]);
  if (outer.previousElementSibling !== under) outer.before(under!);
  if (outer.nextElementSibling !== over) outer.after(over!);
  under!.style.zIndex = over!.style.zIndex = outer.style.zIndex;
}

/** A layer and what it brings with it on the stage (its subtract's inversions), to take off together. */
export function removeLayer(node: HTMLElement): void {
  const outer = outerOf(node);
  const tag = node.dataset.tag ?? '';
  for (const e of [...(outer.parentElement?.children ?? [])]) if (e.classList.contains('invert') && (e as HTMLElement).dataset.for === tag) e.remove();
  outer.remove();
}

/**
 * Free layers (D-062): where a picture sits and how it is drawn.
 *
 * `show street as far at 960 540 anchor 50% 47% zoom 0.65 rotate -17.3 opacity 0.8 depth 26 blend add`
 * `animate far zoom 0.7 opacity 1 over 3 ease in-out-sine`
 *
 * Positions are percentages of the screen (`50%`) or pixels on the game's canvas (a plain number); the compiler
 * turns pixels into percentages, so runtimes only see percentages.
 */

/** A coordinate as written: percent of the screen, or canvas pixels. */
export interface Coord { v: number; unit: '%' | 'px' }

export const BLENDS = [
  'normal', 'add', 'subtract', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'dodge', 'burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
] as const;
export type Blend = (typeof BLENDS)[number];

/** Layer properties as the script writes them. */
export interface LayerPropsSource {
  x?: Coord;
  y?: Coord;
  /** The image's own point that goes at (x, y): percent of its width and height. */
  anchor?: [number, number];
  /** Horizontal and vertical zoom (1 = the image's own size on the canvas; negative mirrors). */
  zoom?: [number, number];
  /** Degrees, clockwise. */
  rotate?: number;
  /** 0 to 1. */
  opacity?: number;
  /** Higher is in front; equal depths stack in the order shown. */
  depth?: number;
  blend?: Blend;
  /** Only the part inside this rectangle of the screen shows: x, y, width, height. */
  clip?: [Coord, Coord, Coord, Coord];
  /** How far in from the clip's sides the picture fades out. */
  feather?: Coord;
}

/** Layer properties as runtimes see them: positions in percent of the screen. */
export interface LayerProps {
  x?: number;
  y?: number;
  anchor?: [number, number];
  zoom?: [number, number];
  rotate?: number;
  opacity?: number;
  depth?: number;
  blend?: Blend;
  /** [x, y, width, height] in percent of the screen. */
  clip?: [number, number, number, number];
  /** [across, down] in percent of the screen's width and height. */
  feather?: [number, number];
}

/** The properties `animate` can move (a blend or a depth can't be tweened). */
export const ANIMATABLE = ['x', 'y', 'anchor', 'zoom', 'rotate', 'opacity'] as const;

// ---------------------------------------------------------------- easing

const FAMILIES = ['quad', 'cubic', 'quart', 'quint', 'sine', 'circ', 'expo', 'elastic', 'back', 'bounce'] as const;
const DIRECTIONS = ['in', 'out', 'in-out', 'out-in'] as const;
/** `linear`, and in / out / in-out / out-in of Penner's ten curves: `in-out-sine`, `out-back`... */
export const EASES: readonly string[] = ['linear', ...FAMILIES.flatMap((f) => DIRECTIONS.map((d) => `${d}-${f}`))];

const bounceOut = (x: number): number => {
  if (x < 1 / 2.75) return 7.5625 * x * x;
  if (x < 2 / 2.75) return 7.5625 * (x -= 1.5 / 2.75) * x + 0.75;
  if (x < 2.5 / 2.75) return 7.5625 * (x -= 2.25 / 2.75) * x + 0.9375;
  return 7.5625 * (x -= 2.625 / 2.75) * x + 0.984375;
};
function easeIn(family: string, x: number): number {
  switch (family) {
    case 'quad': return x * x;
    case 'cubic': return x ** 3;
    case 'quart': return x ** 4;
    case 'quint': return x ** 5;
    case 'sine': return 1 - Math.cos((x * Math.PI) / 2);
    case 'circ': return 1 - Math.sqrt(Math.max(0, 1 - x * x));
    case 'expo': return x === 0 ? 0 : 2 ** (10 * (x - 1));
    case 'elastic': return x === 0 || x === 1 ? x : -(2 ** (10 * (x - 1))) * Math.sin(((x - 1.075) * 2 * Math.PI) / 0.3);
    case 'back': return x * x * (2.70158 * x - 1.70158);
    case 'bounce': return 1 - bounceOut(1 - x);
    default: return x;
  }
}

/** Progress (0 to 1, possibly overshooting for back and elastic) at time t (0 to 1) along a named ease. */
export function ease(name: string, t: number): number {
  t = Math.max(0, Math.min(1, t));
  if (t === 0 || t === 1 || name === 'linear') return t;
  const m = /^(in|out|in-out|out-in)-(\w+)$/.exec(name);
  if (!m) return t;
  const [, dir, family] = m as unknown as [string, string, string];
  const i = (x: number) => easeIn(family, x);
  const o = (x: number) => 1 - i(1 - x);
  if (dir === 'in') return i(t);
  if (dir === 'out') return o(t);
  if (dir === 'in-out') return t < 0.5 ? i(t * 2) / 2 : 0.5 + o(t * 2 - 1) / 2;
  return t < 0.5 ? o(t * 2) / 2 : 0.5 + i(t * 2 - 1) / 2;
}

// ---------------------------------------------------------------- parsing

const NUM = /^-?\d+(\.\d+)?$/;
const PCT = /^(-?\d+(\.\d+)?)%$/;

function coord(w: string | undefined): Coord | null {
  if (!w) return null;
  const p = PCT.exec(w);
  if (p) return { v: Number(p[1]), unit: '%' };
  return NUM.test(w) ? { v: Number(w), unit: 'px' } : null;
}

/**
 * Reads layer properties from words (`at 960 540 zoom 0.5 rotate 10 ...`). `animate` is true for `animate`, which
 * takes only what can move. Returns the properties, or an error message for the writer. A single position after
 * `at` (`at left`, `at 30%`) is a character's place on the bottom line, not a point: it is returned as `at`.
 */
export function parseLayerProps(words: string[], animate = false): { props: LayerPropsSource; at?: string } | { error: string } {
  const props: LayerPropsSource = {};
  let at: string | undefined;
  const num = (w: string | undefined, what: string, ok?: (n: number) => boolean, range?: string): number | string => {
    if (!w || !NUM.test(w)) return `'${what}' needs a number`;
    const n = Number(w);
    if (ok && !ok(n)) return `${w} is out of range for '${what}'${range ? ` (${range})` : ''}`;
    return n;
  };
  for (let i = 0; i < words.length;) {
    const k = words[i++]!;
    switch (k) {
      case 'at': {
        const x = words[i], y = words[i + 1];
        const cx = coord(x), cy = coord(y);
        if (cx && cy) { props.x = cx; props.y = cy; i += 2; break; }
        if (animate) return { error: `'at' needs a point: 'at 50% 40%' or, on the canvas, 'at 960 540'` };
        if (!x) return { error: `'at' needs a position (left, center, right, a percentage like 30%, or a point like 50% 40%)` };
        at = x;
        i++;
        break;
      }
      case 'x': case 'y': {
        const c = coord(words[i++]);
        if (!c) return { error: `'${k}' needs a percentage of the screen (40%) or canvas pixels (960)` };
        props[k] = c;
        break;
      }
      case 'anchor': {
        const ax = PCT.exec(words[i] ?? ''), ay = PCT.exec(words[i + 1] ?? '');
        if (!ax || !ay) return { error: `'anchor' needs two percentages of the image, across then down: 'anchor 50% 100%'` };
        props.anchor = [Number(ax[1]), Number(ay[1])];
        i += 2;
        break;
      }
      case 'zoom': {
        const zx = num(words[i++], 'zoom', (n) => n >= -100 && n <= 100, '-100 to 100; negative mirrors');
        if (typeof zx === 'string') return { error: zx };
        let zy = zx;
        if (words[i] !== undefined && NUM.test(words[i]!)) { // a second number: down
          const v = num(words[i++], 'zoom', (n) => n >= -100 && n <= 100, '-100 to 100; negative mirrors');
          if (typeof v === 'string') return { error: v };
          zy = v;
        }
        props.zoom = [zx, zy];
        break;
      }
      case 'rotate': {
        const r = num(words[i++], 'rotate');
        if (typeof r === 'string') return { error: r + ' of degrees' };
        props.rotate = r;
        break;
      }
      case 'opacity': {
        const o = num(words[i++], 'opacity', (n) => n >= 0 && n <= 1, '0 is invisible, 1 solid');
        if (typeof o === 'string') return { error: o };
        props.opacity = o;
        break;
      }
      case 'depth': {
        if (animate) return { error: `'depth' can't be animated; set it with 'show'` };
        const d = words[i++];
        if (!d || !/^-?\d+$/.test(d)) return { error: `'depth' needs a whole number (higher is in front)` };
        props.depth = Number(d);
        break;
      }
      case 'blend': {
        if (animate) return { error: `'blend' can't be animated; set it with 'show'` };
        const b = words[i++];
        if (!b || !(BLENDS as readonly string[]).includes(b)) return { error: `Unknown blend '${b ?? ''}' (use ${BLENDS.join(', ')})` };
        props.blend = b as Blend;
        break;
      }
      case 'clip': {
        if (animate) return { error: `'clip' can't be animated; set it with 'show'` };
        const c = [0, 1, 2, 3].map((j) => coord(words[i + j]));
        if (c.some((v) => !v)) return { error: `'clip' needs a rectangle: x, y, width and height (percentages of the screen, or canvas pixels)` };
        props.clip = c as [Coord, Coord, Coord, Coord];
        i += 4;
        break;
      }
      case 'feather': {
        if (animate) return { error: `'feather' can't be animated; set it with 'show'` };
        const c = coord(words[i++]);
        if (!c || c.v < 0) return { error: `'feather' needs a width: canvas pixels (32) or a percentage of the screen` };
        props.feather = c;
        break;
      }
      default:
        return { error: `Unexpected '${k}' (layer properties: at, anchor, zoom, rotate, opacity, depth, blend, clip, feather)` };
    }
  }
  return at !== undefined ? { props, at } : { props };
}

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);
const coordText = (c: Coord) => (c.unit === '%' ? `${fmt(c.v)}%` : fmt(c.v));

/** The words for layer properties, in a fixed order (the printer's canonical form). */
export function printLayerProps(p: LayerPropsSource): string[] {
  const out: string[] = [];
  if (p.x && p.y) out.push('at', coordText(p.x), coordText(p.y));
  else {
    if (p.x) out.push('x', coordText(p.x));
    if (p.y) out.push('y', coordText(p.y));
  }
  if (p.anchor) out.push('anchor', `${fmt(p.anchor[0])}%`, `${fmt(p.anchor[1])}%`);
  if (p.zoom) out.push('zoom', fmt(p.zoom[0]), ...(p.zoom[1] !== p.zoom[0] ? [fmt(p.zoom[1])] : []));
  if (p.rotate !== undefined) out.push('rotate', fmt(p.rotate));
  if (p.opacity !== undefined) out.push('opacity', fmt(p.opacity));
  if (p.depth !== undefined) out.push('depth', String(p.depth));
  if (p.blend) out.push('blend', p.blend);
  if (p.clip) out.push('clip', ...p.clip.map(coordText));
  if (p.feather) out.push('feather', coordText(p.feather));
  return out;
}

/** Positions in percent of the screen, given the canvas size (1920 x 1080 when the game declares none). */
export function compileLayerProps(p: LayerPropsSource, canvas: [number, number] | null): LayerProps {
  const [w, h] = canvas ?? [1920, 1080];
  const pct = (c: Coord, size: number) => (c.unit === '%' ? c.v : (c.v / size) * 100);
  const out: LayerProps = {};
  if (p.x) out.x = pct(p.x, w);
  if (p.y) out.y = pct(p.y, h);
  if (p.anchor) out.anchor = [...p.anchor];
  if (p.zoom) out.zoom = [...p.zoom];
  if (p.rotate !== undefined) out.rotate = p.rotate;
  if (p.opacity !== undefined) out.opacity = p.opacity;
  if (p.depth !== undefined) out.depth = p.depth;
  if (p.blend) out.blend = p.blend;
  if (p.clip) out.clip = [pct(p.clip[0], w), pct(p.clip[1], h), pct(p.clip[2], w), pct(p.clip[3], h)];
  if (p.feather) out.feather = [pct(p.feather, w), pct(p.feather, h)];
  return out;
}

export const hasProps = (p: object | undefined): boolean => !!p && Object.keys(p).length > 0;

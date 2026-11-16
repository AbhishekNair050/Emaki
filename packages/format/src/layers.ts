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
  /** A declared colour grade (`grade dusk`), or `none`. */
  grade?: string;
  /** The picture's shape in one colour (`#000000`), or `none`. */
  silhouette?: string;
  /** Brightness: 1 is unchanged; each 0.1 adds a tenth of white (0 to 2). */
  bright?: number;
  /** Contrast: 1 is unchanged; lower is flatter, higher is harsher (0 to 3). */
  contrast?: number;
  /** Blur radius: canvas pixels, or a percentage of the screen's width. */
  blur?: Coord;
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
  grade?: string;
  silhouette?: string;
  bright?: number;
  contrast?: number;
  /** In percent of the screen's width. */
  blur?: number;
}

/** The properties `animate` can move (a blend or a depth can't be tweened). */
export const ANIMATABLE = ['x', 'y', 'anchor', 'zoom', 'rotate', 'opacity'] as const;

// ---------------------------------------------------------------- colour grades

/** How a grade's tint lies on the picture. */
export const TINT_MODES = ['normal', 'add', 'plus', 'multiply', 'screen', 'overlay', 'dodge'] as const;
export type TintMode = (typeof TINT_MODES)[number];
export interface GradeTint { color: [number, number, number]; amount: number; mode: TintMode }
/**
 * `grade dusk: gray gamma 0.94 0.78 0.57 levels #000010 #546b90 tint #ff6500 14% overlay` (D-062). Applied in this
 * order whatever the order written: grey, then gamma and levels, then each tint. Colours are 0-255.
 */
export interface Grade {
  gray?: true;
  gamma?: [number, number, number];
  /** Where black and white go: [low, high], each [r, g, b]. */
  levels?: [[number, number, number], [number, number, number]];
  tints?: GradeTint[];
}

const HEX = /^#([0-9a-fA-F]{6})$/;
const hexRgb = (w: string): [number, number, number] | null => {
  const m = HEX.exec(w);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbHex = (c: readonly number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Reads a grade's words; returns it, or an error message for the writer. */
export function parseGrade(words: string[]): Grade | { error: string } {
  const g: Grade = {};
  for (let i = 0; i < words.length;) {
    const k = words[i++]!;
    switch (k) {
      case 'gray': case 'grey': g.gray = true; break;
      case 'gamma': {
        const v: number[] = [];
        while (v.length < 3 && NUM.test(words[i] ?? '')) v.push(Number(words[i++]));
        if (v.length !== 1 && v.length !== 3) return { error: `'gamma' needs one number, or three (red, green, blue): 'gamma 0.9 0.8 0.6'` };
        if (v.some((n) => n < 0 || n > 10)) return { error: `gamma goes from 0 to 10 (1 is unchanged)` };
        g.gamma = v.length === 1 ? [v[0]!, v[0]!, v[0]!] : [v[0]!, v[1]!, v[2]!];
        break;
      }
      case 'levels': {
        const lo = hexRgb(words[i] ?? ''), hi = hexRgb(words[i + 1] ?? '');
        if (!lo || !hi) return { error: `'levels' needs two colours, where black goes then where white goes: 'levels #000010 #546b90'` };
        g.levels = [lo, hi];
        i += 2;
        break;
      }
      case 'tint': {
        const c = hexRgb(words[i] ?? ''), a = PCT.exec(words[i + 1] ?? '');
        if (!c || !a) return { error: `'tint' needs a colour and how much: 'tint #ff6500 14%', then a mode if not normal (${TINT_MODES.join(', ')})` };
        i += 2;
        let mode: TintMode = 'normal';
        if ((TINT_MODES as readonly string[]).includes(words[i] ?? '')) mode = words[i++] as TintMode;
        (g.tints ??= []).push({ color: c, amount: Math.max(0, Math.min(100, Number(a[1]))) / 100, mode });
        break;
      }
      default:
        return { error: `Unexpected '${k}' in a grade (gray, gamma, levels, tint)` };
    }
  }
  if (!g.gray && !g.gamma && !g.levels && !g.tints) return { error: `A grade needs something to do: gray, gamma, levels or tint` };
  return g;
}

/** A grade's words, in the canonical order. */
export function printGrade(g: Grade): string[] {
  const out: string[] = [];
  if (g.gray) out.push('gray');
  if (g.gamma) out.push('gamma', ...(g.gamma[0] === g.gamma[1] && g.gamma[1] === g.gamma[2] ? [fmt(g.gamma[0])] : g.gamma.map(fmt)));
  if (g.levels) out.push('levels', rgbHex(g.levels[0]), rgbHex(g.levels[1]));
  for (const t of g.tints ?? []) out.push('tint', rgbHex(t.color), `${fmt(t.amount * 100)}%`, ...(t.mode === 'normal' ? [] : [t.mode]));
  return out;
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, v));

/** One tint over a channel value (0-255). */
function tintValue(v: number, c: number, a: number, mode: TintMode): number {
  switch (mode) {
    case 'normal': return v + (c - v) * a;
    case 'add': return Math.min(v + c * a, 255);
    case 'plus': return v + (Math.min(v + c, 255) - v) * a;
    case 'multiply': return v + ((c * v) / 255 - v) * a;
    case 'screen': return v + (255 - ((255 - c) * (255 - v)) / 255 - v) * a;
    case 'overlay': {
      const cn = c / 255;
      const t = v < 128 ? v * 2 * cn : 255 - (255 - v) * (2 - 2 * cn);
      return v + (t - v) * a;
    }
    case 'dodge': return v <= 3 ? 0 : Math.min((v * 255) / Math.max(255 - c * a, 0.001), 255);
  }
}

/**
 * What a grade, a brightness and a contrast do to one channel (0 red, 1 green, 2 blue) of a value 0-255, after the
 * grade's grey (the one step that mixes channels). Runtimes draw from this curve.
 */
export function gradeChannel(g: Grade | undefined, channel: 0 | 1 | 2, v: number, bright = 1, contrast = 1): number {
  if (g?.gamma || g?.levels) {
    const gm = g.gamma?.[channel] ?? 1;
    if (gm <= 0) v = 0;
    else if (gm !== 1) v = ((v / 255) ** (1 / gm)) * 255;
    const lo = g.levels?.[0][channel] ?? 0, hi = g.levels?.[1][channel] ?? 255;
    v = lo + ((hi - lo) * v) / 255;
  }
  for (const t of g?.tints ?? []) v = tintValue(v, t.color[channel], t.amount, t.mode);
  v = clamp255(v + 255 * (bright - 1));
  const k = contrast <= 1 ? (200 * contrast + 55) / 255 : 127.5 / Math.max(0.5, 127.5 - (100 * contrast - 100));
  return clamp255((v - 127.5) * k + 127.5);
}

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
      case 'grade': {
        if (animate) return { error: `'grade' can't be animated; set it with 'show'` };
        const g = words[i++];
        if (!g || !/^[A-Za-z_]\w*$/.test(g)) return { error: `'grade' needs a grade's name (declared with 'grade name: ...'), or none` };
        props.grade = g;
        break;
      }
      case 'silhouette': {
        if (animate) return { error: `'silhouette' can't be animated; set it with 'show'` };
        const c = words[i++];
        if (!c || (c !== 'none' && !HEX.test(c))) return { error: `'silhouette' needs a colour like #000000, or none` };
        props.silhouette = c.toLowerCase();
        break;
      }
      case 'bright': case 'contrast': {
        if (animate) return { error: `'${k}' can't be animated; set it with 'show'` };
        const max = k === 'bright' ? 2 : 3;
        const v = num(words[i++], k, (n) => n >= 0 && n <= max, `0 to ${max}; 1 is unchanged`);
        if (typeof v === 'string') return { error: v };
        props[k] = v;
        break;
      }
      case 'blur': {
        if (animate) return { error: `'blur' can't be animated; set it with 'show'` };
        const c = coord(words[i++]);
        if (!c || c.v < 0) return { error: `'blur' needs a radius: canvas pixels (8) or a percentage of the screen's width` };
        props.blur = c;
        break;
      }
      default:
        return { error: `Unexpected '${k}' (layer properties: at, anchor, zoom, rotate, opacity, depth, blend, clip, feather, grade, silhouette, bright, contrast, blur)` };
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
  if (p.grade) out.push('grade', p.grade);
  if (p.silhouette) out.push('silhouette', p.silhouette);
  if (p.bright !== undefined) out.push('bright', fmt(p.bright));
  if (p.contrast !== undefined) out.push('contrast', fmt(p.contrast));
  if (p.blur) out.push('blur', coordText(p.blur));
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
  if (p.grade) out.grade = p.grade;
  if (p.silhouette) out.silhouette = p.silhouette;
  if (p.bright !== undefined) out.bright = p.bright;
  if (p.contrast !== undefined) out.contrast = p.contrast;
  if (p.blur) out.blur = pct(p.blur, w);
  return out;
}

export const hasProps = (p: object | undefined): boolean => !!p && Object.keys(p).length > 0;

/**
 * Colour on layers (D-062): a declared grade, a silhouette, brightness and contrast become one SVG filter per
 * combination (made once, kept in a hidden <svg> on the page), and blur a CSS blur. A grade is a curve on each channel
 * after an optional grey (gradeChannel in @emaki/format), so `feComponentTransfer` tables draw it as written.
 */
import { gradeChannel, type Grade, type LayerProps } from '@emaki/format';

const NS = 'http://www.w3.org/2000/svg';
/** Points on each channel's curve; the filter joins them with straight lines. */
const SAMPLES = 129;

let grades: Record<string, Grade> = {};
let defs: SVGSVGElement | null = null;
const made = new Map<string, string>();

/** The story's grades, for the layers drawn from now on. */
export function useGrades(table: Record<string, Grade> | undefined): void {
  grades = table ?? {};
  made.clear();
  defs?.replaceChildren();
}

const round = (v: number) => Math.round(v * 10000) / 10000;

/** The CSS `filter` for a layer's colour properties ('' for none). */
export function layerFilter(p: LayerProps): string {
  const parts: string[] = [];
  const grade = p.grade && p.grade !== 'none' ? p.grade : undefined;
  const sil = p.silhouette && p.silhouette !== 'none' ? p.silhouette : undefined;
  const bright = p.bright ?? 1, contrast = p.contrast ?? 1;
  if ((grade && grades[grade]) || sil || bright !== 1 || contrast !== 1) {
    const id = filterId(grade, sil, bright, contrast);
    if (id) parts.push(`url(#${id})`);
  }
  if (p.blur) parts.push(`blur(${round(p.blur)}cqw)`);
  return parts.join(' ');
}

/** The filter for one combination, made the first time it is asked for (null without a document). */
function filterId(grade: string | undefined, sil: string | undefined, bright: number, contrast: number): string | null {
  const key = JSON.stringify([grade ?? null, sil ?? null, bright, contrast]);
  const known = made.get(key);
  if (known) return known;
  if (typeof document === 'undefined') return null;
  if (!defs || !defs.isConnected) {
    defs = document.createElementNS(NS, 'svg');
    defs.setAttribute('aria-hidden', 'true');
    defs.setAttribute('width', '0');
    defs.setAttribute('height', '0');
    defs.style.position = 'absolute';
    document.body.append(defs);
  }
  const id = `emaki-grade-${made.size}`;
  defs.append(buildFilter(id, grade ? grades[grade] : undefined, sil, bright, contrast));
  made.set(key, id);
  return id;
}

/** The filter's steps: the silhouette's colour or the grade's grey, then the curves. */
export function buildFilter(id: string, g: Grade | undefined, sil: string | undefined, bright: number, contrast: number): SVGFilterElement {
  const f = document.createElementNS(NS, 'filter');
  f.id = id;
  f.setAttribute('color-interpolation-filters', 'sRGB');
  for (const [k, v] of Object.entries({ x: '0', y: '0', width: '1', height: '1', filterUnits: 'objectBoundingBox' })) f.setAttribute(k, v);
  const matrix = (values: string) => {
    const m = document.createElementNS(NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', values);
    f.append(m);
  };
  if (sil) {
    const n = parseInt(sil.slice(1), 16);
    const [r, gr, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => round(c / 255));
    matrix(`0 0 0 0 ${r}  0 0 0 0 ${gr}  0 0 0 0 ${b}  0 0 0 1 0`);
  } else if (g?.gray) {
    const row = `${54 / 256} ${183 / 256} ${19 / 256} 0 0`;
    matrix(`${row}  ${row}  ${row}  0 0 0 1 0`);
  }
  const curves = document.createElementNS(NS, 'feComponentTransfer');
  (['feFuncR', 'feFuncG', 'feFuncB'] as const).forEach((tag, ch) => {
    const fn = document.createElementNS(NS, tag);
    fn.setAttribute('type', 'table');
    fn.setAttribute('tableValues', curve(g, ch as 0 | 1 | 2, bright, contrast).join(' '));
    curves.append(fn);
  });
  f.append(curves);
  return f;
}

/** A channel's curve as table values (0 to 1). */
export function curve(g: Grade | undefined, ch: 0 | 1 | 2, bright: number, contrast: number): number[] {
  return Array.from({ length: SAMPLES }, (_, i) => round(gradeChannel(g, ch, (i / (SAMPLES - 1)) * 255, bright, contrast) / 255));
}

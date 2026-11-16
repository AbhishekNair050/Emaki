/**
 * Wipes through a rule picture (D-062): the old picture goes first where the rule is dark and last where it is light,
 * with a soft edge. The masks for each step are made from the rule once (at a low size; the browser stretches them),
 * then the old picture's `mask-image` steps through them.
 *
 * The edge is the original engine's: the old picture's alpha at progress k is smoothstep((r - lo) / s), r the rule's
 * value 0-255, s = 128 and lo = (255 + 2s) k - 1.5s.
 */

/** Steps in a wipe; enough that the soft edge hides them. */
export const WIPE_STEPS = 32;
const W = 480, H = 270;
const SOFT = 128;

/** The old picture's alpha (0 to 1) where the rule is `r` (0-255), `k` (0 to 1) of the way through. */
export function wipeAlpha(r: number, k: number): number {
  const lo = (255 + 2 * SOFT) * k - 1.5 * SOFT;
  const t = Math.max(0, Math.min(1, (r - lo) / SOFT));
  return t * t * (3 - 2 * t);
}

const made = new Map<string, Promise<string[] | null>>();

/** The masks for a rule picture, WIPE_STEPS + 1 of them, ready to draw (null when it can't be read). */
export function wipeMasks(url: string): Promise<string[] | null> {
  let p = made.get(url);
  if (!p) {
    p = build(url).catch(() => null);
    made.set(url, p);
  }
  return p;
}

async function build(url: string): Promise<string[] | null> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  const rule = ctx.getImageData(0, 0, W, H).data;
  const out: string[] = [];
  for (let s = 0; s <= WIPE_STEPS; s++) {
    const k = s / WIPE_STEPS;
    const mask = ctx.createImageData(W, H);
    for (let i = 0; i < rule.length; i += 4) mask.data[i + 3] = Math.round(wipeAlpha(rule[i]!, k) * 255);
    ctx.putImageData(mask, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r));
    if (!blob) return null;
    out.push(URL.createObjectURL(blob));
  }
  // decoded now, so the first frames of the wipe don't wait on them
  await Promise.all(out.map((u) => { const i = new Image(); i.src = u; return i.decode().catch(() => undefined); }));
  return out;
}

/** Wipe `node` away over `ms`, through the masks. */
export function runWipe(node: HTMLElement, masks: string[], ms: number): Promise<void> {
  node.style.maskSize = '100% 100%';
  node.style.maskRepeat = 'no-repeat';
  return new Promise((done) => {
    const start = performance.now();
    let shown = -1;
    const frame = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const step = Math.round(k * WIPE_STEPS);
      if (step !== shown) { node.style.maskImage = `url("${masks[step]}")`; shown = step; }
      if (k < 1) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });
}

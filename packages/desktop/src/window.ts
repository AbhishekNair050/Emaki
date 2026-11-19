/**
 * The desktop window's shape follows the game's (header `aspect:`, 16:9 unless
 * set), so a 4:3 game opens without black bars at the sides. Both shells use
 * these sizes, in display-independent pixels for the inside of the window.
 */
export interface WindowShape {
  /** The opening size: the largest of the game's shape that fits 1280×720 (960×720 at 4:3). */
  width: number;
  height: number;
  /** The smallest size: the largest of the game's shape that fits 480×270. */
  minWidth: number;
  minHeight: number;
  /** width / height, saved with the window's size: a size saved for another shape isn't reused. */
  aspect: number;
}

export function windowShape(aspect: number = 16 / 9): WindowShape {
  const fit = (w: number, h: number): [number, number] =>
    aspect >= w / h ? [w, Math.round(w / aspect)] : [Math.round(h * aspect), h];
  const [width, height] = fit(1280, 720);
  const [minWidth, minHeight] = fit(480, 270);
  return { width, height, minWidth, minHeight, aspect };
}

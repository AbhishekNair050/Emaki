/**
 * Pictures an export made smaller (`shrink` in export.json, see packages/cli/src/compress.ts) are listed in its
 * game.json `sizes` with the size they had. Where the player sizes a picture from its pixels (free layers, screen
 * pictures), it uses that size, so a smaller file is drawn just as big.
 */
let sizes: Readonly<Record<string, readonly [number, number]>> = {};

export function setPictureSizes(map: Readonly<Record<string, readonly [number, number]>>): void { sizes = map; }

/** A loaded picture's size as drawn: its own, or the size it had before the export made it smaller. */
export function pictureSize(img: HTMLImageElement): [number, number] {
  const src = img.getAttribute('src') ?? '';
  const path = src.startsWith('./') ? src.slice(2) : src;
  const known = Object.hasOwn(sizes, path) ? sizes[path] : undefined;
  return known ? [known[0], known[1]] : [img.naturalWidth, img.naturalHeight];
}

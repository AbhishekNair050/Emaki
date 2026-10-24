/**
 * Windows wants the executable's icon as .ico. Since Windows Vista an .ico
 * may simply contain a PNG, so wrapping the game's icon.png is enough: no
 * image library needed.
 */
export function pngToIco(png: Uint8Array): Uint8Array {
  if (png.length < 24 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) {
    throw new Error('The icon must be a PNG file.');
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const out = new Uint8Array(6 + 16 + png.length);
  const d = new DataView(out.buffer);
  d.setUint16(0, 0, true); // reserved
  d.setUint16(2, 1, true); // type: icon
  d.setUint16(4, 1, true); // one image
  out[6] = width >= 256 ? 0 : width; // 0 means 256 or more
  out[7] = height >= 256 ? 0 : height;
  out[8] = 0; // no palette
  out[9] = 0;
  d.setUint16(10, 1, true); // colour planes
  d.setUint16(12, 32, true); // bits per pixel
  d.setUint32(14, png.length, true);
  d.setUint32(18, 22, true); // image data starts after this 22-byte header
  out.set(png, 22);
  return out;
}

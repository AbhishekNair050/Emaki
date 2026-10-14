/**
 * Keeps images the story will need soon loaded and decoded, so a scene change
 * shows the new picture straight away instead of fading in an empty frame.
 */

/** Decoded images kept around; older ones are dropped first. */
const MAX_KEPT = 48;

interface Entry {
  img: HTMLImageElement;
  ready: Promise<void>;
}

export class ImagePreloader {
  private readonly kept = new Map<string, Entry>();

  /** Start loading these URLs (nearest-needed first) if they aren't already. */
  want(urls: Iterable<string>): void {
    for (const url of urls) this.entry(url);
  }

  /**
   * Resolves once the image is ready to draw, failed to load, or `maxWaitMs`
   * passed, whichever is first. A slow or missing file never blocks the story.
   */
  ready(url: string, maxWaitMs: number): Promise<void> {
    const { ready } = this.entry(url);
    if (maxWaitMs <= 0) return Promise.resolve();
    return Promise.race([ready, new Promise<void>((r) => setTimeout(r, maxWaitMs))]);
  }

  private entry(url: string): Entry {
    const hit = this.kept.get(url);
    if (hit) {
      // Mark as recently used.
      this.kept.delete(url);
      this.kept.set(url, hit);
      return hit;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    const entry: Entry = { img, ready: img.decode().catch(() => undefined) };
    this.kept.set(url, entry);
    while (this.kept.size > MAX_KEPT) this.kept.delete(this.kept.keys().next().value!);
    return entry;
  }
}

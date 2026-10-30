/**
 * What a player has unlocked across every playthrough on this device: gallery
 * images seen and endings reached (achievements keep their own record).
 * Shown on the Extras screen.
 */
import type { KeyValueStore } from './read-lines.ts';

export class Progress {
  private readonly key: string;
  private readonly store: KeyValueStore;
  private readonly images: Set<string>;
  private readonly endings: Set<string>;

  constructor(key: string, store: KeyValueStore) {
    this.key = key;
    this.store = store;
    this.images = new Set(this.read('gallery'));
    this.endings = new Set(this.read('endings'));
  }

  hasSeen(image: string): boolean {
    return this.images.has(image);
  }

  hasReached(ending: string): boolean {
    return this.endings.has(ending);
  }

  /** Record a gallery image as seen. Returns true the first time. */
  seeImage(image: string): boolean {
    return this.add(this.images, 'gallery', image);
  }

  /** Record an ending as reached. Returns true the first time. */
  reachEnding(ending: string): boolean {
    return this.add(this.endings, 'endings', ending);
  }

  private add(set: Set<string>, kind: string, id: string): boolean {
    if (set.has(id)) return false;
    set.add(id);
    this.store.set(`${this.key}:${kind}`, JSON.stringify([...set]));
    return true;
  }

  private read(kind: string): string[] {
    try {
      const raw = JSON.parse(this.store.get(`${this.key}:${kind}`) ?? '[]') as unknown;
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return []; // corrupt: start over
    }
  }
}

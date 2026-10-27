/**
 * Which lines a player has read, across every playthrough on this device, so
 * skip can stop at new text.
 *
 * Lines are identified by their stable id (D-008). Editing a line gives it a
 * new id, so changed text counts as unread, which is what a reader expects.
 * Stored as one JSON array per game; writes are batched so skipping through
 * thousands of lines doesn't write to storage on every line.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): unknown;
}

export class ReadLines {
  private readonly ids = new Set<string>();
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly key: string;
  private readonly store: KeyValueStore;
  private readonly delayMs: number;

  constructor(key: string, store: KeyValueStore, delayMs = 1000) {
    this.key = key;
    this.store = store;
    this.delayMs = delayMs;
    try {
      const raw = JSON.parse(store.get(key) ?? '[]') as unknown;
      if (Array.isArray(raw)) for (const id of raw) if (typeof id === 'string') this.ids.add(id);
    } catch { /* corrupt: start over */ }
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  get size(): number {
    return this.ids.size;
  }

  add(id: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.dirty = true;
    this.timer ??= setTimeout(() => this.flush(), this.delayMs);
  }

  /** Write pending changes now (also called when the page closes). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    this.store.set(this.key, JSON.stringify([...this.ids]));
  }
}

/**
 * Looping tracks: music, ambience and looping sounds.
 *
 * An <audio loop> element stops for a moment each time it wraps around,
 * which breaks music written to loop seamlessly and makes rain "hiccup".
 * Web Audio loops a decoded buffer sample-exactly, so looping tracks use it.
 * Tracks that play once, and any file Web Audio can't decode, fall back to an
 * <audio> element.
 */

export interface Track {
  readonly path: string;
  /** Ramp the volume to `volume` (0..1) over `ms`. */
  fadeTo(volume: number, ms: number): Promise<void>;
  /** Fade out over `ms`, then stop for good. */
  stop(ms: number): void;
}

/** Decoded files are big (about 10 MB a minute); keep only the last few. */
const CACHE_SIZE = 4;

export class LoopAudio {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();

  constructor() {
    // Browsers start audio suspended until the player interacts with the page.
    const wake = () => void this.ctx?.resume().catch(() => {});
    addEventListener('pointerdown', wake, { capture: true });
    addEventListener('keydown', wake, { capture: true });
  }

  /** Start playing `url` (shown in state as `path`) at `volume`, fading in over `fadeMs`. */
  play(path: string, url: string, loop: boolean, volume: number, fadeMs: number): Track {
    const ctx = loop ? this.context() : null;
    return ctx ? new BufferTrack(ctx, path, url, this.buffer(ctx, url), volume, fadeMs) : new ElementTrack(path, url, loop, volume, fadeMs);
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null; // no Web Audio: <audio> elements it is
    }
    return this.ctx;
  }

  private buffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (p) this.buffers.delete(url); // re-insert below: most recently used last
    else {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
    }
    this.buffers.set(url, p);
    while (this.buffers.size > CACHE_SIZE) this.buffers.delete(this.buffers.keys().next().value!);
    return p;
  }
}

/** A gapless loop through Web Audio; falls back to an element if the file won't decode. */
class BufferTrack implements Track {
  readonly path: string;
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private fallback: ElementTrack | null = null;
  private stopped = false;
  private volume: number;

  constructor(ctx: AudioContext, path: string, url: string, buffer: Promise<AudioBuffer | null>, volume: number, fadeMs: number) {
    this.ctx = ctx;
    this.path = path;
    this.volume = volume;
    this.gain = ctx.createGain();
    this.gain.connect(ctx.destination);
    this.gain.gain.value = fadeMs ? 0 : volume;
    if (fadeMs) void this.fadeTo(volume, fadeMs);
    void buffer.then((b) => {
      if (this.stopped) return;
      if (!b) {
        this.fallback = new ElementTrack(path, url, true, this.volume, 0);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.connect(this.gain);
      src.start();
      this.source = src;
    });
  }

  fadeTo(volume: number, ms: number): Promise<void> {
    this.volume = volume;
    if (this.fallback) return this.fallback.fadeTo(volume, ms);
    const g = this.gain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (ms <= 0) {
      g.setValueAtTime(volume, now);
      return Promise.resolve();
    }
    g.linearRampToValueAtTime(volume, now + ms / 1000);
    // Timers, not the audio clock: they also run when the context is suspended.
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(ms: number): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.fallback) { this.fallback.stop(ms); return; }
    void this.fadeTo(0, ms).then(() => {
      try { this.source?.stop(); } catch { /* never started */ }
      this.gain.disconnect();
    });
  }
}

const fades = new WeakMap<HTMLAudioElement, number>();

/** A plain <audio> element (tracks that play once, or when Web Audio can't play the file). */
class ElementTrack implements Track {
  readonly path: string;
  private readonly el: HTMLAudioElement;

  constructor(path: string, url: string, loop: boolean, volume: number, fadeMs: number) {
    this.path = path;
    this.el = new Audio(url);
    this.el.loop = loop;
    this.el.volume = fadeMs ? 0 : clamp01(volume);
    this.el.play().catch(() => { /* autoplay blocked or file missing: stay silent */ });
    if (fadeMs) void this.fadeTo(volume, fadeMs);
  }

  fadeTo(volume: number, ms: number): Promise<void> {
    return fadeVolume(this.el, () => volume, ms);
  }

  stop(ms: number): void {
    void this.fadeTo(0, ms).then(() => this.el.pause());
  }
}

/**
 * Ramp an element's volume to `target()` over `ms`, replacing any ramp already
 * running on it. Timers rather than animation frames: fades must finish even in
 * a background tab.
 */
export function fadeVolume(a: HTMLAudioElement, target: () => number, ms: number): Promise<void> {
  window.clearInterval(fades.get(a));
  fades.delete(a);
  if (ms <= 0) {
    a.volume = clamp01(target());
    return Promise.resolve();
  }
  const from = a.volume;
  const start = performance.now();
  return new Promise((resolve) => {
    const id = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / ms);
      a.volume = clamp01(from + (target() - from) * t);
      if (t >= 1) {
        window.clearInterval(id);
        fades.delete(a);
        resolve();
      }
    }, 40);
    fades.set(a, id);
  });
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Player preferences: reading speed, audio, text appearance, motion.
 *
 * Stored per game in localStorage. Anything missing or invalid falls back to
 * the default, so old or hand-edited saves can never break the player.
 */

export interface Settings {
  /** Characters per second while text types out. INSTANT_SPEED or more = no typing effect. */
  textSpeed: number;
  /** Seconds auto mode waits after a line has finished (plus reading time per character). */
  autoDelay: number;
  /** 0..1 */
  musicVolume: number;
  /** 0..1 */
  soundVolume: number;
  /** Multiplier for story text size. */
  textScale: number;
  font: 'serif' | 'sans';
  /** Text box background opacity, 0.4..1. */
  boxOpacity: number;
  /** 'system' follows the device's reduce-motion setting. */
  motion: 'system' | 'full' | 'reduced';
}

export const INSTANT_SPEED = 200;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  textSpeed: 45,
  autoDelay: 1.4,
  musicVolume: 0.7,
  soundVolume: 0.8,
  textScale: 1,
  font: 'serif',
  boxOpacity: 0.88,
  motion: 'system',
});

/** Allowed ranges, shared by validation and the settings screen. */
export const RANGES = {
  textSpeed: { min: 10, max: INSTANT_SPEED, step: 5 },
  autoDelay: { min: 0.5, max: 5, step: 0.25 },
  musicVolume: { min: 0, max: 1, step: 0.05 },
  soundVolume: { min: 0, max: 1, step: 0.05 },
  textScale: { min: 0.8, max: 1.6, step: 0.1 },
  boxOpacity: { min: 0.4, max: 1, step: 0.05 },
} as const;

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (key: keyof typeof RANGES): number => {
    const v = r[key];
    const { min, max } = RANGES[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_SETTINGS[key];
  };
  const pick = <T extends string>(key: 'font' | 'motion', allowed: readonly T[]): T => {
    const v = r[key];
    return (allowed as readonly unknown[]).includes(v) ? (v as T) : (DEFAULT_SETTINGS[key] as T);
  };
  return {
    textSpeed: num('textSpeed'),
    autoDelay: num('autoDelay'),
    musicVolume: num('musicVolume'),
    soundVolume: num('soundVolume'),
    textScale: num('textScale'),
    boxOpacity: num('boxOpacity'),
    font: pick('font', ['serif', 'sans'] as const),
    motion: pick('motion', ['system', 'full', 'reduced'] as const),
  };
}

export function loadSettings(key: string): Settings {
  try {
    const raw = localStorage.getItem(key);
    return sanitizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return sanitizeSettings({});
  }
}

export function saveSettings(key: string, s: Settings): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

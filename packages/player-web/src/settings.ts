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
  /** 0..1 */
  voiceVolume: number;
  /** Multiplier for story text size. */
  textScale: number;
  font: FontChoice;
  /** Text box background opacity, 0.4..1. */
  boxOpacity: number;
  /** 'system' follows the device's reduce-motion setting. */
  motion: 'system' | 'full' | 'reduced';
  /** A language code, or 'auto' to match the device's languages. */
  language: string;
  /** What Skip fast-forwards through: only lines read before (stopping at new text), or everything. */
  skipMode: 'read' | 'all';
  /** 0..1, scales music, sounds and voices together. */
  masterVolume: number;
  /** Channels switched off (their volume is kept for when they're switched back on). */
  muted: { master: boolean; music: boolean; sound: boolean; voice: boolean };
  /** Each character's voice volume, 0..1 (1 when absent), by character id. */
  voiceVolumes: Record<string, number>;
  /** Characters whose voices are switched off. */
  voiceMuted: string[];
  /** Which questions to ask before doing something that can't be undone; false skips the question. */
  confirm: Record<ConfirmKind, boolean>;
}

/** The questions the player asks first ("Return to the title?"), each of which can be switched off. */
export const CONFIRM_KINDS = ['title', 'quit', 'overwrite', 'load', 'quicksave', 'quickload', 'reset', 'next_choice', 'previous_choice', 'rewind'] as const;
export type ConfirmKind = (typeof CONFIRM_KINDS)[number];

export const INSTANT_SPEED = 200;

/**
 * Story text fonts. The two accessibility fonts are bundled (SIL Open Font
 * License) and only downloaded if a player picks them.
 */
export const FONTS = [
  ['serif', 'Book (serif)'],
  ['sans', 'Clean (sans-serif)'],
  ['legible', 'Easy to read (Atkinson Hyperlegible)'],
  ['dyslexic', 'Dyslexia-friendly (OpenDyslexic)'],
] as const;

export type FontChoice = (typeof FONTS)[number][0];

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  textSpeed: 45,
  autoDelay: 1.4,
  musicVolume: 0.7,
  soundVolume: 0.8,
  voiceVolume: 1,
  textScale: 1,
  font: 'serif',
  boxOpacity: 0.88,
  motion: 'system',
  language: 'auto',
  skipMode: 'read',
  masterVolume: 1,
  muted: Object.freeze({ master: false, music: false, sound: false, voice: false }),
  voiceVolumes: Object.freeze({}),
  voiceMuted: Object.freeze([]) as unknown as string[],
  confirm: Object.freeze(Object.fromEntries(CONFIRM_KINDS.map((k) => [k, true]))) as Record<ConfirmKind, boolean>,
});

/** Allowed ranges, shared by validation and the settings screen. */
export const RANGES = {
  textSpeed: { min: 10, max: INSTANT_SPEED, step: 5 },
  autoDelay: { min: 0.5, max: 5, step: 0.25 },
  musicVolume: { min: 0, max: 1, step: 0.05 },
  soundVolume: { min: 0, max: 1, step: 0.05 },
  voiceVolume: { min: 0, max: 1, step: 0.05 },
  masterVolume: { min: 0, max: 1, step: 0.05 },
  textScale: { min: 0.8, max: 1.6, step: 0.1 },
  boxOpacity: { min: 0.4, max: 1, step: 0.05 },
} as const;

/** 'auto', or a BCP 47 language tag such as "fr", "pt-BR" or "zh-Hant". */
const LANGUAGE_CODE = /^(auto|[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3})$/;

const ID = /^[A-Za-z_]\w*$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (key: keyof typeof RANGES): number => {
    const v = r[key];
    const { min, max } = RANGES[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_SETTINGS[key];
  };
  const pick = <T extends string>(key: 'font' | 'motion' | 'skipMode', allowed: readonly T[]): T => {
    const v = r[key];
    return (allowed as readonly unknown[]).includes(v) ? (v as T) : (DEFAULT_SETTINGS[key] as T);
  };
  return {
    textSpeed: num('textSpeed'),
    autoDelay: num('autoDelay'),
    musicVolume: num('musicVolume'),
    soundVolume: num('soundVolume'),
    voiceVolume: num('voiceVolume'),
    textScale: num('textScale'),
    boxOpacity: num('boxOpacity'),
    font: pick('font', FONTS.map(([id]) => id)),
    motion: pick('motion', ['system', 'full', 'reduced'] as const),
    skipMode: pick('skipMode', ['read', 'all'] as const),
    language: typeof r.language === 'string' && LANGUAGE_CODE.test(r.language) ? r.language : DEFAULT_SETTINGS.language,
    masterVolume: num('masterVolume'),
    muted: Object.fromEntries((['master', 'music', 'sound', 'voice'] as const).map((k) => [k, obj(r.muted)[k] === true])) as Settings['muted'],
    voiceVolumes: Object.fromEntries(Object.entries(obj(r.voiceVolumes)).filter(([k, v]) => ID.test(k) && typeof v === 'number' && Number.isFinite(v)).map(([k, v]) => [k, Math.min(1, Math.max(0, v as number))])),
    voiceMuted: Array.isArray(r.voiceMuted) ? [...new Set(r.voiceMuted.filter((x): x is string => typeof x === 'string' && ID.test(x)))] : [],
    confirm: Object.fromEntries(CONFIRM_KINDS.map((k) => [k, obj(r.confirm)[k] !== false])) as Record<ConfirmKind, boolean>,
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

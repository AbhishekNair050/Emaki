/**
 * Every piece of text the player's own interface shows, in English.
 *
 * They go into each translation file next to the story's lines (as `ui.*`),
 * so a translated game is translated all the way through, buttons included.
 * `{n}`-style placeholders are filled in by the player.
 */
import type { SourceString } from '@emaki/format';

export const UI_STRINGS = {
  'ui.start': 'Start',
  'ui.load': 'Load',
  'ui.save': 'Save',
  'ui.settings': 'Settings',
  'ui.quit': 'Quit',
  'ui.back': 'Back',
  'ui.back_hint': 'Roll back to the previous line (←)',
  'ui.log': 'Log',
  'ui.log_hint': 'Dialogue history (L)',
  'ui.auto': 'Auto',
  'ui.auto_hint': 'Advance automatically (A)',
  'ui.skip': 'Skip',
  'ui.skip_hint': 'Fast-forward (S)',
  'ui.skip_mode': 'Skip',
  'ui.skip_read': 'Text you have read',
  'ui.skip_all': 'All text',
  'ui.skip_stopped': 'Skipping stopped at new text',
  'ui.settings_hint': 'Text speed, volume, text size (O)',
  'ui.menu': 'Menu',
  'ui.game_menu': 'Game menu',
  'ui.choices': 'Choices',
  'ui.untitled': 'Untitled',
  'ui.made_with': 'Made with Emaki',
  'ui.the_end': 'The End',
  'ui.replay_voice': 'Play the voice again',
  'ui.extras': 'Extras',
  'ui.gallery': 'Gallery',
  'ui.endings': 'Endings',
  'ui.achievements': 'Achievements',
  'ui.locked': '???',
  'ui.count': '{n} of {total}',
  'ui.back_to_title': 'Back to title',
  'ui.undo_last_line': 'Undo last line',
  'ui.return_to_title_question': 'Return to title?',
  'ui.unsaved_progress_lost': 'Unsaved progress will be lost.',
  'ui.return_to_title': 'Return to title',
  'ui.keep_playing': 'Keep playing',
  'ui.quit_question': 'Quit the game?',
  'ui.history': 'History',
  'ui.close': 'Close',
  'ui.done': 'Done',
  'ui.reset_settings': 'Reset to defaults',
  'ui.text_speed': 'Text speed',
  'ui.instant': 'Instant',
  'ui.letters_per_second': '{n} letters/s',
  'ui.auto_wait': 'Auto-advance wait',
  'ui.seconds': '{n} s',
  'ui.music_volume': 'Music volume',
  'ui.sound_volume': 'Sound volume',
  'ui.voice_volume': 'Voice volume',
  'ui.text_size': 'Text size',
  'ui.box_opacity': 'Text box opacity',
  'ui.font': 'Font',
  'ui.font_serif': 'Book (serif)',
  'ui.font_sans': 'Clean (sans-serif)',
  'ui.font_legible': 'Easy to read (Atkinson Hyperlegible)',
  'ui.font_dyslexic': 'Dyslexia-friendly (OpenDyslexic)',
  'ui.animations': 'Animations',
  'ui.motion_system': 'Follow my device',
  'ui.motion_full': 'On',
  'ui.motion_reduced': 'Reduced',
  'ui.language': 'Language',
  'ui.language_auto': 'Match my device',
  'ui.fullscreen': 'Full screen',
  'ui.on': 'On',
  'ui.off': 'Off',
  'ui.settings_preview': 'The light sweeps out over the black water, and for a moment the whole bay is silver.',
  'ui.slot': 'Slot {n}: {label}',
  'ui.empty': 'Empty',
  'ui.at_a_choice': 'At a choice',
  'ui.saved_to_slot': 'Saved to slot {n}',
  'ui.quick_saved': 'Quick saved',
  'ui.could_not_save': 'Could not save (storage unavailable)',
  'ui.could_not_load': 'That save could not be loaded',
  'ui.loaded': 'Loaded',
  'ui.loaded_changed': 'Loaded (the story has changed since this save)',
  'ui.achievement': 'Achievement unlocked: {name}',
  'ui.error_title': 'Something went wrong',
} as const;

export type UiKey = keyof typeof UI_STRINGS;

/** The interface strings as translatable source strings (for `emaki strings` and the build). */
export function uiSourceStrings(): SourceString[] {
  return Object.entries(UI_STRINGS).map(([id, text]) => ({ id, kind: 'ui', speaker: null, text, label: null, line: 0 }));
}

/** Fill `{name}` placeholders. */
export function fill(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Languages written right to left. */
export function isRtl(lang: string): boolean {
  return ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ckb', 'dv'].includes(lang.split('-')[0]!.toLowerCase());
}

/** A language's own name for itself ("français", "日本語"), capitalised. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

/** `zh-TW` → `zh-hant-tw`: the likely script and region filled in, so tags written differently can be compared. */
function maximized(tag: string): string {
  try {
    return new Intl.Locale(tag).maximize().toString().toLowerCase();
  } catch {
    return tag.toLowerCase();
  }
}
/** Base language and script: `zh-TW` → `zh-hant`, `zh-Hans` → `zh-hans`, `fr-CA` → `fr-latn`. */
const baseScript = (tag: string) => maximized(tag).split('-').slice(0, 2).join('-');

/**
 * The best of `available` for someone whose preferred languages are `wanted`
 * (navigator.languages): the same language first (exactly, or the same once the
 * likely script and region are filled in: `zh-TW` is `zh-Hant`, `zh-CN` is
 * `zh-Hans`), then the same language and script (`zh-HK` → `zh-Hant`), then
 * the same base language ("pt-BR" → "pt").
 */
export function matchLanguage(wanted: readonly string[], available: readonly string[]): string | null {
  const lower = available.map((a) => a.toLowerCase());
  const max = available.map(maximized);
  for (const w of wanted) {
    let i = lower.indexOf(w.toLowerCase());
    if (i < 0) i = max.indexOf(maximized(w));
    if (i >= 0) return available[i]!;
  }
  const scripts = available.map(baseScript);
  for (const w of wanted) {
    const i = scripts.indexOf(baseScript(w));
    if (i >= 0) return available[i]!;
  }
  for (const w of wanted) {
    const base = w.split('-')[0]!.toLowerCase();
    const i = available.findIndex((a) => a.split('-')[0]!.toLowerCase() === base);
    if (i >= 0) return available[i]!;
  }
  return null;
}

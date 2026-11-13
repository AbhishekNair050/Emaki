/**
 * Screens: a game's own title screen, menus and (later) text box, written in
 * the script.
 *
 *   screen title:
 *     image "ui/title.png"
 *     column at 80% 60% anchor center gap 2%:
 *       button "New Game" image "ui/new.png" hover "ui/new_on.png" -> start
 *       button "Extras" -> open extras if g_endings > 0
 *
 * Every element is one line: `kind ["text"] [options] [-> actions] [if condition]`,
 * and containers (row, column, box) end with `:` and hold the lines indented
 * under them. Positions and sizes are percentages of the screen, or pixels on
 * the canvas the header declares (`canvas: 1920x1080`); the compiler turns
 * pixels into percentages, so a screen drawn in pixels still scales.
 *
 * Screens compile to a declarative tree (no code), so any runtime can draw
 * them, and their actions are a fixed set, so a screen can't break the story.
 */
import type { AssetRef, AssignOp, Diagnostic, Loc, Trivia } from './ast.ts';
import { freeVars, parseExpr, printExpr, readQuoted, type Expr } from './expr.ts';
import { parseMarkup, type Span } from './markup.ts';
import { checkPluginCall, checkPluginFunctions, parsePluginCall, printPluginCall, type PluginCall, type PluginManifest } from './plugins.ts';

// ------------------------------------------------------------------ syntax tree

export type ScreenKind =
  | 'image' | 'text' | 'button' | 'row' | 'column' | 'box'
  | 'slots' | 'thumbnail' | 'gallery' | 'endings' | 'achievements'
  | 'slider' | 'toggle' | 'choice'
  | 'dialogue' | 'speaker' | 'side'
  | 'log'
  | 'plugin'
  | 'scenes' | 'music';
export const SCREEN_KINDS: readonly ScreenKind[] = [
  'image', 'text', 'button', 'row', 'column', 'box',
  'slots', 'thumbnail', 'gallery', 'endings', 'achievements', 'slider', 'toggle', 'choice',
  'dialogue', 'speaker', 'side', 'log', 'scenes', 'music',
];
// `plugin` elements are written `@clock face ...`, not with a kind word.
/** Parts of the text box, only in `screen textbox`: the line being said, who says it, their side image. */
const TEXTBOX_PARTS: ReadonlySet<ScreenKind> = new Set(['dialogue', 'speaker', 'side']);
/** Variables `screen textbox` sees: who is speaking ("" for narration). */
export const TEXTBOX_VARS = ['speaker'] as const;
/** Variables each entry of `log` sees: its place, who said it, what, and whether it has a voice to replay. */
export const LOG_VARS = ['log_number', 'log_name', 'log_text', 'log_voice'] as const;
/** Variables `screen confirm` sees: which question (title, quit, overwrite, ...) and its text in the player's language. */
export const CONFIRM_VARS = ['confirm', 'message'] as const;
/** Settings that can belong to one character: `slider "Rin" voice_volume rin`. */
export const PER_CHARACTER_SETTINGS = ['voice_volume', 'voice_mute'] as const;
/** How a screen appears when it opens (`screen menu with fade 0.3:`). */
export const SCREEN_TRANSITIONS = ['fade', 'dissolve', 'none'] as const;
const CONTAINERS: ReadonlySet<ScreenKind> = new Set(['row', 'column', 'box']);

/**
 * Player settings a screen can show, by kind of control. Sliders are numbers,
 * toggles are on/off, choices pick one of a few options.
 */
export const SCREEN_SETTINGS = {
  slider: ['text_speed', 'auto_wait', 'master_volume', 'music_volume', 'sound_volume', 'voice_volume', 'text_size', 'box_opacity'],
  toggle: [
    'skip_unread', 'animations', 'fullscreen', 'master_mute', 'music_mute', 'sound_mute', 'voice_mute',
    'confirm_title', 'confirm_quit', 'confirm_overwrite', 'confirm_load', 'confirm_quicksave', 'confirm_quickload',
    'confirm_reset', 'confirm_next_choice', 'confirm_previous_choice', 'confirm_rewind',
  ],
  choice: ['font', 'language', 'animations', 'skip'],
} as const;

/** Variables each cell of `slots` sees (besides the story's own). */
export const SLOT_VARS = ['slot_number', 'slot_cell', 'slot_empty', 'slot_date', 'slot_text'] as const;
/** Variables every screen sees: the page of its slots or gallery. */
export const PAGE_VARS = ['page', 'pages'] as const;
/** The most cells one `slots` or `gallery` can show at a time. */
export const MAX_CELLS = 60;

/** A length: a percentage of the screen, or pixels on the declared canvas. */
export interface Len { value: number; unit: '%' | 'px' }

export const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export type Anchor = (typeof ANCHORS)[number];

export type ScreenAction =
  | { do: 'start'; label?: string }
  | { do: 'continue' }
  | { do: 'open'; screen: string }
  | { do: 'close' }
  | { do: 'title' }
  | { do: 'quit' }
  | { do: 'jump'; label: string }
  | { do: 'set'; name: string; op: AssignOp; value: Expr }
  /** On a screen the story called (`call screen map`): go on with the story, keeping `value`. */
  | { do: 'return'; value?: Expr }
  /** On `slots`: what clicking a slot does. */
  | { do: 'load' }
  | { do: 'save' }
  /** Turn the page of the screen's slots or gallery. */
  | { do: 'page'; to: 'next' | 'previous' | number }
  /** Show another screen in this one's place (tabs: save and load, pages of settings). */
  | { do: 'switch'; screen: string }
  /** Set a player setting (a picture button for each option); the button shows as selected while it holds. */
  | { do: 'setting'; name: string; value: string | number | boolean }
  /** The story's controls, for a text box or menu of your own: go back a line, auto, skip, hide the interface, quick save and load, replay the voice. */
  | { do: 'back' } | { do: 'auto' } | { do: 'skip' } | { do: 'hide' }
  | { do: 'quicksave' } | { do: 'quickload' } | { do: 'voice' }
  /** Answers on `screen confirm`. */
  | { do: 'yes' } | { do: 'no' }
  /** Put every setting back as it was (except the language). */
  | { do: 'reset' }
  /** Skip ahead to the next choice, or go back to the previous one. */
  | { do: 'next_choice' } | { do: 'previous_choice' }
  /** In a `log` entry: go back to that line. (`voice` there replays that line's voice.) */
  | { do: 'rewind' }
  /** Scroll a `log` by one entry. */
  | { do: 'scroll'; to: 'up' | 'down' }
  /** Play a sample at a channel's volume (a character's, for `voice ... rin`): the "test" button by a slider. */
  | { do: 'sample'; channel: 'sound' | 'voice'; path: string; character?: string };

/** Actions that take nothing after them. */
const BARE_ACTIONS = [
  'continue', 'close', 'title', 'quit', 'load', 'save', 'back', 'auto', 'skip', 'hide', 'quicksave', 'quickload', 'voice',
  'yes', 'no', 'reset', 'next_choice', 'previous_choice', 'rewind',
] as const;

export interface ScreenItem extends Trivia {
  kind: ScreenKind;
  /** Text of a `text`, label of a `button` (also its accessible name when it's a picture). */
  text?: string;
  /** The picture of an `image`, or of a picture `button`. */
  image?: AssetRef;
  /** A picture button's picture while pointed at or focused. */
  hover?: AssetRef;
  /** ... while pressed, while selected (auto on, the setting it sets in effect, the page shown), and when it can't be used. */
  pressed?: AssetRef;
  selected?: AssetRef;
  disabled?: AssetRef;
  /** A picture slider's knob (its `image` is the track). */
  knob?: AssetRef;
  /** Description of an `image` for screen readers (none: decorative). */
  alt?: string;
  at?: [Len, Len];
  /** Width and height; null for "as big as its content". */
  size?: [Len | null, Len | null];
  anchor?: Anchor;
  /** Space between the children of a row or column. */
  gap?: Len;
  /** A class name for theme.css. */
  className?: string;
  /** How many cells a `slots` or `gallery` shows per page. */
  count?: number;
  /** How many of them across (all of them in one row when absent). */
  columns?: number;
  /** The setting a slider, toggle or choice controls. */
  setting?: string;
  /** For a per-character setting (`slider "Rin" voice_volume rin`): whose. */
  character?: string;
  /** A plugin's element: `@clock face style="digital"`. */
  call?: PluginCall;
  actions?: ScreenAction[];
  cond?: Expr;
  children?: ScreenItem[];
  loc: Loc;
}

export interface ScreenDef extends Trivia {
  name: string;
  items: ScreenItem[];
  /** `screen menu with fade 0.3:`: how it appears. */
  transition?: { name: (typeof SCREEN_TRANSITIONS)[number]; duration?: number };
  loc: Loc;
}

/** Screens Emaki has built in; a `screen` with one of these names replaces it. */
export const REPLACEABLE_SCREENS = ['title', 'menu', 'load', 'save', 'settings', 'extras', 'textbox', 'history', 'confirm'] as const;
/** Built-in screens `open` can show. */
export const BUILTIN_SCREENS = ['load', 'save', 'settings', 'extras', 'history'] as const;

// ------------------------------------------------------------------ parsing one line

type Token = { text: string; quoted: boolean; start: number };

/** Split on spaces, keeping quoted strings whole. */
function tokenize(src: string): Token[] | string {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i]!)) { i++; continue; }
    if (src[i] === '"') {
      try {
        const q = readQuoted(src, i);
        out.push({ text: q.value, quoted: true, start: i });
        i = q.end;
      } catch (e) {
        return (e as Error).message;
      }
      continue;
    }
    const start = i;
    while (i < src.length && !/\s/.test(src[i]!) && src[i] !== '"') i++;
    out.push({ text: src.slice(start, i), quoted: false, start });
  }
  return out;
}

/** Index of `needle` in `src` outside quoted strings, or -1. With `word`, only as a whole word. */
function findOutsideQuotes(src: string, needle: string, word = false, last = false): number {
  let found = -1;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (!src.startsWith(needle, i)) continue;
    if (word && ((i > 0 && /\w/.test(src[i - 1]!)) || /\w/.test(src[i + needle.length] ?? ''))) continue;
    found = i;
    if (!last) return i;
  }
  return found;
}

function splitOutsideQuotes(src: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"') { for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === sep && depth === 0) { parts.push(src.slice(from, i)); from = i + 1; }
  }
  parts.push(src.slice(from));
  return parts;
}

function parseLen(t: string | undefined): Len | null {
  const m = t ? /^(-?\d+(?:\.\d+)?)(%|px)$/.exec(t) : null;
  return m ? { value: Number(m[1]), unit: m[2] as '%' | 'px' } : null;
}

/** Words that start an option, so they're never taken for a character id. */
const OPTION_WORDS = new Set(['at', 'size', 'anchor', 'gap', 'columns', 'image', 'hover', 'pressed', 'selected', 'disabled', 'knob', 'alt']);

const asset = (t: Token): AssetRef => (t.quoted ? { kind: 'path', path: t.text } : { kind: 'name', name: t.text });

function parseAction(src: string): ScreenAction | string {
  const words = src.trim().split(/\s+/).filter(Boolean);
  const [verb, arg, ...more] = words;
  const one = (a: ScreenAction): ScreenAction | string => (more.length ? `Unexpected '${more.join(' ')}' after '${verb} ${arg}'` : a);
  const none = (a: ScreenAction): ScreenAction | string => (arg !== undefined ? `'${verb}' takes nothing after it` : a);
  const name = (what: string): string | null => (arg && /^[A-Za-z_]\w*$/.test(arg) ? null : `'${verb}' needs ${what}`);
  if ((BARE_ACTIONS as readonly string[]).includes(verb ?? '')) return none({ do: verb } as ScreenAction);
  switch (verb) {
    case 'start': return arg === undefined ? { do: 'start' } : name('a label') ?? one({ do: 'start', label: arg });
    case 'open': return name('a screen name, like open settings') ?? one({ do: 'open', screen: arg! });
    case 'switch': return name('a screen name, like switch load') ?? one({ do: 'switch', screen: arg! });
    case 'jump': return name('a label') ?? one({ do: 'jump', label: arg! });
    case 'scroll': return arg === 'up' || arg === 'down' ? one({ do: 'scroll', to: arg }) : `'scroll' needs up or down`;
    case 'sample': {
      const m = /^sample\s+(sound|voice)\s+"([^"]+)"(?:\s+([A-Za-z_]\w*))?$/.exec(src.trim());
      if (!m || (m[3] && m[1] !== 'voice')) return `Expected 'sample sound "sound/test.ogg"' or 'sample voice "voice/test.ogg" rin'`;
      return { do: 'sample', channel: m[1] as 'sound' | 'voice', path: m[2]!, ...(m[3] ? { character: m[3] } : {}) };
    }
    case 'setting': {
      const all = Object.values(SCREEN_SETTINGS).flat() as string[];
      const raw = more.join(' ');
      if (!arg || !all.includes(arg) || !raw) return `Expected 'setting name value', like 'setting skip_unread on' or 'setting language ja' (settings: ${[...new Set(all)].join(', ')})`;
      const value = raw === 'on' ? true : raw === 'off' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw.replace(/^"(.*)"$/, '$1');
      return { do: 'setting', name: arg, value };
    }
    case 'page': {
      if (arg === 'next' || arg === 'previous') return one({ do: 'page', to: arg });
      if (arg && /^\d+$/.test(arg) && Number(arg) >= 1) return one({ do: 'page', to: Number(arg) });
      return `'page' needs next, previous or a page number`;
    }
    case 'return': {
      const rest = src.trim().slice('return'.length).trim();
      if (!rest) return { do: 'return' };
      try {
        return { do: 'return', value: parseExpr(rest) };
      } catch (e) {
        return (e as Error).message;
      }
    }
    case 'set': {
      const m = /^set\s+([A-Za-z_]\w*)\s*(\+=|-=|=)\s*(.+)$/.exec(src.trim());
      if (!m) return `Expected 'set name = value' (or += / -=)`;
      try {
        return { do: 'set', name: m[1]!, op: m[2] as AssignOp, value: parseExpr(m[3]!) };
      } catch (e) {
        return (e as Error).message;
      }
    }
    case undefined: return `Expected an action after '->'`;
    default: return `Unknown action '${verb}' (use start, continue, open, switch, close, title, quit, jump, set, return, page, setting, back, auto, skip, hide, quicksave, quickload, voice, yes, no, reset, next_choice, previous_choice, scroll, sample; rewind in a log; load and save on slots)`;
  }
}

/**
 * One element line (without its children). Returns the item, whether it holds
 * children (ends with `:`), or a message for the writer.
 */
export function parseScreenLine(text: string, loc: Loc): { item: ScreenItem; container: boolean } | { error: string } {
  let src = text.trim();
  const container = src.endsWith(':') && findOutsideQuotes(src, ':', false, true) === src.length - 1;
  if (container) src = src.slice(0, -1).trimEnd();

  const item: ScreenItem = { kind: 'box', loc };
  // `if condition` comes last.
  const ifAt = findOutsideQuotes(src, 'if', true);
  if (ifAt > 0) {
    const cond = src.slice(ifAt + 2).trim();
    if (findOutsideQuotes(cond, '->') >= 0) return { error: `Put 'if ...' at the end of the line, after the actions` };
    if (!cond) return { error: `'if' needs a condition, like 'if trust >= 2'` };
    try { item.cond = parseExpr(cond); } catch (e) { return { error: (e as Error).message }; }
    src = src.slice(0, ifAt).trimEnd();
  }
  // `-> action, action`
  const arrow = findOutsideQuotes(src, '->');
  if (arrow >= 0) {
    const actions: ScreenAction[] = [];
    for (const part of splitOutsideQuotes(src.slice(arrow + 2), ',')) {
      const a = parseAction(part);
      if (typeof a === 'string') return { error: a };
      actions.push(a);
    }
    item.actions = actions;
    src = src.slice(0, arrow).trimEnd();
  }

  let call: PluginCall | null = null;
  if (src.startsWith('@')) {
    // A plugin's element: `@clock face style="digital" at 90% 4%`.
    if (container) return { error: `A plugin's element can't hold other elements` };
    if (item.actions) return { error: `A plugin's element has no actions ('->'); the plugin decides what it does` };
    const r = parsePluginCall(src);
    if ('error' in r) return { error: r.error };
    call = r.call;
    src = `plugin ${r.rest}`;
  }
  const tokens = tokenize(src);
  if (typeof tokens === 'string') return { error: tokens };
  const kind = (call ? (tokens.shift(), 'plugin') : tokens.shift()?.text) as ScreenKind;
  if (call) item.call = call;
  if (!SCREEN_KINDS.includes(kind) && kind !== 'plugin') return { error: `Unknown screen element '${kind}' (use ${SCREEN_KINDS.join(', ')})` };
  item.kind = kind;
  if (kind === 'log' && !container) return { error: `'log' needs a ':' and what each entry shows, indented under it` };
  if (kind !== 'slots' && kind !== 'log' && CONTAINERS.has(kind) !== container) {
    return { error: container ? `'${kind}' can't hold other elements; only row, column, box and slots can` : `'${kind}' needs a ':' and the elements it holds, indented under it` };
  }
  if (item.actions && kind !== 'button' && kind !== 'slots') return { error: `Only buttons and slots have actions ('->')` };
  if (kind === 'slots') {
    const a = item.actions;
    if (!a || a.length !== 1 || (a[0]!.do !== 'load' && a[0]!.do !== 'save')) return { error: `Slots need '-> load' or '-> save': what clicking a slot does` };
  } else if (item.actions?.some((a) => a.do === 'load' || a.do === 'save')) {
    return { error: `'load' and 'save' go on slots ('slots 6 -> load'); a button opens the screen with 'open load'` };
  }

  if (kind === 'image') {
    const t = tokens.shift();
    if (!t || (!t.quoted && !/^[A-Za-z_]\w*$/.test(t.text))) return { error: `Expected 'image "ui/logo.png"' or the name of a declared image` };
    item.image = asset(t);
  } else if (kind === 'text' || kind === 'button') {
    const t = tokens.shift();
    if (!t?.quoted) return { error: kind === 'text' ? `Expected 'text "What it says"'` : `A button needs its label first: 'button "New Game" -> start' (also when it's a picture: it's what screen readers say)` };
    item.text = t.text;
  } else if (kind === 'slots' || kind === 'gallery' || kind === 'log' || kind === 'scenes' || kind === 'music') {
    const n = tokens.shift()?.text;
    if (!n || !/^\d+$/.test(n) || Number(n) < 1 || Number(n) > MAX_CELLS) return { error: `Expected how many to show at once, like '${kind} 6' (1 to ${MAX_CELLS})` };
    item.count = Number(n);
  } else if (TEXTBOX_PARTS.has(kind)) {
    // Nothing to give: the player fills them in.
  } else if (kind === 'slider' || kind === 'toggle' || kind === 'choice') {
    const label = tokens.shift();
    const setting = tokens.shift();
    const names = SCREEN_SETTINGS[kind] as readonly string[];
    if (!label?.quoted) return { error: `A ${kind} needs its label first (what it's for, and what screen readers say): ${kind} "Music" ${names[0]}` };
    if (!setting || setting.quoted || !names.includes(setting.text)) return { error: `A ${kind} controls one of: ${names.join(', ')}` };
    item.text = label.text;
    item.setting = setting.text;
    const who = tokens[0];
    if ((PER_CHARACTER_SETTINGS as readonly string[]).includes(setting.text) && who && !who.quoted && /^[A-Za-z_]\w*$/.test(who.text) && !OPTION_WORDS.has(who.text)) {
      item.character = who.text;
      tokens.shift();
    }
  }

  while (tokens.length) {
    const t = tokens.shift()!;
    const opt = t.quoted ? '' : t.text;
    const need = (n: number) => tokens.length >= n;
    if (opt === 'at') {
      const x = parseLen(tokens[0]?.text), y = parseLen(tokens[1]?.text);
      if (!x || !y) return { error: `'at' needs a place across then down, like 'at 50% 30%' or 'at 1200px 400px'` };
      tokens.splice(0, 2);
      item.at = [x, y];
    } else if (opt === 'size') {
      const len = (s: string | undefined) => (s === 'auto' ? null : parseLen(s));
      if (!need(2)) return { error: `'size' needs a width and a height, like 'size 30% auto' or 'size 400px 120px'` };
      const w = len(tokens[0]!.text), h = len(tokens[1]!.text);
      if (w === undefined || h === undefined || (w === null && tokens[0]!.text !== 'auto') || (h === null && tokens[1]!.text !== 'auto')) {
        return { error: `'size' needs a width and a height, like 'size 30% auto' or 'size 400px 120px'` };
      }
      tokens.splice(0, 2);
      item.size = [w, h];
    } else if (opt === 'anchor') {
      const a = tokens.shift()?.text;
      if (!a || !(ANCHORS as readonly string[]).includes(a)) return { error: `'anchor' is the point of the element that 'at' places: ${ANCHORS.join(', ')}` };
      item.anchor = a as Anchor;
    } else if (opt === 'gap') {
      const g = parseLen(tokens.shift()?.text);
      if (!g) return { error: `'gap' needs a length, like 'gap 2%' or 'gap 24px'` };
      if (!['row', 'column', 'slots', 'gallery', 'scenes', 'music'].includes(kind)) return { error: `Only rows, columns, slots, galleries, scenes and music have a gap between their elements` };
      item.gap = g;
    } else if (/^class=/.test(opt)) {
      const c = opt.slice('class='.length);
      if (!/^[A-Za-z_][\w-]*$/.test(c)) return { error: `'class=' needs a name for theme.css, like class=heading` };
      item.className = c;
    } else if (opt === 'image' || opt === 'hover' || opt === 'pressed' || opt === 'selected' || opt === 'disabled' || opt === 'knob') {
      const ok = kind === 'button' || kind === 'slots' || kind === 'toggle' ? opt !== 'knob' : kind === 'slider' ? opt === 'image' || opt === 'knob' : false;
      if (!ok) return { error: opt === 'knob' || kind === 'slider' ? `A picture slider has an 'image' (its track) and a 'knob'` : `'${opt}' is for picture buttons and slots` };
      const p = tokens.shift();
      if (!p || (!p.quoted && !/^[A-Za-z_]\w*$/.test(p.text))) return { error: `'${opt}' needs a picture: ${opt} "ui/button.png"` };
      item[opt] = asset(p);
    } else if (opt === 'columns') {
      const n = tokens.shift()?.text;
      if (kind !== 'slots' && kind !== 'gallery' && kind !== 'scenes' && kind !== 'music') return { error: `'columns' is for slots, gallery, scenes and music` };
      if (!n || !/^\d+$/.test(n) || Number(n) < 1 || Number(n) > item.count!) return { error: `'columns' needs how many across, from 1 to ${item.count}` };
      item.columns = Number(n);
    } else if (opt === 'alt') {
      const p = tokens.shift();
      if (kind !== 'image') return { error: `'alt' describes an image for screen readers` };
      if (!p?.quoted) return { error: `'alt' needs a description in quotes` };
      item.alt = p.text;
    } else {
      return { error: `Unexpected '${t.quoted ? `"${t.text}"` : t.text}' (options: at, size, anchor, gap, columns, class=, image, hover, pressed, selected, disabled, knob, alt)` };
    }
  }
  if ((item.hover || item.pressed || item.selected || item.disabled) && !item.image) return { error: `A button with 'hover', 'pressed', 'selected' or 'disabled' needs its 'image' too` };
  if (item.knob && !item.image) return { error: `A picture slider needs its track ('image') too` };
  return { item, container };
}

// ------------------------------------------------------------------ printing

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const lenText = (l: Len) => `${l.value}${l.unit}`;
const assetText = (a: AssetRef) => (a.kind === 'name' ? a.name : quote(a.path));

function actionText(a: ScreenAction): string {
  switch (a.do) {
    case 'start': return a.label ? `start ${a.label}` : 'start';
    case 'open': return `open ${a.screen}`;
    case 'jump': return `jump ${a.label}`;
    case 'set': return `set ${a.name} ${a.op} ${printExpr(a.value)}`;
    case 'page': return `page ${a.to}`;
    case 'switch': return `switch ${a.screen}`;
    case 'scroll': return `scroll ${a.to}`;
    case 'sample': return `sample ${a.channel} ${quote(a.path)}${a.character ? ` ${a.character}` : ''}`;
    case 'setting': return `setting ${a.name} ${a.value === true ? 'on' : a.value === false ? 'off' : typeof a.value === 'string' && !/^[\w-]+$/.test(a.value) ? quote(a.value) : a.value}`;
    case 'return': return a.value ? `return ${printExpr(a.value)}` : 'return';
    default: return a.do;
  }
}

/** One element's line, in canonical form. */
export function printScreenLine(it: ScreenItem): string {
  const parts: string[] = [it.call ? printPluginCall(it.call) : it.kind];
  if (it.kind === 'image' && it.image) parts.push(assetText(it.image));
  if (it.count !== undefined) parts.push(String(it.count));
  if (it.columns !== undefined) parts.push('columns', String(it.columns));
  if (it.text !== undefined) parts.push(quote(it.text));
  if (it.setting) parts.push(it.setting);
  if (it.character) parts.push(it.character);
  if (it.kind !== 'image' && it.image) parts.push('image', assetText(it.image));
  if (it.hover) parts.push('hover', assetText(it.hover));
  if (it.pressed) parts.push('pressed', assetText(it.pressed));
  if (it.selected) parts.push('selected', assetText(it.selected));
  if (it.disabled) parts.push('disabled', assetText(it.disabled));
  if (it.knob) parts.push('knob', assetText(it.knob));
  if (it.at) parts.push('at', lenText(it.at[0]), lenText(it.at[1]));
  if (it.size) parts.push('size', it.size[0] ? lenText(it.size[0]) : 'auto', it.size[1] ? lenText(it.size[1]) : 'auto');
  if (it.anchor) parts.push('anchor', it.anchor);
  if (it.gap) parts.push('gap', lenText(it.gap));
  if (it.className) parts.push(`class=${it.className}`);
  if (it.alt !== undefined) parts.push('alt', quote(it.alt));
  if (it.actions?.length) parts.push('->', it.actions.map(actionText).join(', '));
  if (it.cond) parts.push('if', printExpr(it.cond));
  return parts.join(' ') + (it.children ? ':' : '');
}

// ------------------------------------------------------------------ compiling

/** What a runtime draws. Positions and sizes are percentages of the screen's width (x, w) and height (y, h, gap). */
export interface CompiledScreenItem {
  kind: ScreenKind;
  /** Translation id of `text` (and of `alt`, as `<id>.alt`). */
  id?: string;
  text?: string;
  spans?: Span[];
  image?: string;
  hover?: string;
  pressed?: string;
  selected?: string;
  disabled?: string;
  knob?: string;
  alt?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** The point of the element placed at x, y, as fractions of its size (0 0 = top left). */
  anchor?: [number, number];
  gap?: number;
  className?: string;
  count?: number;
  columns?: number;
  setting?: string;
  character?: string;
  /** A plugin element: whose, which, and its arguments. */
  plugin?: string;
  element?: string;
  args?: Record<string, Expr>;
  cond?: Expr;
  actions?: ScreenAction[];
  children?: CompiledScreenItem[];
}

export interface CompiledScreen {
  items: CompiledScreenItem[];
  /** How it appears: `fade` (or `dissolve`, the same for screens) over `duration` seconds. */
  transition?: 'fade' | 'dissolve';
  duration?: number;
}

export interface ScreenContext {
  images: Record<string, string>;
  labels: ReadonlySet<string>;
  vars: Record<string, unknown>;
  /** From the header `canvas: 1920x1080`; null when it has none. */
  canvas: [number, number] | null;
  error: (loc: Loc, code: string, message: string) => void;
  warn: (loc: Loc, code: string, message: string) => void;
  /** How many save slots the game has (`save_slots:` in the header). */
  saveSlots: number;
  /** Character ids (`define`), for per-character settings. */
  characters?: ReadonlySet<string>;
  /** The game's plugins, for their elements (absent: not checked). */
  plugins?: Readonly<Record<string, PluginManifest>>;
  /** Ids from the compiler's id scheme for translatable text. */
  textId: (screen: string, text: string) => string;
  /** Record a translatable string. */
  addString: (id: string, text: string, loc: Loc) => void;
}

const ANCHOR_POINT: Record<Anchor, [number, number]> = {
  'top-left': [0, 0], top: [0.5, 0], 'top-right': [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  'bottom-left': [0, 1], bottom: [0.5, 1], 'bottom-right': [1, 1],
};

export function compileScreens(defs: ScreenDef[], ctx: ScreenContext): Record<string, CompiledScreen> {
  const out: Record<string, CompiledScreen> = {};
  const names = new Set(defs.map((d) => d.name));
  const noCanvas = new Set<Loc>();
  const toPct = (l: Len, axis: 0 | 1, loc: Loc): number => {
    if (l.unit === '%') return l.value;
    if (!ctx.canvas) {
      if (noCanvas.has(loc)) return 0;
      noCanvas.add(loc);
      ctx.error(loc, 'no-canvas', `Pixels need the size of the canvas they're measured on: add 'canvas: 1920x1080' (your art's size) to the header, or use percentages`);
      return 0;
    }
    return Math.round((l.value / ctx.canvas[axis]) * 100 * 1000) / 1000;
  };
  const picture = (a: AssetRef, loc: Loc): string => {
    if (a.kind === 'path') return a.path;
    const p = ctx.images[a.name];
    if (!p) ctx.error(loc, 'unknown-image', `No image named '${a.name}'. Declare it (image ${a.name} = "ui/${a.name}.png") or give the path in quotes`);
    return p ?? '';
  };

  for (const def of defs) {
    if (out[def.name]) { ctx.error(def.loc, 'duplicate', `'screen ${def.name}' is already defined`); continue; }
    const compileItem = (it: ScreenItem): CompiledScreenItem => {
      const c: CompiledScreenItem = { kind: it.kind };
      if (it.text !== undefined) {
        const m = parseMarkup(it.text);
        if (m.error) ctx.error(it.loc, 'bad-markup', m.error);
        c.id = ctx.textId(def.name, it.text);
        c.text = m.plain;
        if (m.styled) c.spans = m.spans;
        ctx.addString(c.id, it.text, it.loc);
        for (const m of it.text.matchAll(/\{\{|\}\}|\{\s*([A-Za-z_]\w*)\s*\}/g)) {
          if (m[1] && !known(m[1])) ctx.error(it.loc, 'unknown-variable', (SLOT_VARS as readonly string[]).includes(m[1]) ? `'{${m[1]}}' is only known inside 'slots'` : `Unknown variable '${m[1]}' in text`);
        }
      }
      for (const k of ['image', 'hover', 'pressed', 'selected', 'disabled', 'knob'] as const) {
        if (it[k]) c[k] = picture(it[k]!, it.loc);
      }
      if (TEXTBOX_PARTS.has(it.kind)) {
        if (def.name !== 'textbox') ctx.error(it.loc, 'bad-screen', `'${it.kind}' is part of the text box, so it goes in 'screen textbox'`);
        else if (parts.has(it.kind)) ctx.error(it.loc, 'bad-screen', `The text box has one '${it.kind}'`);
        parts.add(it.kind);
      }
      if (it.alt !== undefined) {
        c.alt = it.alt;
        c.id ??= ctx.textId(def.name, it.alt);
        ctx.addString(`${c.id}.alt`, it.alt, it.loc);
      }
      if (it.at) { c.x = toPct(it.at[0], 0, it.loc); c.y = toPct(it.at[1], 1, it.loc); }
      if (it.size) {
        if (it.size[0]) c.w = toPct(it.size[0], 0, it.loc);
        if (it.size[1]) c.h = toPct(it.size[1], 1, it.loc);
      }
      if (it.anchor && it.anchor !== 'top-left') c.anchor = ANCHOR_POINT[it.anchor];
      if (it.gap) c.gap = toPct(it.gap, 1, it.loc);
      if (it.className) c.className = it.className;
      if (it.count !== undefined) c.count = it.count;
      if (it.columns !== undefined) c.columns = it.columns;
      if (it.setting) c.setting = it.setting;
      if (it.character) {
        c.character = it.character;
        if (ctx.characters && !ctx.characters.has(it.character)) ctx.error(it.loc, 'unknown-character', `No character '${it.character}' (define it: define ${it.character} "Name")`);
      }
      if (it.call) {
        checkPluginCall(it.call, 'element', ctx.plugins, known, (code, message) => ctx.error(it.loc, code, message));
        c.plugin = it.call.plugin;
        c.element = it.call.name;
        c.args = it.call.args;
      }
      if (it.kind === 'log' && inLog) ctx.error(it.loc, 'bad-screen', `A log can't hold another log`);
      if (it.kind === 'thumbnail' && !inSlot) ctx.error(it.loc, 'bad-screen', `A thumbnail shows a save, so it goes inside 'slots'`);
      if (inSlot && (it.kind === 'button' || it.kind === 'slots' || it.kind === 'slider' || it.kind === 'toggle' || it.kind === 'choice')) {
        ctx.error(it.loc, 'bad-screen', `A slot is a button already, so it can't hold a ${it.kind}; put it next to the slots instead`);
      }
      if (it.kind === 'slots' && it.count! > ctx.saveSlots) {
        ctx.warn(it.loc, 'few-slots', `The game has ${ctx.saveSlots} save slots, so 'slots ${it.count}' can't fill a page; add 'save_slots: ${Math.max(it.count! * 5, 30)}' to the header`);
      }
      if (it.cond) {
        checkVars(it.cond, it.loc);
        c.cond = it.cond;
      }
      if (it.actions) {
        for (const a of it.actions) {
          if ((a.do === 'start' && a.label) || a.do === 'jump') {
            const label = a.do === 'start' ? a.label! : a.label;
            if (!ctx.labels.has(label)) ctx.error(it.loc, 'unknown-label', `No label named '${label}'`);
          } else if (a.do === 'open') {
            if (!names.has(a.screen) && !(BUILTIN_SCREENS as readonly string[]).includes(a.screen) && a.screen !== 'menu') {
              ctx.error(it.loc, 'unknown-screen', `No screen named '${a.screen}' (built in: ${BUILTIN_SCREENS.join(', ')})`);
            }
          } else if (a.do === 'set') {
            if (!Object.prototype.hasOwnProperty.call(ctx.vars, a.name)) ctx.error(it.loc, 'unknown-variable', `Unknown variable '${a.name}'. Declare it at the top: var ${a.name} = 0`);
            checkVars(a.value, it.loc);
          } else if (a.do === 'return' && a.value) {
            checkVars(a.value, it.loc);
          } else if (a.do === 'switch') {
            if (!names.has(a.screen) && !(BUILTIN_SCREENS as readonly string[]).includes(a.screen)) {
              ctx.error(it.loc, 'unknown-screen', `No screen named '${a.screen}' (built in: ${BUILTIN_SCREENS.join(', ')})`);
            }
          } else if (a.do === 'setting') {
            const bad = settingValueProblem(a.name, a.value);
            if (bad) ctx.error(it.loc, 'bad-screen', bad);
          } else if (a.do === 'rewind' && !inLog) {
            ctx.error(it.loc, 'bad-screen', `'rewind' goes back to a line of the log, so it goes on a button inside 'log'`);
          } else if (a.do === 'sample' && a.character && ctx.characters && !ctx.characters.has(a.character)) {
            ctx.error(it.loc, 'unknown-character', `No character '${a.character}'`);
          }
        }
        c.actions = it.actions;
      }
      if (it.children) {
        const was = inSlot, wasLog = inLog;
        if (it.kind === 'slots') inSlot = true;
        if (it.kind === 'log') inLog = true;
        c.children = it.children.map(compileItem);
        inSlot = was;
        inLog = wasLog;
      }
      return c;
    };
    let inSlot = false, inLog = false;
    const parts = new Set<ScreenKind>();
    const known = (name: string) => Object.prototype.hasOwnProperty.call(ctx.vars, name)
      || (PAGE_VARS as readonly string[]).includes(name) || (inSlot && (SLOT_VARS as readonly string[]).includes(name))
      || (def.name === 'textbox' && (TEXTBOX_VARS as readonly string[]).includes(name))
      || (def.name === 'confirm' && (CONFIRM_VARS as readonly string[]).includes(name))
      || (inLog && (LOG_VARS as readonly string[]).includes(name));
    const checkVars = (e: Expr, loc: Loc) => {
      for (const name of freeVars(e)) {
        if (!known(name)) ctx.error(loc, 'unknown-variable', (SLOT_VARS as readonly string[]).includes(name) ? `'${name}' is only known inside 'slots'` : `Unknown variable '${name}'`);
      }
      checkPluginFunctions(e, ctx.plugins, (code, message) => ctx.error(loc, code, message));
    };
    const compiled: CompiledScreen = { items: def.items.map(compileItem) };
    if (def.name === 'textbox' && !parts.has('dialogue')) ctx.error(def.loc, 'bad-screen', `The text box needs a 'dialogue': where the lines appear`);
    if (def.transition && def.transition.name !== 'none') {
      compiled.transition = def.transition.name;
      if (def.transition.duration !== undefined) compiled.duration = def.transition.duration;
    }
    out[def.name] = compiled;
  }
  return out;
}

/** What's wrong with `setting name value`, or null: toggles take on/off, sliders a number, choices one of their options. */
function settingValueProblem(name: string, value: string | number | boolean): string | null {
  const is = (k: keyof typeof SCREEN_SETTINGS) => (SCREEN_SETTINGS[k] as readonly string[]).includes(name);
  if (typeof value === 'boolean') return is('toggle') ? null : `'${name}' isn't on/off`;
  if (typeof value === 'number') return is('slider') ? null : `'${name}' isn't a number`;
  if (!is('choice')) return `'${name}' takes ${is('toggle') ? 'on or off' : 'a number'}`;
  const OPTIONS: Record<string, readonly string[] | null> = {
    font: ['serif', 'sans', 'legible', 'dyslexic'], animations: ['system', 'full', 'reduced'], skip: ['read', 'all'], language: null,
  };
  const ok = OPTIONS[name];
  return !ok || ok.includes(value) ? null : `'${name}' is one of: ${ok.join(', ')}`;
}

/** Whether a screen has a button that leaves it (returns, closes, or goes elsewhere), so the story can call it. */
export function screenCanLeave(def: ScreenDef): boolean {
  const LEAVES = new Set(['return', 'close', 'jump', 'start', 'title', 'quit', 'continue', 'yes', 'no']);
  const walk = (items: readonly ScreenItem[]): boolean =>
    items.some((it) => it.actions?.some((a) => LEAVES.has(a.do)) || (it.children ? walk(it.children) : false));
  return walk(def.items);
}

/** Labels the screens' buttons start a game at or jump to. */
export function screenTargets(defs: ScreenDef[]): string[] {
  const out: string[] = [];
  const walk = (items: ScreenItem[]) => {
    for (const it of items) {
      for (const a of it.actions ?? []) {
        if (a.do === 'jump') out.push(a.label);
        else if (a.do === 'start' && a.label) out.push(a.label);
      }
      if (it.children) walk(it.children);
    }
  };
  for (const d of defs) walk(d.items);
  return out;
}

/** How many save slots a game has: `save_slots:` in the header (3 by default, at most 300). */
export function saveSlotCount(v: string | undefined): number {
  const n = v && /^\d+$/.test(v) ? Number(v) : 3;
  return Math.min(300, Math.max(1, n));
}

/** `canvas: 1920x1080` → [1920, 1080]; null when absent or malformed. */
export function parseCanvas(v: string | undefined): [number, number] | null {
  const m = v ? /^\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\s*$/.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export type { Diagnostic };

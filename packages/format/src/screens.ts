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

// ------------------------------------------------------------------ syntax tree

export type ScreenKind =
  | 'image' | 'text' | 'button' | 'row' | 'column' | 'box'
  | 'slots' | 'thumbnail' | 'gallery' | 'endings' | 'achievements'
  | 'slider' | 'toggle' | 'choice';
export const SCREEN_KINDS: readonly ScreenKind[] = [
  'image', 'text', 'button', 'row', 'column', 'box',
  'slots', 'thumbnail', 'gallery', 'endings', 'achievements', 'slider', 'toggle', 'choice',
];
const CONTAINERS: ReadonlySet<ScreenKind> = new Set(['row', 'column', 'box']);

/**
 * Player settings a screen can show, by kind of control. Sliders are numbers,
 * toggles are on/off, choices pick one of a few options.
 */
export const SCREEN_SETTINGS = {
  slider: ['text_speed', 'auto_wait', 'music_volume', 'sound_volume', 'voice_volume', 'text_size', 'box_opacity'],
  toggle: ['skip_unread', 'animations', 'fullscreen'],
  choice: ['font', 'language', 'animations', 'skip'],
} as const;

/** Variables each cell of `slots` sees (besides the story's own). */
export const SLOT_VARS = ['slot_number', 'slot_empty', 'slot_date', 'slot_text'] as const;
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
  | { do: 'page'; to: 'next' | 'previous' | number };

export interface ScreenItem extends Trivia {
  kind: ScreenKind;
  /** Text of a `text`, label of a `button` (also its accessible name when it's a picture). */
  text?: string;
  /** The picture of an `image`, or of a picture `button`. */
  image?: AssetRef;
  /** A picture button's picture while pointed at or focused. */
  hover?: AssetRef;
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
  actions?: ScreenAction[];
  cond?: Expr;
  children?: ScreenItem[];
  loc: Loc;
}

export interface ScreenDef extends Trivia { name: string; items: ScreenItem[]; loc: Loc }

/** Screens Emaki has built in; a `screen` with one of these names replaces it. */
export const REPLACEABLE_SCREENS = ['title', 'menu', 'load', 'save', 'settings', 'extras'] as const;
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

const asset = (t: Token): AssetRef => (t.quoted ? { kind: 'path', path: t.text } : { kind: 'name', name: t.text });

function parseAction(src: string): ScreenAction | string {
  const words = src.trim().split(/\s+/).filter(Boolean);
  const [verb, arg, ...more] = words;
  const one = (a: ScreenAction): ScreenAction | string => (more.length ? `Unexpected '${more.join(' ')}' after '${verb} ${arg}'` : a);
  const none = (a: ScreenAction): ScreenAction | string => (arg !== undefined ? `'${verb}' takes nothing after it` : a);
  const name = (what: string): string | null => (arg && /^[A-Za-z_]\w*$/.test(arg) ? null : `'${verb}' needs ${what}`);
  switch (verb) {
    case 'start': return arg === undefined ? { do: 'start' } : name('a label') ?? one({ do: 'start', label: arg });
    case 'continue': return none({ do: 'continue' });
    case 'close': return none({ do: 'close' });
    case 'title': return none({ do: 'title' });
    case 'quit': return none({ do: 'quit' });
    case 'open': return name('a screen name, like open settings') ?? one({ do: 'open', screen: arg! });
    case 'jump': return name('a label') ?? one({ do: 'jump', label: arg! });
    case 'load': return none({ do: 'load' });
    case 'save': return none({ do: 'save' });
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
    default: return `Unknown action '${verb}' (use start, continue, open, close, title, quit, jump, set, return or page; load and save on slots)`;
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

  const tokens = tokenize(src);
  if (typeof tokens === 'string') return { error: tokens };
  const kind = tokens.shift()?.text as ScreenKind;
  if (!SCREEN_KINDS.includes(kind)) return { error: `Unknown screen element '${kind}' (use ${SCREEN_KINDS.join(', ')})` };
  item.kind = kind;
  if (kind !== 'slots' && CONTAINERS.has(kind) !== container) {
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
  } else if (kind === 'slots' || kind === 'gallery') {
    const n = tokens.shift()?.text;
    if (!n || !/^\d+$/.test(n) || Number(n) < 1 || Number(n) > MAX_CELLS) return { error: `Expected how many to show at once, like '${kind} 6' (1 to ${MAX_CELLS})` };
    item.count = Number(n);
  } else if (kind === 'slider' || kind === 'toggle' || kind === 'choice') {
    const label = tokens.shift();
    const setting = tokens.shift();
    const names = SCREEN_SETTINGS[kind] as readonly string[];
    if (!label?.quoted) return { error: `A ${kind} needs its label first (what it's for, and what screen readers say): ${kind} "Music" ${names[0]}` };
    if (!setting || setting.quoted || !names.includes(setting.text)) return { error: `A ${kind} controls one of: ${names.join(', ')}` };
    item.text = label.text;
    item.setting = setting.text;
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
      if (kind !== 'row' && kind !== 'column' && kind !== 'slots' && kind !== 'gallery') return { error: `Only rows, columns, slots and galleries have a gap between their elements` };
      item.gap = g;
    } else if (/^class=/.test(opt)) {
      const c = opt.slice('class='.length);
      if (!/^[A-Za-z_][\w-]*$/.test(c)) return { error: `'class=' needs a name for theme.css, like class=heading` };
      item.className = c;
    } else if (opt === 'image' || opt === 'hover') {
      if (kind !== 'button') return { error: `'${opt}' is for picture buttons` };
      const p = tokens.shift();
      if (!p || (!p.quoted && !/^[A-Za-z_]\w*$/.test(p.text))) return { error: `'${opt}' needs a picture: ${opt} "ui/button.png"` };
      if (opt === 'image') item.image = asset(p); else item.hover = asset(p);
    } else if (opt === 'columns') {
      const n = tokens.shift()?.text;
      if (kind !== 'slots' && kind !== 'gallery') return { error: `'columns' is for slots and gallery` };
      if (!n || !/^\d+$/.test(n) || Number(n) < 1 || Number(n) > item.count!) return { error: `'columns' needs how many across, from 1 to ${item.count}` };
      item.columns = Number(n);
    } else if (opt === 'alt') {
      const p = tokens.shift();
      if (kind !== 'image') return { error: `'alt' describes an image for screen readers` };
      if (!p?.quoted) return { error: `'alt' needs a description in quotes` };
      item.alt = p.text;
    } else {
      return { error: `Unexpected '${t.quoted ? `"${t.text}"` : t.text}' (options: at, size, anchor, gap, columns, class=, image, hover, alt)` };
    }
  }
  if (item.hover && !item.image) return { error: `A button with 'hover' needs its 'image' too` };
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
    case 'return': return a.value ? `return ${printExpr(a.value)}` : 'return';
    default: return a.do;
  }
}

/** One element's line, in canonical form. */
export function printScreenLine(it: ScreenItem): string {
  const parts: string[] = [it.kind];
  if (it.kind === 'image' && it.image) parts.push(assetText(it.image));
  if (it.count !== undefined) parts.push(String(it.count));
  if (it.columns !== undefined) parts.push('columns', String(it.columns));
  if (it.text !== undefined) parts.push(quote(it.text));
  if (it.setting) parts.push(it.setting);
  if (it.kind === 'button' && it.image) parts.push('image', assetText(it.image));
  if (it.hover) parts.push('hover', assetText(it.hover));
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
  cond?: Expr;
  actions?: ScreenAction[];
  children?: CompiledScreenItem[];
}

export interface CompiledScreen { items: CompiledScreenItem[] }

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
    if (def.name === 'history') {
      ctx.error(def.loc, 'reserved-screen', `The history screen can't be replaced yet; give yours another name`);
      continue;
    }
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
      if (it.image) c.image = picture(it.image, it.loc);
      if (it.hover) c.hover = picture(it.hover, it.loc);
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
          }
        }
        c.actions = it.actions;
      }
      if (it.children) {
        const was = inSlot;
        if (it.kind === 'slots') inSlot = true;
        c.children = it.children.map(compileItem);
        inSlot = was;
      }
      return c;
    };
    let inSlot = false;
    const known = (name: string) => Object.prototype.hasOwnProperty.call(ctx.vars, name)
      || (PAGE_VARS as readonly string[]).includes(name) || (inSlot && (SLOT_VARS as readonly string[]).includes(name));
    const checkVars = (e: Expr, loc: Loc) => {
      for (const name of freeVars(e)) {
        if (!known(name)) ctx.error(loc, 'unknown-variable', (SLOT_VARS as readonly string[]).includes(name) ? `'${name}' is only known inside 'slots'` : `Unknown variable '${name}'`);
      }
    };
    out[def.name] = { items: def.items.map(compileItem) };
  }
  return out;
}

/** Labels the screens' buttons start a game at or jump to. */
/** Whether a screen has a button that leaves it (returns, closes, or goes elsewhere), so the story can call it. */
export function screenCanLeave(def: ScreenDef): boolean {
  const LEAVES = new Set(['return', 'close', 'jump', 'start', 'title', 'quit', 'continue']);
  const walk = (items: readonly ScreenItem[]): boolean =>
    items.some((it) => it.actions?.some((a) => LEAVES.has(a.do)) || (it.children ? walk(it.children) : false));
  return walk(def.items);
}

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

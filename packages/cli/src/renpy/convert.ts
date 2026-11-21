/**
 * Ren'Py scripts to Emaki's: the common subset (characters, images, audio, variables, labels, dialogue, menus,
 * conditions, jumps and calls, scene/show/hide with transitions, music, sound and voice, pauses), in two passes:
 * first every file's declarations, then each file's story. What has no Emaki equivalent (Python blocks, screens,
 * ATL, custom statements) is kept as a `# renpy:` comment where it was and listed in the report.
 *
 * Positions follow Ren'Py's: a game is drawn on a fixed canvas, and `show x at t` places the picture at its own
 * size, so shown pictures become Emaki layers at a point (`at 640 720 anchor 50% 100% zoom 0.8`), worked out from
 * the game's transforms where they are plain enough (`xalign`, `xpos`, `xcenter`, `zoom`, transforms that call
 * other transforms with numbers).
 */
import type { RpyLine } from './lines.ts';
import { flatten } from './lines.ts';
import {
  callArgs, convertExpr, convertText, ident, IDENT, literal, numberValue, quote, readString, sayWhitespace, stringValue, varName,
} from './text.ts';

export interface RpyFile {
  /** Path in the Ren'Py game folder, with forward slashes (script.rpy, chapters/one.rpy). */
  path: string;
  lines: RpyLine[];
}

/** A picture the importer has to make: a composite of several files, or a solid colour. */
export type MadeImage =
  | { kind: 'composite'; size: [number, number]; parts: { at: [number, number]; path: string }[] }
  | { kind: 'solid'; color: string };

export interface ImageDecl {
  /** Emaki name: tag and attributes, each an identifier. */
  name: string;
  /** Its file in the Emaki game's assets/: the Ren'Py file's path (relative to game/), or one the importer makes. */
  asset: string;
  /** A picture to make into `asset`. */
  made?: MadeImage;
}

export interface Issue { file: string; line: number; text: string; why: string }

export interface Assets {
  /** Does this file exist in the Ren'Py game folder (relative to game/)? */
  exists(rel: string): boolean;
  /** Pictures in game/images/, for Ren'Py's automatic image names. */
  imageFiles: string[];
}

export interface Converted {
  /** story.vn: the header and every declaration. */
  story: string;
  /** Each script's labels, by the Emaki file's path (scripts/script.vn). */
  files: Record<string, string>;
  /** Emaki file path → Ren'Py file path, for the report. */
  sources: Record<string, string>;
  images: ImageDecl[];
  issues: Issue[];
  /** Kinds of things dropped, with how many times. */
  counts: Record<string, number>;
  canvas: [number, number] | null;
  title: string | null;
}

interface Character { id: string; name: string; color: string | null; nvl: boolean }
interface Var { value: string; kind: 'number' | 'string' | 'bool'; global: boolean; declared: boolean; from?: string }
/** A layer's placement on the canvas: points in pixels (numbers) or fractions (strings ending in %). */
interface Place { x?: string; y?: string; ax?: number; ay?: number; zoom?: number; alpha?: number }
interface TransformDef { params: { name: string; value: string | null }[]; body: RpyLine[] }

const CHANNELS: Record<string, string> = { music: 'music', sound: 'sound', voice: 'voice', audio: 'sound', ambience: 'ambience' };
const MOVE_TRANSITIONS = new Set(['move', 'ease']);
/** Ren'Py's own transitions with no Emaki equivalent: a dissolve of about their length. */
const APPROX_TRANSITIONS: Record<string, number> = {
  pixellate: 1, zoomin: 0.5, zoomout: 0.5, zoominout: 0.5, vpunch: 0, hpunch: 0, blinds: 1, squares: 1,
  wipeleft: 1, wiperight: 1, wipeup: 1, wipedown: 1, slideleft: 1, slideright: 1, slideup: 1, slidedown: 1,
  slideawayleft: 1, slideawayright: 1, slideawayup: 1, slideawaydown: 1, pushleft: 1, pushright: 1, pushup: 1, pushdown: 1,
  irisin: 1, irisout: 1, moveinleft: 0.5, moveinright: 0.5, moveintop: 0.5, moveinbottom: 0.5,
  moveoutleft: 0.5, moveoutright: 0.5, moveouttop: 0.5, moveoutbottom: 0.5,
  easeinleft: 0.5, easeinright: 0.5, easeintop: 0.5, easeinbottom: 0.5, easeoutleft: 0.5, easeoutright: 0.5, easeouttop: 0.5, easeoutbottom: 0.5,
};
/** Ren'Py's built-in positions. */
const BUILTIN_PLACES: Record<string, Place> = {
  left: { x: '0%', ax: 0, y: '100%', ay: 100 },
  right: { x: '100%', ax: 100, y: '100%', ay: 100 },
  center: { x: '50%', ax: 50, y: '100%', ay: 100 },
  default: { x: '50%', ax: 50, y: '100%', ay: 100 },
  truecenter: { x: '50%', ax: 50, y: '50%', ay: 50 },
  topleft: { x: '0%', ax: 0, y: '0%', ay: 0 },
  top: { x: '50%', ax: 50, y: '0%', ay: 0 },
  topright: { x: '100%', ax: 100, y: '0%', ay: 0 },
  offscreenleft: { x: '0%', ax: 100, y: '100%', ay: 100 },
  offscreenright: { x: '100%', ax: 0, y: '100%', ay: 100 },
};
const DEFAULT_PLACE = BUILTIN_PLACES.default!;

/** Split at top-level whitespace (strings and brackets stay whole). */
export function words(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"' || c === "'" || c === '`') {
      const r = readString(s, i);
      if (r) { cur += s.slice(i, r.end); i = r.end - 1; continue; }
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (/\s/.test(c) && depth === 0) { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

const firstWord = (t: string) => /^[$A-Za-z_][\w]*/.exec(t)?.[0] ?? (t.startsWith('$') ? '$' : '');

export function convertRenpy(files: RpyFile[], assets: Assets): Converted {
  const issues: Issue[] = [];
  const counts: Record<string, number> = {};
  const count = (what: string) => { counts[what] = (counts[what] ?? 0) + 1; };
  const characters = new Map<string, Character>(); // Ren'Py variable → character
  const charIds = new Set<string>();
  const images = new Map<string, ImageDecl>();
  const audio = new Map<string, string>(); // Emaki name → path
  const vars = new Map<string, Var>();
  const used = new Map<string, 'number' | 'string' | 'bool' | null>(); // variables the story reads or sets
  const transitions = new Map<string, string>(); // name → expression source
  const transforms = new Map<string, TransformDef>();
  const placeDefs = new Map<string, Place>(); // define x = Position(...) / Transform(...)
  const labels = new Set<string>();
  let title: string | null = null;
  let narratorNvl = false;
  let version: string | null = null;
  let canvas: [number, number] | null = null;
  let file = '';
  const issue = (line: number, text: string, why: string) => { issues.push({ file, line, text, why }); };

  // ---------------------------------------------------------------- pass 1: declarations

  const resolvePath = (p: string, kind: 'image' | 'audio' | 'any'): string | null => {
    const clean = p.replace(/^<[^>]*>/, '').replace(/\\/g, '/').replace(/^\/+/, '');
    const tries = [clean, ...(kind !== 'audio' ? [`images/${clean}`] : []), ...(kind !== 'image' ? [`audio/${clean}`] : [])];
    for (const t of tries) if (assets.exists(t)) return t;
    return null;
  };

  const imageName = (ws: string[]) => ws.map((w) => ident(w)).join(' ');
  const madeAsset = (name: string) => `imported/${name.replace(/ /g, '_')}.png`;

  const declareImage = (nameWords: string[], expr: string | null, block: RpyLine[], line: number, raw: string) => {
    const name = imageName(nameWords);
    let decl: ImageDecl | null = null;
    if (expr !== null) {
      const s = expr.trim();
      const str = stringValue(s);
      const call = callArgs(s);
      if (str !== null) {
        if (/^#[0-9a-f]{3,8}$/i.test(str)) decl = { name, asset: madeAsset(name), made: { kind: 'solid', color: str } };
        else {
          const path = resolvePath(str, 'image');
          if (path) decl = { name, asset: path };
          else if (images.has(imageName(str.split(/\s+/)))) decl = { ...images.get(imageName(str.split(/\s+/)))!, name };
        }
      } else if (call && (call.name === 'Image' || call.name === 'im.Image') && stringValue(call.args[0]) !== null) {
        const path = resolvePath(stringValue(call.args[0])!, 'image');
        if (path) decl = { name, asset: path };
      } else if (call && call.name === 'Solid' && stringValue(call.args[0])) {
        decl = { name, asset: madeAsset(name), made: { kind: 'solid', color: stringValue(call.args[0])! } };
      } else if (call && ['im.Composite', 'LiveComposite', 'Composite'].includes(call.name)) {
        // Parts may name images declared further on: made once every image is known.
        pendingComposites.push({ name, args: call.args, line, raw, file });
        return;
      }
    } else {
      // An ATL image: its first picture, still, once every image is known (it may name one).
      pendingAtl.push({ name, block, line, raw, file });
      return;
    }
    if (decl) images.set(name, decl);
    else issue(line, raw, 'image the importer can’t make (only files, Image(), Solid() and Composite/im.Composite of files)');
  };

  const pendingComposites: { name: string; args: string[]; line: number; raw: string; file: string }[] = [];
  const pendingAtl: { name: string; block: RpyLine[]; line: number; raw: string; file: string }[] = [];
  /** The first picture an ATL block shows: a file, or an image declared with one. */
  const firstFrame = (block: RpyLine[]): ImageDecl | null => {
    for (const l of flatten(block)) {
      const str = stringValue(words(l.text)[0]);
      if (str === null) continue;
      const path = resolvePath(str, 'image');
      if (path) return { name: '', asset: path };
      const named = images.get(imageName(str.trim().split(/\s+/)));
      if (named) return named;
    }
    return null;
  };

  /** im.Composite((w, h), (x, y), part, ...): every part a file, or an image made from a file. */
  const composite = (args: string[]): MadeImage | null => {
    const tuple = (s: string | undefined) => {
      const m = /^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/.exec((s ?? '').trim());
      return m ? [Number(m[1]), Number(m[2])] as [number, number] : null;
    };
    const size = tuple(args[0]);
    if (!size) return null;
    const parts: { at: [number, number]; path: string }[] = [];
    for (let i = 1; i + 1 < args.length + 1 && i < args.length; i += 2) {
      const at = tuple(args[i]);
      let src = args[i + 1];
      const im = src ? callArgs(src) : null;
      if (im && (im.name === 'Image' || im.name === 'im.Image')) src = im.args[0];
      const str = stringValue(src);
      let path = str !== null ? resolvePath(str, 'image') : null;
      if (str !== null && !path) {
        const named = images.get(imageName(str.trim().split(/\s+/)));
        if (named && !named.made) path = named.asset;
      }
      if (!at || !path) return null;
      parts.push({ at, path });
    }
    return parts.length ? { kind: 'composite', size, parts } : null;
  };

  const declareCharacter = (rpyName: string, src: string, line: number, raw: string) => {
    const call = callArgs(src);
    if (!call || !['Character', 'DynamicCharacter', 'ADVCharacter', 'NVLCharacter'].includes(call.name)) return false;
    if (rpyName === 'narrator' || rpyName === 'centered' || rpyName === 'nvl_narrator') {
      if (rpyName === 'narrator') narratorNvl = call.name === 'NVLCharacter' || (call.kwargs.kind ?? '').trim() === 'nvl';
      count('narrator styling');
      return true;
    }
    let name: string;
    const first = call.args[0];
    const dynamic = call.name === 'DynamicCharacter' || /^True$/.test(call.kwargs.dynamic ?? '');
    if (dynamic && first) {
      const v = stringValue(first) ?? first.trim();
      const vn = varName(v);
      if (!vn) { issue(line, raw, 'a character whose name is worked out by Python'); name = rpyName; }
      else { name = `{${vn}}`; noteUse(vn, 'string'); }
    } else {
      const s = first === undefined || first.trim() === 'None' ? '' : stringValue(first);
      if (s === null) { issue(line, raw, 'a character whose name is worked out by Python'); name = rpyName; }
      else {
        const t = convertText(s);
        name = t.text;
        for (const v of t.vars) noteUse(v, 'string');
      }
    }
    const colorSrc = stringValue(call.kwargs.color ?? call.kwargs.who_color);
    const color = colorSrc && /^#?[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(colorSrc) ? (colorSrc.startsWith('#') ? colorSrc : `#${colorSrc}`) : null;
    // Emaki finds a speaker's sprite by their id, so a character drawn as another tag (image='sylvie') takes that name.
    const tag = stringValue(call.kwargs.image);
    let id = ident(tag && !charIds.has(ident(tag)) ? tag : rpyName);
    while (charIds.has(id)) id += '_';
    charIds.add(id);
    const nvl = call.name === 'NVLCharacter' || (call.kwargs.kind ?? '').trim() === 'nvl';
    characters.set(rpyName, { id, name, color, nvl });
    if (call.kwargs.what_prefix || call.kwargs.what_suffix) count('text before and after lines (what_prefix, what_suffix)');
    if (call.kwargs.ctc) count('click-to-continue indicators (ctc)');
    return true;
  };

  const noteUse = (name: string, kind: 'number' | 'string' | 'bool' | null) => {
    if (!used.has(name) || used.get(name) === null) used.set(name, kind);
  };

  const declareVar = (target: string, src: string, global: boolean, line: number, raw: string) => {
    const name = varName(target);
    if (!name) { issue(line, raw, 'a variable Emaki can’t hold (only names and persistent.name)'); return; }
    const lit = literal(src);
    const isGlobal = global || target.startsWith('persistent.');
    if (lit) vars.set(name, { value: lit.value, kind: lit.kind, global: isGlobal, declared: true });
    else if (varName(src.trim())) {
      // Another variable's value: its starting value (worked out once all are known).
      vars.set(name, { value: '0', kind: 'number', global: isGlobal, declared: true, from: varName(src.trim())! });
    } else {
      vars.set(name, { value: '0', kind: 'number', global: isGlobal, declared: true });
      issue(line, raw, 'a starting value Emaki can’t hold (a list, a dict or a call): starts at 0 (or "" for text) instead');
    }
  };

  const define = (text: string, line: number, isDefault: boolean) => {
    const m = /^(?:define|default)\s+(?:-?\d+\s+)?([\w.]+)\s*(=|\+=|\|=)\s*([\s\S]+)$/.exec(text);
    if (!m) { issue(line, text, 'a define the importer can’t read'); return; }
    const [, target, , src] = m as unknown as [string, string, string, string];
    if (target.startsWith('config.') || target.startsWith('gui.') || target.startsWith('build.') || target.startsWith('_')) {
      if (target === 'config.name') title = stringValue(src) ?? title;
      else if (target === 'config.version') version = stringValue(src) ?? version;
      else if (target === 'config.screen_width') canvas = [numberValue(src) ?? canvas?.[0] ?? 0, canvas?.[1] ?? 0];
      else if (target === 'config.screen_height') canvas = [canvas?.[0] ?? 0, numberValue(src) ?? canvas?.[1] ?? 0];
      count('engine settings (config, gui, build)');
      return;
    }
    if (target.startsWith('audio.')) {
      const p = stringValue(src);
      const path = p !== null ? resolvePath(p, 'audio') : null;
      if (path) audio.set(ident(target.slice('audio.'.length)), path);
      else issue(line, text, 'a sound whose file isn’t in the game folder');
      if (p && /^</.test(p)) count('sound options (<loop>, <from>)');
      return;
    }
    if (!isDefault && target === 'narrator' && src.trim() === 'nvl_narrator') { narratorNvl = true; return; }
    if (!isDefault && declareCharacter(target, src, line, text)) return;
    const call = callArgs(src);
    if (!isDefault && call && /^(Dissolve|Fade|ImageDissolve|AlphaDissolve|MultipleTransition|ComposeTransition|Pixellate|MoveTransition|CropMove|PushMove|Swing)$/.test(call.name)) {
      transitions.set(target, src);
      return;
    }
    if (!isDefault && (IDENT.test(src.trim()) && (transitions.has(src.trim()) || APPROX_TRANSITIONS[src.trim()] !== undefined || ['dissolve', 'fade', 'None', 'move', 'ease'].includes(src.trim())))) {
      transitions.set(target, src.trim());
      return;
    }
    if (!isDefault && call && (call.name === 'Position' || call.name === 'Transform')) {
      placeDefs.set(target, placeFromProps(Object.entries(call.kwargs).map(([k, v]) => [k, v]), new Map()));
      return;
    }
    declareVar(target, src, false, line, text);
  };

  const transformHead = (text: string): { name: string; params: { name: string; value: string | null }[] } | null => {
    const m = /^transform\s+([\w.]+)\s*(?:\(([\s\S]*)\))?\s*:$/.exec(text);
    if (!m) return null;
    const params = (m[2] ?? '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      const [n, v] = p.split('=', 2);
      return { name: n!.trim(), value: v?.trim() ?? null };
    });
    return { name: m[1]!, params };
  };

  const declarations = (lines: RpyLine[], init: boolean) => {
    for (const l of lines) {
      const w = firstWord(l.text);
      if (w === 'init') {
        if (/^init(\s+-?\d+)?(\s+python)?\b.*:$/.test(l.text) && /\bpython\b/.test(l.text)) pythonDecls(l.block, l.line);
        else declarations(l.block, true);
      } else if (w === 'define' || w === 'default') define(l.text, l.line, w === 'default');
      else if (w === 'image') {
        const m = /^image\s+([^=:]+?)\s*(?:=\s*([\s\S]+)|:)$/.exec(l.text);
        if (m) declareImage(m[1]!.trim().split(/\s+/), m[2] ?? null, l.block, l.line, l.text);
        else issue(l.line, l.text, 'an image the importer can’t read');
      } else if (w === 'transform') {
        const h = transformHead(l.text);
        if (h) transforms.set(h.name, { params: h.params, body: l.block });
      } else if (w === 'label') {
        const m = /^label\s+([\w.]+)/.exec(l.text);
        if (m) labels.add(m[1]!);
        declarations(l.block, init);
      } else if (w === 'python' && init) pythonDecls(l.block, l.line);
      else if (l.block.length && w !== 'screen' && w !== 'python' && w !== 'style' && w !== 'translate') declarations(l.block, init);
    }
  };

  /** What an `init python:` block sets that the importer understands: the screen size. */
  const pythonDecls = (block: RpyLine[], _line: number) => {
    for (const l of flatten(block)) {
      const g = /\bgui\.init\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(l.text);
      if (g) canvas = [Number(g[1]), Number(g[2])];
      const sw = /^config\.screen_width\s*=\s*(\d+)/.exec(l.text);
      if (sw) canvas = [Number(sw[1]), canvas?.[1] ?? 0];
      const sh = /^config\.screen_height\s*=\s*(\d+)/.exec(l.text);
      if (sh) canvas = [canvas?.[0] ?? 0, Number(sh[1])];
    }
  };

  for (const f of files) { file = f.path; declarations(f.lines, false); }
  for (const p of pendingComposites) {
    file = p.file;
    const made = composite(p.args);
    if (made) images.set(p.name, { name: p.name, asset: madeAsset(p.name), made });
    else issue(p.line, p.raw, 'image the importer can’t make (only files, Image(), Solid() and Composite/im.Composite of files)');
  }
  // Twice: an animated image may show another.
  for (let pass = 0; pass < 2; pass++) {
    for (const p of pendingAtl) {
      if (images.has(p.name)) continue;
      const frame = firstFrame(p.block);
      if (frame) { images.set(p.name, { ...frame, name: p.name }); count('animated images shown still (ATL)'); }
      else if (pass === 1) { file = p.file; issue(p.line, p.raw, 'an animated image (ATL) with no picture file to show still'); }
    }
  }
  // Ren'Py names pictures in images/ by their file names ("eileen happy.png" is `eileen happy`).
  for (const rel of assets.imageFiles) {
    const base = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();
    const name = imageName(base.split(/[\s]+/).filter(Boolean));
    if (!images.has(name)) images.set(name, { name, asset: `images/${rel}` });
  }
  if (canvas && (!canvas[0] || !canvas[1])) canvas = null;
  const screen: [number, number] = canvas ?? [1280, 720];

  // ---------------------------------------------------------------- positions

  /** A number, a parameter, or arithmetic of them. */
  function evaluate(src: string, env: Map<string, number>): number | null {
    const toks = src.replace(/\s+/g, '').match(/\d*\.\d+|\d+|[A-Za-z_]\w*|[-+*/()]/g);
    if (!toks || toks.join('') !== src.replace(/\s+/g, '')) return null;
    let i = 0;
    const atom = (): number | null => {
      const t = toks[i++];
      if (t === undefined) return null;
      if (t === '(') { const v = sum(); i++; return v; }
      if (t === '-') { const v = atom(); return v === null ? null : -v; }
      if (/^[\d.]/.test(t)) return Number(t);
      return env.has(t) ? env.get(t)! : null;
    };
    const product = (): number | null => {
      let v = atom();
      while (v !== null && (toks[i] === '*' || toks[i] === '/')) { const op = toks[i++]; const r = atom(); if (r === null) return null; v = op === '*' ? v * r : v / r; }
      return v;
    };
    const sum = (): number | null => {
      let v = product();
      while (v !== null && (toks[i] === '+' || toks[i] === '-')) { const op = toks[i++]; const r = product(); if (r === null) return null; v = op === '+' ? v + r : v - r; }
      return v;
    };
    const v = sum();
    return i === toks.length ? v : null;
  }

  /** A Ren'Py position value: a float is a fraction of the screen, an int pixels. */
  function coord(src: string, env: Map<string, number>): string | undefined {
    const v = evaluate(src, env);
    if (v === null) return undefined;
    const isFloat = /\./.test(src) || (!/^-?\d+$/.test(src.trim()) && !Number.isInteger(v)) || (src.trim() !== String(v) && v > -1 && v < 1 && !Number.isInteger(v));
    return isFloat ? `${round(v * 100)}%` : String(round(v));
  }
  function anchor(src: string, env: Map<string, number>, size?: number): number | undefined {
    const v = evaluate(src, env);
    if (v === null) return undefined;
    if (/\./.test(src) || (v >= 0 && v <= 1 && !/^\d+$/.test(src.trim()))) return round(v * 100);
    return size ? round((v / size) * 100) : undefined;
  }

  function placeFromProps(props: [string, string][], env: Map<string, number>): Place {
    const p: Place = {};
    for (const [k, v] of props) {
      if (k === 'xalign') { p.x = coord(v.includes('.') ? v : `${v}.0`, env) ?? p.x; p.ax = anchor(v.includes('.') ? v : `${v}.0`, env) ?? p.ax; }
      else if (k === 'yalign') { p.y = coord(v.includes('.') ? v : `${v}.0`, env) ?? p.y; p.ay = anchor(v.includes('.') ? v : `${v}.0`, env) ?? p.ay; }
      else if (k === 'xpos') p.x = coord(v, env) ?? p.x;
      else if (k === 'ypos') p.y = coord(v, env) ?? p.y;
      else if (k === 'xcenter') { p.x = coord(v, env) ?? p.x; p.ax = 50; }
      else if (k === 'ycenter') { p.y = coord(v, env) ?? p.y; p.ay = 50; }
      else if (k === 'xanchor') p.ax = anchor(v, env) ?? p.ax;
      else if (k === 'yanchor') p.ay = anchor(v, env) ?? p.ay;
      else if (k === 'zoom') { const z = evaluate(v, env); if (z !== null) p.zoom = round(z); }
      else if (k === 'alpha') { const a = evaluate(v, env); if (a !== null) p.alpha = round(a); }
      else if (k === 'pos' || k === 'align' || k === 'anchor' || k === 'center') {
        const m = /^\(\s*([^,]+),\s*([^)]+)\)$/.exec(v.trim());
        if (m) {
          const pre = k === 'center' ? ['xcenter', 'ycenter'] : [`x${k}`, `y${k}`];
          Object.assign(p, placeFromProps([[pre[0]!, m[1]!], [pre[1]!, m[2]!]], env));
        }
      }
    }
    return p;
  }

  /** ATL property lines: `name value` pairs, after any warper and time (`easein .25 xcenter x zoom 1.0`). */
  const atlProps = (text: string): [string, string][] => {
    const ws = words(text);
    const out: [string, string][] = [];
    let i = 0;
    if (ws[0] && /^(linear|ease|easein|easeout|ease_\w+|warp|pause|time)$/.test(ws[0])) i = ws[0] === 'warp' ? 3 : 2;
    for (; i + 1 < ws.length; i += 2) out.push([ws[i]!, ws[i + 1]!]);
    return out;
  };

  const placeCache = new Map<string, Place | null>();
  /** Where `at t` / `at t(1, 2)` puts a picture, as far as its transform says plainly; null when it doesn't. */
  function placeOf(src: string, depth = 0): Place | null {
    const s = src.trim();
    if (BUILTIN_PLACES[s]) return BUILTIN_PLACES[s]!;
    if (placeDefs.has(s)) return { ...DEFAULT_PLACE, ...placeDefs.get(s)! };
    if (depth > 8) return null;
    const call = callArgs(s);
    const name = call ? call.name : s;
    if (call && (name === 'Position' || name === 'Transform')) return { ...DEFAULT_PLACE, ...placeFromProps(Object.entries(call.kwargs), new Map()) };
    const t = transforms.get(name);
    if (!t) return null;
    const key = s;
    if (!call && placeCache.has(key)) return placeCache.get(key)!;
    const env = new Map<string, number>();
    t.params.forEach((p, i) => {
      const given = call?.args[i] ?? call?.kwargs[p.name] ?? p.value;
      const v = given !== null && given !== undefined ? evaluate(given, env) : null;
      if (v !== null) env.set(p.name, v);
    });
    let place: Place = { ...DEFAULT_PLACE };
    let found = false;
    const visit = (lines: RpyLine[]) => {
      for (const l of lines) {
        const head = words(l.text)[0] ?? '';
        if (/^on$/.test(head) && /\bhide\b/.test(l.text)) continue; // how it leaves, not where it stays
        if (l.block.length) { visit(l.block); continue; }
        const inner = callArgs(l.text);
        if (inner && transforms.has(inner.name)) {
          // Arguments may use this transform's parameters.
          const args = inner.args.map((a) => { const v = evaluate(a, env); return v === null ? a : String(v); });
          const kw = Object.entries(inner.kwargs).map(([k, a]) => { const v = evaluate(a, env); return `${k}=${v === null ? a : v}`; });
          const sub = placeOf(`${inner.name}(${[...args, ...kw].join(', ')})`, depth + 1);
          if (sub) { place = { ...place, ...sub }; found = true; }
          continue;
        }
        if (transforms.has(l.text.trim()) || BUILTIN_PLACES[l.text.trim()]) {
          const sub = placeOf(l.text.trim(), depth + 1);
          if (sub) { place = { ...place, ...sub }; found = true; }
          continue;
        }
        const props = atlProps(l.text).filter(([k]) => /^(x|y)(align|pos|center|anchor)$|^(pos|align|anchor|center|zoom|alpha)$/.test(k));
        if (props.length) { place = { ...place, ...placeFromProps(props, env) }; found = true; }
      }
    };
    visit(t.body);
    const result = found ? place : null;
    if (!call) placeCache.set(key, result);
    return result;
  }

  const placeText = (p: Place): string => {
    const parts = [`at ${p.x ?? '50%'} ${p.y ?? '100%'}`, `anchor ${p.ax ?? 50}% ${p.ay ?? 100}%`];
    if (p.zoom !== undefined && p.zoom !== 1) parts.push(`zoom ${p.zoom}`);
    if (p.alpha !== undefined && p.alpha !== 1) parts.push(`opacity ${Math.max(0, Math.min(1, p.alpha))}`);
    return parts.join(' ');
  };

  // ---------------------------------------------------------------- transitions

  interface Trans { with?: string; wipe?: string; effect?: 'shake' | 'flash'; approx?: boolean }
  function transition(src: string, depth = 0): Trans | null {
    const s = src.trim();
    if (s === 'None') return {};
    if (s === 'dissolve') return { with: 'dissolve 0.5' };
    if (s === 'fade') return { with: 'fade 1' };
    if (MOVE_TRANSITIONS.has(s)) return { with: 'move' };
    if (s === 'vpunch' || s === 'hpunch') return { effect: 'shake' };
    if (s === 'flash') return { effect: 'flash' };
    if (APPROX_TRANSITIONS[s] !== undefined) return { with: `dissolve ${APPROX_TRANSITIONS[s]}`, approx: true };
    if (transitions.has(s) && depth < 8) return transition(transitions.get(s)!, depth + 1);
    const call = callArgs(s);
    if (call) {
      const n = (i: number) => numberValue(call.args[i] ?? call.kwargs[['time', 'hold', 'in_time'][i] ?? ''] );
      if (call.name === 'Dissolve' || call.name === 'AlphaDissolve' || call.name === 'Pixellate') return { with: `dissolve ${round(n(0) ?? 0.5)}`, approx: call.name !== 'Dissolve' };
      if (call.name === 'Fade') {
        const out = numberValue(call.args[0] ?? call.kwargs.out_time) ?? 0.5;
        const hold = numberValue(call.args[1] ?? call.kwargs.hold_time) ?? 0;
        const inn = numberValue(call.args[2] ?? call.kwargs.in_time) ?? out;
        const color = stringValue(call.kwargs.color);
        if (color && /^#?f{3,6}$/i.test(color) && out + hold + inn <= 1) return { effect: 'flash' };
        return { with: `fade ${round(out + hold + inn)}` };
      }
      if (call.name === 'ImageDissolve') {
        const rule = stringValue(call.args[0]);
        const path = rule !== null ? resolvePath(rule, 'image') : null;
        const t = numberValue(call.args[1] ?? call.kwargs.time) ?? 0.5;
        if (path) return { wipe: `wipe ${quote(path)} ${round(t)}` };
        return { with: `dissolve ${round(t)}`, approx: true };
      }
      if (call.name === 'MoveTransition') return { with: `move ${round(numberValue(call.args[0]) ?? 0.5)}` };
      if (call.name === 'MultipleTransition' || call.name === 'ComposeTransition') return { with: 'dissolve 0.5', approx: true };
    }
    return null;
  }

  // ---------------------------------------------------------------- pass 2: the story

  const out: string[] = [];
  const pad = (depth: number) => '  '.repeat(depth);
  const emit = (depth: number, s: string) => { out.push(pad(depth) + s); };
  const comment = (depth: number, lines: { text: string; depth: number }[]) => {
    for (const l of lines) for (const part of l.text.split(/\r?\n/)) emit(depth + Math.floor(l.depth / 4), `# renpy: ${part}`);
  };
  const skip = (depth: number, l: RpyLine, why: string) => {
    issue(l.line, l.text, why);
    comment(depth, flatten([l]).map((x) => ({ text: x.text, depth: x.depth })));
  };

  /** Per label: what's on screen and in which mode, as far as one pass through the lines can tell. */
  interface Flow { shown: Set<string> | null; nvl: boolean; global: string }
  let lastSay = -1;

  const charFor = (who: string, line: number, raw: string): Character | null => {
    if (characters.has(who)) return characters.get(who)!;
    if (!IDENT.test(who)) return null;
    // Undeclared: a character called by its name, like Ren'Py's fallback.
    const id = ident(who);
    const c: Character = { id: charIds.has(id) ? `${id}_` : id, name: who, color: null, nvl: false };
    charIds.add(c.id);
    characters.set(who, c);
    issue(line, raw, `'${who}' speaks without a Character(): declared with its name as written`);
    return c;
  };
  const literalSpeakers = new Map<string, Character>();
  const speakerNamed = (name: string): Character => {
    if (literalSpeakers.has(name)) return literalSpeakers.get(name)!;
    let id = ident(`speaker_${name.toLowerCase()}`);
    while (charIds.has(id)) id += '_';
    charIds.add(id);
    const t = convertText(name);
    for (const v of t.vars) noteUse(v, 'string');
    const c: Character = { id, name: t.text, color: null, nvl: false };
    literalSpeakers.set(name, c);
    characters.set(`"${name}"`, c);
    return c;
  };

  const textOf = (value: string): string => {
    const t = convertText(sayWhitespace(value));
    for (const v of t.vars) noteUse(v, 'string');
    for (const d of t.dropped) count(`text tags and interpolations without an Emaki equivalent (${d.startsWith('{') ? d.replace(/=.*$/, '=…}').replace(/\}?$/, '}').replace(/\}\}$/, '}') : '[expression]'})`);
    return t.text;
  };

  const withLines = (depth: number, src: string | null, line: number, raw: string): { inline: string; after: string[] } => {
    if (!src) return { inline: '', after: [] };
    const t = transition(src);
    if (!t) { issue(line, raw, `transition '${src}' the importer doesn’t know: shown without it`); return { inline: '', after: [] }; }
    if (t.approx) count(`transitions shown as a dissolve (${src.replace(/\(.*$/, '')})`);
    if (t.effect) return { inline: '', after: [t.effect] };
    if (t.wipe) return { inline: '', after: [`with ${t.wipe}`] };
    return { inline: t.with ? ` with ${t.with}` : '', after: [] };
  };

  /** A say statement, or null when the line isn't one. */
  const say = (l: RpyLine, depth: number, flow: Flow): boolean => {
    const t = l.text;
    let who: string | null = null;
    let attrs: string[] = [];
    let what: { value: string; end: number } | null = null;
    if (/^[rRuU]?["'`]/.test(t)) {
      const first = readString(t, 0);
      if (!first) return false;
      const rest = t.slice(first.end).trimStart();
      const second = /^[rRuU]?["'`]/.test(rest) ? readString(rest, 0) : null;
      if (second) { who = `"${first.value}"`; what = { value: second.value, end: t.length - rest.length + second.end }; }
      else what = first;
    } else {
      const m = /^([A-Za-z_][\w.]*)((?:\s+[@-]?[\w-]+)*)\s+(?=[rRuU]?["'`])/.exec(t);
      if (!m) return false;
      who = m[1]!;
      attrs = m[2]!.trim().split(/\s+/).filter((a) => a && a !== '@');
      what = readString(t, m[0].length);
      if (!what) return false;
      what = { value: what.value, end: what.end };
    }
    const after = words(t.slice(what.end));
    let withSrc: string | null = null;
    for (let i = 0; i < after.length; i++) {
      if (after[i] === 'with') withSrc = after[++i] ?? null;
      else if (after[i] === 'id') i++;
      else if (after[i] === 'nointeract') count('lines that don’t wait (nointeract)');
      else if (after[i]!.startsWith('(')) count('say arguments');
    }
    const text = textOf(what.value);
    if (who === 'extend') {
      // Ren'Py adds to the line before, after a click.
      if (lastSay >= 0 && lastSay === out.length - 1) {
        out[lastSay] = `${out[lastSay]!.slice(0, -1)}[w] ${quote(text).slice(1)}`;
        return true;
      }
      who = null;
    }
    const w = withLines(depth, withSrc, l.line, t);
    let speaker: Character | null = null;
    if (who && who !== 'narrator' && who !== 'centered' && who !== 'nvl_narrator' && who !== 'extend') {
      speaker = who.startsWith('"') ? speakerNamed(JSON.parse(who.replace(/\\'/g, "'")) as string) : charFor(who, l.line, t);
      if (!speaker) return false;
    }
    if (who === 'centered') count('centered text (shown as narration)');
    const nvl = speaker ? speaker.nvl : who === 'nvl_narrator' || narratorNvl;
    if (nvl !== flow.nvl) { emit(depth, nvl ? 'nvl on' : 'nvl off'); flow.nvl = nvl; }
    for (const a of w.after) if (a.startsWith('with')) emit(depth, a);
    if (w.inline) emit(depth, `with${w.inline.slice(' with'.length)}`);
    for (const a of w.after) if (!a.startsWith('with')) emit(depth, a);
    const attrText = speaker ? attrs.filter((a) => !a.startsWith('-')).map((a) => ident(a)).join(' ') : '';
    emit(depth, speaker ? `${speaker.id}${attrText ? ' ' + attrText : ''}: ${quote(text)}` : quote(text));
    lastSay = out.length - 1;
    return true;
  };

  const assign = (stmt: string, depth: number, l: RpyLine): boolean => {
    const m = /^([\w.]+)\s*(=|\+=|-=|\*=|\/=)\s*([\s\S]+)$/.exec(stmt.trim());
    if (!m) return false;
    const name = varName(m[1]!);
    const e = convertExpr(m[3]!);
    if (!name || !e) return false;
    for (const v of e.vars) noteUse(v, null);
    const lit = literal(m[3]!);
    noteUse(name, lit?.kind ?? (/^".*"$/.test(e.expr) ? 'string' : 'number'));
    const op = m[2]!;
    emit(depth, op === '*=' || op === '/=' ? `set ${name} = ${name} ${op[0]} (${e.expr})` : `set ${name} ${op} ${e.expr}`);
    void l;
    return true;
  };

  /** A `$` line: assignments and the few renpy.* calls with Emaki equivalents. */
  const python = (src: string, depth: number, l: RpyLine): void => {
    const parts = src.split(/;\s*/).filter((p) => p.trim());
    for (const p of parts) {
      const call = callArgs(p);
      if (call?.name === 'renpy.pause') {
        const n = numberValue(call.args[0] ?? call.kwargs.delay);
        if (n !== null) { emit(depth, `wait ${n}`); continue; }
      }
      if (call?.name === 'renpy.movie_cutscene') {
        const f = stringValue(call.args[0]);
        const path = f !== null ? resolvePath(f, 'any') : null;
        if (path) { emit(depth, `movie ${quote(path)}`); continue; }
      }
      if (call?.name === 'renpy.jump' && stringValue(call.args[0])) { emit(depth, `jump ${labelRef(stringValue(call.args[0])!, flowLabel)}`); continue; }
      if (call?.name === 'renpy.call' && stringValue(call.args[0])) { emit(depth, `call ${labelRef(stringValue(call.args[0])!, flowLabel)}`); continue; }
      if ((call?.name === 'renpy.music.play' || call?.name === 'renpy.sound.play') && stringValue(call.args[0])) {
        const ch = call.name === 'renpy.sound.play' ? 'sound' : CHANNELS[stringValue(call.kwargs.channel) ?? 'music'] ?? 'sound';
        const path = resolvePath(stringValue(call.args[0])!, 'audio');
        if (path) { emit(depth, `play ${ch} ${quote(path)}`); continue; }
      }
      if (call && /^renpy\.(music|sound)\.stop$/.test(call.name)) {
        emit(depth, `stop ${call.name.includes('sound') ? 'sound' : CHANNELS[stringValue(call.kwargs.channel) ?? 'music'] ?? 'sound'}`);
        continue;
      }
      if (/^(renpy\.save_persistent|_window_hide|_window_show|renpy\.block_rollback|renpy\.fix_rollback|renpy\.choice_for_skipping)\b/.test(p.trim()) || /^(config|_|quick_menu|style)\b/.test(p.trim())) {
        count('Python for Ren\'Py itself (rollback, windows, config)');
        continue;
      }
      if (assign(p, depth, l)) continue;
      issue(l.line, `$ ${p.trim()}`, 'Python Emaki can’t run');
      emit(depth, `# renpy: $ ${p.trim()}`);
    }
  };

  let flowLabel = '';
  const labelRef = (name: string, current: string): string => {
    if (name.startsWith('.')) return ident(`${current}${name.replace('.', '_')}`);
    return ident(name.replace('.', '_'));
  };

  const audioRef = (src: string): string | null => {
    let s = src.trim();
    const list = /^\[([\s\S]*)\]$/.exec(s);
    if (list) { s = list[1]!.split(',')[0]!.trim(); count('playlists (only the first file plays)'); }
    const str = stringValue(s);
    if (str !== null) {
      if (/^</.test(str)) count('sound options (<loop>, <from>)');
      const path = resolvePath(str, 'audio');
      return path ? quote(path) : null;
    }
    const name = s.startsWith('audio.') ? s.slice('audio.'.length) : s;
    return audio.has(ident(name)) ? ident(name) : null;
  };

  const showLine = (l: RpyLine, depth: number, flow: Flow, verb: 'show' | 'scene'): void => {
    const ws = words(l.text.replace(/:$/, '')).slice(1);
    if (l.text.endsWith(':')) count('ATL blocks on show and scene (left out)');
    const stops = new Set(['at', 'as', 'behind', 'onlayer', 'zorder', 'with']);
    const name: string[] = [];
    let i = 0;
    if (ws[0] === 'expression' || ws[0] === 'screen' || ws[0] === 'text' || ws[0] === 'layer') {
      return skip(depth, l, ws[0] === 'screen' ? 'Ren’Py screens aren’t imported' : `'${verb} ${ws[0]}' has no Emaki equivalent`);
    }
    while (i < ws.length && !stops.has(ws[i]!)) name.push(ws[i++]!);
    let at: string[] = [];
    let as: string | null = null;
    let zorder: number | null = null;
    let withSrc: string | null = null;
    while (i < ws.length) {
      const k = ws[i++]!;
      if (k === 'at') {
        const list: string[] = [];
        while (i < ws.length && !stops.has(ws[i]!)) list.push(ws[i++]!);
        at = list.join(' ').split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
      } else if (k === 'as') as = ws[i++] ?? null;
      else if (k === 'zorder') zorder = numberValue(ws[i++]);
      else if (k === 'with') withSrc = ws.slice(i).join(' '), i = ws.length;
      else if (k === 'behind') { i++; count('behind (left out: use depth)'); }
      else if (k === 'onlayer') { i++; count('onlayer (left out)'); }
    }
    const w = withLines(depth, withSrc, l.line, l.text);
    if (verb === 'scene') {
      flow.shown = new Set();
      const img = name.length ? imageName(name) : 'black';
      emit(depth, `scene ${img}${w.inline}`);
      for (const a of w.after) emit(depth, a);
      return;
    }
    if (!name.length) return skip(depth, l, 'a show without an image');
    const img = imageName(name);
    const tag = as ? ident(as) : img.split(' ')[0]!;
    let place: Place | null = null;
    for (const a of at) {
      const p = placeOf(a);
      if (p) place = { ...(place ?? {}), ...p };
      else count(`transforms without a plain position (${a.replace(/\(.*$/, '')})`);
    }
    if (!place && flow.shown && !flow.shown.has(tag)) place = DEFAULT_PLACE;
    flow.shown?.add(tag);
    const parts = [`show ${img}`];
    if (as) parts.push(`as ${tag}`);
    if (place) parts.push(placeText(place));
    if (zorder !== null && zorder !== 0) parts.push(`depth ${zorder}`);
    emit(depth, parts.join(' ') + w.inline);
    for (const a of w.after) emit(depth, a);
  };

  /** Did the lines since `start` add anything but comments? (An Emaki block needs a line.) */
  const added = (start: number) => out.slice(start).some((x) => x.trim() && !x.trim().startsWith('#'));

  const isTerminal = (start: number): boolean => {
    for (let k = out.length - 1; k >= start; k--) {
      const s = out[k]!.trim();
      if (s.startsWith('#') || s === '') continue;
      return /^(jump|return|end)\b/.test(s);
    }
    return false;
  };

  function statements(lines: RpyLine[], depth: number, flow: Flow): void {
    const start = out.length;
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k]!;
      const t = l.text;
      const w = t.startsWith('$') ? '$' : firstWord(t);
      switch (w) {
        case '$': python(t.slice(1).trim(), depth, l); break;
        case 'if': {
          // if / elif / else are siblings in Ren'Py's tree.
          let branch = l;
          let kw = 'if';
          for (;;) {
            if (kw === 'else') emit(depth, 'else:');
            else {
              const cond = branch.text.replace(/^(if|elif)\s+/, '').replace(/:$/, '');
              const e = convertExpr(cond);
              if (e) { for (const v of e.vars) noteUse(v, null); emit(depth, `${kw} ${e.expr}:`); }
              else { issue(branch.line, branch.text, 'a condition Emaki can’t check: taken as false'); emit(depth, `${kw} false:  # renpy: ${cond}`); }
            }
            const before = out.length;
            statements(branch.block, depth + 1, flow);
            if (!added(before)) emit(depth + 1, 'wait 0');
            const next = lines[k + 1];
            const nw = next ? firstWord(next.text) : '';
            if (next && (nw === 'elif' || nw === 'else')) { k++; branch = next; kw = nw; continue; }
            break;
          }
          break;
        }
        case 'elif': case 'else': skip(depth, l, 'an elif or else without its if'); break;
        case 'while': case 'for': skip(depth, l, 'loops aren’t imported'); break;
        case 'menu': {
          const head = /^menu\s*([\w.]*)\s*(\(.*\))?\s*:$/.exec(t);
          if (head?.[1]) count('menus with a name (left out: jump to the label before them)');
          const choices: RpyLine[] = [];
          for (const item of l.block) {
            if (/^set\s/.test(item.text)) { count('menu set (left out)'); continue; }
            if (item.text.endsWith(':') && item.block.length) { choices.push(item); continue; }
            if (!say(item, depth, flow)) skip(depth, item, 'a menu line the importer can’t read');
          }
          emit(depth, 'menu:');
          if (!choices.length) emit(depth + 1, '"…":'), emit(depth + 2, 'wait 0');
          for (const c of choices) {
            const s = readString(c.text, 0);
            if (!s) { skip(depth + 1, c, 'a menu choice the importer can’t read'); continue; }
            const rest = c.text.slice(s.end).replace(/:$/, '').trim();
            const cm = /(?:^|\s)if\s+([\s\S]+)$/.exec(rest);
            let cond = '';
            if (cm) {
              const e = convertExpr(cm[1]!);
              if (e) { for (const v of e.vars) noteUse(v, null); cond = ` if ${e.expr}`; }
              else issue(c.line, c.text, 'a choice condition Emaki can’t check: always shown');
            }
            emit(depth + 1, `${quote(textOf(s.value))}${cond}:`);
            const before = out.length;
            statements(c.block, depth + 2, { ...flow, shown: flow.shown ? new Set(flow.shown) : null });
            if (!added(before)) emit(depth + 2, 'wait 0');
          }
          break;
        }
        case 'jump': {
          const m = /^jump\s+([\w.]+)$/.exec(t);
          if (!m || m[1] === 'expression') { skip(depth, l, 'a jump to a worked-out label'); break; }
          emit(depth, `jump ${labelRef(m[1]!, flowLabel)}`);
          break;
        }
        case 'call': {
          if (/^call\s+screen\b/.test(t)) { skip(depth, l, 'Ren’Py screens aren’t imported'); break; }
          const m = /^call\s+([\w.]+)/.exec(t);
          if (!m || m[1] === 'expression') { skip(depth, l, 'a call to a worked-out label'); break; }
          if (/\(/.test(t)) count('label arguments (left out)');
          emit(depth, `call ${labelRef(m[1]!, flowLabel)}`);
          break;
        }
        case 'return':
          if (t !== 'return') count('return values (left out)');
          emit(depth, 'return');
          break;
        case 'pass': break;
        case 'scene': showLine(l, depth, flow, 'scene'); break;
        case 'show': showLine(l, depth, flow, 'show'); break;
        case 'hide': {
          const ws = words(t).slice(1);
          if (ws[0] === 'screen') { skip(depth, l, 'Ren’Py screens aren’t imported'); break; }
          const wi = ws.indexOf('with');
          const tag = ident(ws[0] ?? '');
          const wl = withLines(depth, wi >= 0 ? ws.slice(wi + 1).join(' ') : null, l.line, t);
          emit(depth, `hide ${tag}${wl.inline.startsWith(' with move') ? '' : wl.inline}`);
          for (const a of wl.after) emit(depth, a);
          flow.shown?.delete(tag);
          break;
        }
        case 'with': {
          const src = t.slice('with'.length).trim();
          const wl = withLines(depth, src, l.line, t);
          if (wl.inline && !wl.inline.startsWith(' with move')) emit(depth, wl.inline.trim());
          for (const a of wl.after) emit(depth, a);
          break;
        }
        case 'play': case 'queue': {
          const ws = words(t);
          const ch = CHANNELS[ws[1] ?? ''];
          if (!ch) count(`sound channels of the game's own (played as sound: ${ws[1]})`);
          if (w === 'queue') count('queued sound (played at once)');
          const ref = ws[2] ? audioRef(ws[2]) : null;
          if (!ref) { skip(depth, l, 'a sound whose file isn’t in the game folder'); break; }
          const opts: string[] = [];
          for (let i = 3; i < ws.length; i++) {
            if (ws[i] === 'fadein') opts.push(`fade ${numberValue(ws[++i]) ?? 1}`);
            else if (ws[i] === 'fadeout') i++;
            else if (ws[i] === 'loop' || ws[i] === 'noloop') opts.push(ws[i]!);
            else if (ws[i] === 'if_changed') count('if_changed (music restarts)');
          }
          emit(depth, `play ${ch ?? 'sound'} ${ref}${opts.length ? ' ' + opts.join(' ') : ''}`);
          break;
        }
        case 'stop': {
          const ws = words(t);
          const ch = CHANNELS[ws[1] ?? ''] ?? 'sound';
          const fi = ws.indexOf('fadeout');
          emit(depth, `stop ${ch}${fi >= 0 ? ` fade ${numberValue(ws[fi + 1]) ?? 1}` : ''}`);
          break;
        }
        case 'voice': {
          const ws = words(t);
          if (ws[1] === 'sustain') { count('voice sustain (left out)'); break; }
          const ref = ws[1] ? audioRef(ws[1]) : null;
          if (!ref) { skip(depth, l, 'a voice file that isn’t in the game folder'); break; }
          emit(depth, `play voice ${ref}`);
          break;
        }
        case 'pause': {
          const n = numberValue(t.slice('pause'.length).trim());
          if (n !== null) emit(depth, `wait ${n}`);
          else skip(depth, l, 'a pause until the player clicks (Emaki pauses for a time)');
          break;
        }
        case 'window': count('window show and hide (left out: the text box shows with lines)'); break;
        case 'nvl': {
          if (/^nvl\s+clear$/.test(t)) emit(depth, 'nvl clear');
          else count('nvl show and hide (left out)');
          break;
        }
        case 'label': {
          // A label inside a block: Ren'Py runs into it; here it becomes a label of its own, jumped to.
          const m = /^label\s+([\w.]+)/.exec(t);
          if (!m) { skip(depth, l, 'a label the importer can’t read'); break; }
          const name = labelRef(m[1]!, flowLabel);
          emit(depth, `jump ${name}`);
          nestedLabels.push({ name, block: l.block, after: lines.slice(k + 1) });
          return;
        }
        case 'define': case 'default': case 'image': case 'transform': case 'init': break; // pass 1
        case 'python': skip(depth, l, 'Python blocks aren’t imported'); break;
        case 'screen': skip(depth, l, 'Ren’Py screens aren’t imported'); break;
        default:
          if (!say(l, depth, flow)) skip(depth, l, 'a statement the importer doesn’t know');
      }
    }
    void start;
  }

  const nestedLabels: { name: string; block: RpyLine[]; after: RpyLine[] }[] = [];

  const label = (name: string, block: RpyLine[], next: string | null, extra: RpyLine[] = []) => {
    flowLabel = name;
    emit(0, `label ${name}:`);
    const start = out.length;
    const flow: Flow = { shown: null, nvl: false, global: name };
    statements([...block, ...extra], 1, flow);
    if (!added(start)) emit(1, 'wait 0');
    // Ren'Py runs on into the next label of the file; Emaki labels end.
    if (next && !isTerminal(start)) emit(1, `jump ${next}`);
    emit(0, '');
  };

  const outFiles: Record<string, string> = {};
  const sources: Record<string, string> = {};
  for (const f of files) {
    file = f.path;
    out.length = 0;
    lastSay = -1;
    const top = f.lines;
    const labelIdx = top.map((l, i) => (firstWord(l.text) === 'label' ? i : -1)).filter((i) => i >= 0);
    for (let n = 0; n < top.length; n++) {
      const l = top[n]!;
      const w = firstWord(l.text);
      if (w === 'label') {
        const m = /^label\s+([\w.]+)/.exec(l.text);
        if (!m) { skip(0, l, 'a label the importer can’t read'); continue; }
        if (/\(/.test(l.text)) count('label parameters (left out)');
        const nextIdx = labelIdx.find((i) => i > n);
        const nextName = nextIdx !== undefined ? labelRef(/^label\s+([\w.]+)/.exec(top[nextIdx]!.text)?.[1] ?? '', '') : null;
        label(labelRef(m[1]!, ''), l.block, nextName);
        while (nestedLabels.length) {
          const nl = nestedLabels.shift()!;
          label(nl.name, nl.block, nextName, nl.after);
        }
      } else if (['define', 'default', 'image', 'transform', 'init'].includes(w)) {
        if (w === 'init' && /python/.test(l.text)) { issue(l.line, l.text, 'Python blocks aren’t imported'); comment(0, flatten([l])); }
        else if (w === 'transform') count('transforms (only their positions are used)');
      } else if (w === 'python' || w === 'screen' || w === 'style' || w === 'translate' || w === 'testcase') {
        count(w === 'style' ? 'styles (left out: see theme.css)' : w === 'translate' ? 'Ren’Py translations (left out)' : w === 'screen' ? 'screens (left out: Emaki has its own)' : `${w} blocks (left out)`);
        comment(0, flatten([l]));
      } else skip(0, l, 'a statement outside any label');
    }
    if (out.some((s) => s.startsWith('label '))) {
      const vn = `scripts/${f.path.replace(/\.rpy$/i, '')}.vn`;
      outFiles[vn] = out.join('\n').replace(/\n+$/, '') + '\n';
      sources[vn] = f.path;
    }
  }

  // ---------------------------------------------------------------- story.vn

  const head: string[] = ['---'];
  const t = title ? convertText(title as string).text : null;
  if (t) head.push(`title: ${t}`);
  if (version) head.push(`version: ${version}`);
  if (labels.has('start')) head.push('start: start');
  // Ren'Py shows narration upright.
  head.push('narration: plain');
  head.push(`canvas: ${screen[0]}x${screen[1]}`);
  head.push('---', '', '# Imported from Ren\'Py: see import-report.md for what was left out.', '');
  const decl: string[] = [];
  for (const c of characters.values()) decl.push(`define ${c.id} ${quote(c.name)}${c.color ? ` color=${c.color}` : ''}`);
  if (characters.size) decl.push('');
  for (const [name, path] of audio) decl.push(`audio ${name} = ${quote(path)}`);
  if (audio.size) decl.push('');
  for (const [name, v] of vars) {
    let value = v.value;
    const from = v.from ? vars.get(v.from) : undefined;
    if (from && !from.from) value = from.value;
    else if (used.get(name) === 'string' && value === '0') value = '""';
    decl.push(`${v.global ? 'global ' : ''}var ${name} = ${value}`);
  }
  const missing = [...used.entries()].filter(([n]) => !vars.has(n));
  for (const [name, kind] of missing) {
    decl.push(`var ${name} = ${kind === 'string' ? '""' : kind === 'bool' ? 'false' : '0'}  # set in the story, with no default`);
  }
  if (vars.size || missing.length) decl.push('');
  for (const img of images.values()) decl.push(`image ${img.name} = ${quote(img.asset)}`);

  return {
    story: [...head, ...decl].join('\n').replace(/\n+$/, '') + '\n',
    files: outFiles, sources, images: [...images.values()], issues, counts,
    canvas, title: t,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

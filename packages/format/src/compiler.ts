/**
 * Compiler: AST -> CompiledStory.
 *
 * Responsibilities:
 *  - validate references (characters, images, labels, variables, audio)
 *  - flatten nested blocks (if/menu) into a flat instruction list with jumps
 *  - assign stable line ids to dialogue and menus (for localization & saves)
 *  - static analysis: unreachable labels
 */
import type { Diagnostic, Program, Stmt } from './ast.ts';
import {
  FORMAT_ID, FORMAT_VERSION,
  type CompiledChoice, type CompiledStory, type Instr, type SrcRef,
} from './compiled.ts';
import { EvalError, evaluate, freeVars, type Expr, type Value } from './expr.ts';
import { parseMarkup, type Span } from './markup.ts';
import { parse } from './parser.ts';

export const TRANSITIONS = ['fade', 'dissolve', 'none'];
export const POSITIONS = ['left', 'center', 'right'];

/** `at 30%`: the sprite's centre, as a percentage of the screen's width from the left (may go past the edges). */
export function isPercentPosition(at: string): boolean {
  return /^-?\d+(\.\d+)?%$/.test(at) && Math.abs(parseFloat(at)) <= 200;
}
/** Image names that exist without being declared. */
export const BUILTIN_IMAGES = ['black'];

export interface CompileResult {
  /** null when there are errors. */
  story: CompiledStory | null;
  diagnostics: Diagnostic[];
  program: Program;
  /** Every piece of text a player reads, by id: what translators translate. */
  strings: SourceString[];
}

/**
 * Translatable text. `id` is the key translations are stored under:
 * line and choice ids (see D-008), `name.<character>` and `meta.title`.
 */
export interface SourceString {
  id: string;
  kind: 'line' | 'choice' | 'name' | 'meta' | 'achievement' | 'ui';
  /** Character id for dialogue, null for narration and everything else. */
  speaker: string | null;
  /** Source text, with its markup and {variables}. */
  text: string;
  label: string | null;
  /** 1-based source line (0 for text that isn't in the script, like the player's own buttons). */
  line: number;
}

/** Parse + compile in one go. */
export function compile(source: string): CompileResult {
  const { program, diagnostics } = parse(source);
  const res = compileProgram(program);
  const all = [...diagnostics, ...res.diagnostics].sort((a, b) => a.line - b.line);
  const hasErrors = all.some((d) => d.severity === 'error');
  return { story: hasErrors ? null : res.story, diagnostics: all, program, strings: res.strings };
}

export function compileProgram(program: Program): { story: CompiledStory; diagnostics: Diagnostic[]; strings: SourceString[] } {
  const diagnostics: Diagnostic[] = [];
  const strings: SourceString[] = [];
  const error = (line: number, code: string, message: string) =>
    diagnostics.push({ severity: 'error', line, code, message });
  const warn = (line: number, code: string, message: string) =>
    diagnostics.push({ severity: 'warning', line, code, message });

  // --- Declarations -----------------------------------------------------
  const meta: Record<string, string> = {};
  for (const [k, v] of program.meta) meta[k] = v;

  const achievements: Record<string, { name: string }> = {};
  for (const a of program.achievements) {
    if (achievements[a.id]) error(a.loc.line, 'duplicate', `Achievement '${a.id}' is already declared`);
    achievements[a.id] = { name: a.name };
  }
  const characters: CompiledStory['characters'] = {};
  for (const c of program.characters) {
    if (characters[c.id]) error(c.loc.line, 'duplicate', `Character '${c.id}' is already defined`);
    characters[c.id] = { name: c.name, color: c.color };
  }

  const images: Record<string, string> = {};
  for (const im of program.images) {
    if (images[im.name]) error(im.loc.line, 'duplicate', `Image '${im.name}' is already defined`);
    images[im.name] = im.path;
  }

  const audio: Record<string, string> = {};
  for (const a of program.audio) {
    if (audio[a.name]) error(a.loc.line, 'duplicate', `Audio '${a.name}' is already defined`);
    audio[a.name] = a.path;
  }

  const vars: Record<string, Value> = {};
  for (const v of program.vars) {
    if (Object.prototype.hasOwnProperty.call(vars, v.name)) {
      error(v.loc.line, 'duplicate', `Variable '${v.name}' is already declared`);
      continue;
    }
    try {
      vars[v.name] = evaluate(v.init, {});
    } catch (e) {
      if (!(e instanceof EvalError)) throw e;
      error(v.loc.line, 'bad-var', `Starting values must be plain values (numbers, text, true/false)`);
      vars[v.name] = 0;
    }
  }

  const labelNames = new Set<string>();
  for (const l of program.labels) {
    if (labelNames.has(l.name)) error(l.loc.line, 'duplicate', `Label '${l.name}' is already defined`);
    labelNames.add(l.name);
  }

  const imageTags = new Set([...Object.keys(images), ...BUILTIN_IMAGES].map((n) => n.split(' ')[0]));

  // --- Code generation --------------------------------------------------
  const code: Instr[] = [];
  const labels: Record<string, number> = {};
  const usedIds = new Map<string, number>();
  const pendingTargets: Array<{ instr: { target: number; label?: string }; name: string; line: number }> = [];

  const lineId = (label: string, key: string): string => {
    const base = `${label}.${fnv1a(key)}`;
    const n = usedIds.get(base) ?? 0;
    usedIds.set(base, n + 1);
    return n === 0 ? base : `${base}.${n + 1}`;
  };

  const checkVars = (e: Expr, line: number) => {
    for (const name of freeVars(e)) {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) {
        error(line, 'unknown-variable', didYouMean(name, Object.keys(vars)) ?? `Unknown variable '${name}'. Declare it at the top: var ${name} = 0`);
      }
    }
  };

  const checkTransition = (t: string | null, line: number) => {
    if (t && !TRANSITIONS.includes(t)) warn(line, 'unknown-transition', `Unknown transition '${t}' (known: ${TRANSITIONS.join(', ')})`);
  };

  const checkText = (text: string, line: number) => {
    for (const m of text.matchAll(/\{\{|\}\}|\{([^{}]*)\}/g)) {
      if (m[1] === undefined) continue;
      const name = m[1].trim();
      if (!/^[A-Za-z_]\w*$/.test(name)) {
        error(line, 'bad-interpolation', `'{${m[1]}}' — only variable names can go in braces. Use '{{' for a literal brace.`);
      } else if (!Object.prototype.hasOwnProperty.call(vars, name)) {
        error(line, 'unknown-variable', `Unknown variable '${name}' in text`);
      }
    }
  };

  /** Validate markup; plain text always, spans only when there is styling. */
  const styledText = (raw: string, line: number): { text: string; spans?: Span[] } => {
    const m = parseMarkup(raw);
    if (m.error) error(line, 'bad-markup', m.error);
    return m.styled ? { text: m.plain, spans: m.spans } : { text: m.plain };
  };

  const emitBlock = (stmts: Stmt[], label: string): void => {
    for (const s of stmts) emitStmt(s, label);
  };

  const emitStmt = (s: Stmt, label: string): void => {
    const src: SrcRef = { line: s.loc.line, label };
    switch (s.type) {
      case 'say': {
        if (s.who !== null && !characters[s.who]) {
          error(s.loc.line, 'unknown-character', didYouMean(s.who, Object.keys(characters)) ?? `Unknown character '${s.who}'. Add: define ${s.who} "Name"`);
        }
        if (s.attrs.length && s.who) {
          const name = `${s.who} ${s.attrs.join(' ')}`;
          if (!images[name]) error(s.loc.line, 'unknown-image', `No image named '${name}'`);
        }
        checkText(s.text, s.loc.line);
        const styled = styledText(s.text, s.loc.line);
        const id = lineId(label, `${s.who ?? ''}|${s.text}`);
        strings.push({ id, kind: 'line', speaker: s.who, text: s.text, label, line: s.loc.line });
        code.push({ op: 'say', id, who: s.who, attrs: s.attrs, ...styled, src });
        return;
      }
      case 'scene': {
        if (s.image && !images[s.image] && !BUILTIN_IMAGES.includes(s.image)) {
          error(s.loc.line, 'unknown-image', didYouMean(s.image, Object.keys(images)) ?? `No image named '${s.image}'`);
        }
        checkTransition(s.transition, s.loc.line);
        code.push({ op: 'scene', image: s.image, transition: s.transition, src });
        return;
      }
      case 'show': {
        if (s.attrs.length) {
          const name = `${s.tag} ${s.attrs.join(' ')}`;
          if (!images[name]) error(s.loc.line, 'unknown-image', `No image named '${name}'`);
        } else if (!imageTags.has(s.tag)) {
          error(s.loc.line, 'unknown-image', `No image named '${s.tag}'`);
        }
        if (s.at && !POSITIONS.includes(s.at) && !isPercentPosition(s.at)) error(s.loc.line, 'bad-position', `Unknown position '${s.at}' (use ${POSITIONS.join(', ')}, or a percentage of the screen's width like 30%)`);
        checkTransition(s.transition, s.loc.line);
        code.push({ op: 'show', tag: s.tag, attrs: s.attrs.length ? s.attrs : null, at: s.at, transition: s.transition, src });
        return;
      }
      case 'hide':
        if (!imageTags.has(s.tag)) warn(s.loc.line, 'unknown-image', `Nothing called '${s.tag}' can be shown, so it can't be hidden`);
        checkTransition(s.transition, s.loc.line);
        code.push({ op: 'hide', tag: s.tag, transition: s.transition, src });
        return;
      case 'play': {
        let path = '';
        if (s.asset.kind === 'path') path = s.asset.path;
        else if (audio[s.asset.name]) path = audio[s.asset.name];
        else error(s.loc.line, 'unknown-audio', `Unknown audio '${s.asset.name}'. Add: audio ${s.asset.name} = "audio/file.ogg"`);
        code.push({ op: 'play', channel: s.channel, path, loop: s.loop ?? s.channel === 'music', fade: s.fade, src });
        return;
      }
      case 'stop':
        code.push({ op: 'stop', channel: s.channel, fade: s.fade, src });
        return;
      case 'set': {
        if (!Object.prototype.hasOwnProperty.call(vars, s.name)) {
          error(s.loc.line, 'unknown-variable', didYouMean(s.name, Object.keys(vars)) ?? `Unknown variable '${s.name}'. Declare it at the top: var ${s.name} = 0`);
        }
        checkVars(s.expr, s.loc.line);
        const expr: Expr = s.op === '='
          ? s.expr
          : { k: 'bin', op: s.op === '+=' ? '+' : '-', l: { k: 'var', name: s.name }, r: s.expr };
        code.push({ op: 'set', name: s.name, expr, src });
        return;
      }
      case 'jump': {
        const instr = { op: 'jump' as const, target: -1, label: s.target, src };
        pendingTargets.push({ instr, name: s.target, line: s.loc.line });
        code.push(instr);
        return;
      }
      case 'call': {
        const instr = { op: 'call' as const, target: -1, label: s.target, src };
        pendingTargets.push({ instr, name: s.target, line: s.loc.line });
        code.push(instr);
        return;
      }
      case 'return': code.push({ op: 'return', src }); return;
      case 'end': code.push({ op: 'end', src }); return;
      case 'wait': code.push({ op: 'wait', seconds: s.seconds, src }); return;
      case 'achieve':
        if (!achievements[s.id]) {
          error(s.loc.line, 'unknown-achievement', didYouMean(s.id, Object.keys(achievements))
            ?? `Unknown achievement '${s.id}'. Declare it at the top: achievement ${s.id} "Its Name"`);
        }
        code.push({ op: 'achieve', id: s.id, src });
        return;
      case 'menu': {
        const choices: CompiledChoice[] = s.choices.map((c) => {
          if (c.cond) checkVars(c.cond, c.loc.line);
          checkText(c.text, c.loc.line);
          return { id: '', ...styledText(c.text, c.loc.line), cond: c.cond, target: -1 };
        });
        const menuId = lineId(label, `menu|${s.choices.map((c) => c.text).join('|')}`);
        choices.forEach((c, i) => {
          c.id = lineId(label, `choice|${s.choices[i].text}`);
          strings.push({ id: c.id, kind: 'choice', speaker: null, text: s.choices[i].text, label, line: s.choices[i].loc.line });
        });
        code.push({ op: 'menu', id: menuId, choices, src });
        const exits: Array<{ target: number }> = [];
        s.choices.forEach((c, i) => {
          choices[i].target = code.length;
          emitBlock(c.body, label);
          const j = { op: 'jump' as const, target: -1, src: { line: c.loc.line, label } };
          exits.push(j);
          code.push(j);
        });
        for (const j of exits) j.target = code.length;
        return;
      }
      case 'if': {
        const exits: Array<{ target: number }> = [];
        for (const b of s.branches) {
          let skip: { target: number } | null = null;
          if (b.cond) {
            checkVars(b.cond, b.loc.line);
            const ji = { op: 'jumpIfNot' as const, cond: b.cond, target: -1, src: { line: b.loc.line, label } };
            code.push(ji);
            skip = ji;
          }
          emitBlock(b.body, label);
          const j = { op: 'jump' as const, target: -1, src: { line: b.loc.line, label } };
          exits.push(j);
          code.push(j);
          if (skip) skip.target = code.length;
        }
        for (const j of exits) j.target = code.length;
        return;
      }
    }
  };

  for (const l of program.labels) {
    labels[l.name] = code.length;
    emitBlock(l.body, l.name);
    // Reaching the end of a label behaves like `return` (ends the story if nothing called it).
    code.push({ op: 'return', src: { line: l.loc.line, label: l.name } });
  }

  for (const p of pendingTargets) {
    if (labels[p.name] === undefined) error(p.line, 'unknown-label', didYouMean(p.name, Object.keys(labels)) ?? `No label named '${p.name}'`);
    else p.instr.target = labels[p.name];
  }

  // --- Start label --------------------------------------------------------
  let start = 0;
  // `label title` is the title screen, never where a new game begins (unless the header says so).
  const startName = meta.start ?? (labels.start !== undefined ? 'start' : program.labels.find((l) => l.name !== 'title')?.name);
  if (!startName) error(1, 'no-labels', 'The story has no labels. Add one: label start:');
  else if (labels[startName] === undefined) error(1, 'unknown-label', `Start label '${startName}' doesn't exist`);
  else start = labels[startName];

  if (meta.title_layout !== undefined && !['center', 'left', 'right', 'bottom'].includes(meta.title_layout)) {
    warn(1, 'bad-title-layout', `'title_layout: ${meta.title_layout}' should be center, left, right or bottom`);
  }
  if (meta.title_buttons !== undefined) {
    const unknown = meta.title_buttons.split(/[\s,]+/).filter((b) => b && !['start', 'load', 'settings', 'quit'].includes(b));
    if (unknown.length) warn(1, 'bad-title-buttons', `Unknown title button '${unknown[0]}' (use start, load, settings, quit)`);
  }
  for (const key of ['title_image', 'title_logo'] as const) {
    const v = meta[key];
    if (v !== undefined && !images[v] && !/\.[A-Za-z0-9]+$/.test(v)) {
      warn(1, 'unknown-image', `'${key}: ${v}' is neither an image name nor a file path`);
    }
  }
  if (meta.title_music !== undefined && !audio[meta.title_music] && !/\.[A-Za-z0-9]+$/.test(meta.title_music)) {
    warn(1, 'unknown-audio', `'title_music: ${meta.title_music}' is neither an audio name nor a file path`);
  }
  if (meta.narration !== undefined && !['italic', 'plain'].includes(meta.narration)) {
    warn(1, 'bad-narration', `'narration: ${meta.narration}' should be 'italic' (the default) or 'plain'`);
  }
  if (meta.aspect !== undefined && parseAspect(meta.aspect) === null) {
    warn(1, 'bad-aspect', `'aspect: ${meta.aspect}' isn't a shape the player understands; use width:height, like 16:9 or 4:3`);
  }

  // --- Reachability -----------------------------------------------------
  if (code.length && !diagnostics.some((d) => d.severity === 'error')) {
    const seen = reachable(code, start);
    if (labels.title !== undefined) for (const i of reachable(code, labels.title)) seen.add(i);
    for (const l of program.labels) {
      if (!seen.has(labels[l.name])) warn(l.loc.line, 'unreachable-label', `Label '${l.name}' can never be reached`);
    }
  }

  const story: CompiledStory = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    meta, start, characters, images, audio,
    ...(Object.keys(achievements).length ? { achievements } : {}),
    vars,
    ...(program.vars.some((v) => v.global) ? { globals: program.vars.filter((v) => v.global).map((v) => v.name) } : {}),
    labels, code,
    hash: '',
  };
  story.hash = fnv1a(JSON.stringify({ ...story, hash: '' }));
  // Names and the title come first in a translation file, as translators expect.
  const header: SourceString[] = [
    ...program.meta.filter(([k]) => k === 'title').map(([k, v]): SourceString => ({ id: `meta.${k}`, kind: 'meta', speaker: null, text: v, label: null, line: 0 })),
    ...program.characters.map((c): SourceString => ({ id: `name.${c.id}`, kind: 'name', speaker: c.id, text: c.name, label: null, line: c.loc.line })),
    ...program.achievements.map((a): SourceString => ({ id: `achievement.${a.id}`, kind: 'achievement', speaker: null, text: a.name, label: null, line: a.loc.line })),
  ];
  return { story, diagnostics, strings: [...header, ...strings] };
}

/** Instruction indices reachable from `start`. */
export function reachable(code: Instr[], start: number): Set<number> {
  const seen = new Set<number>();
  const todo = [start];
  while (todo.length) {
    const i = todo.pop()!;
    if (i < 0 || i >= code.length || seen.has(i)) continue;
    seen.add(i);
    const ins = code[i];
    switch (ins.op) {
      case 'jump': todo.push(ins.target); break;
      case 'jumpIfNot': todo.push(i + 1, ins.target); break;
      case 'menu': for (const c of ins.choices) todo.push(c.target); break;
      case 'call': todo.push(ins.target, i + 1); break;
      case 'return': case 'end': break;
      default: todo.push(i + 1);
    }
  }
  return seen;
}

/** FNV-1a 32-bit hash, base36. Small, fast, deterministic across runtimes. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** "Unknown 'kitchen_tlak'. Did you mean 'kitchen_talk'?" — or null if nothing is close. */
function didYouMean(name: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = editDistance(name.toLowerCase(), c.toLowerCase());
    if (d < bestDist) { bestDist = d; best = c; }
  }
  const limit = Math.max(1, Math.floor(name.length / 3));
  return best !== null && bestDist <= limit ? `Unknown name '${name}'. Did you mean '${best}'?` : null;
}

function editDistance(a: string, b: string): number {
  // Optimal string alignment distance (Levenshtein + adjacent transpositions).
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The stage shape from a header `aspect: 4:3` (width / height), or null if it isn't one. */
export function parseAspect(v: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/.exec(v);
  if (!m) return null;
  const r = Number(m[1]) / Number(m[2]);
  return r >= 0.25 && r <= 4 ? r : null;
}

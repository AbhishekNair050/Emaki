/**
 * Compiler: AST -> CompiledStory.
 *
 * Responsibilities:
 *  - validate references (characters, images, labels, variables, audio)
 *  - flatten nested blocks (if/menu) into a flat instruction list with jumps
 *  - assign stable line ids to dialogue and menus (for localization & saves)
 *  - static analysis: unreachable labels
 */
import type { Diagnostic, Loc, Program, Stmt } from './ast.ts';
import {
  FORMAT_ID, FORMAT_VERSION,
  type CompiledAnimation, type CompiledChoice, type CompiledLayer, type CompiledStory, type Instr, type SrcRef,
} from './compiled.ts';
import { EvalError, evaluate, freeVars, pluginCalls, type Expr, type Value } from './expr.ts';
import { checkPluginCall, checkPluginFunctions, type PluginCommandSpec, type PluginManifest } from './plugins.ts';
import { KEY_ACTIONS, REPLACEABLE_SCREENS, compileScreens, parseCanvas, saveSlotCount, screenCanLeave, screenTargets } from './screens.ts';
import { compileLayerProps, type Grade, type LayerPropsSource } from './layers.ts';
import { parseMarkup, type Span } from './markup.ts';
import { parse, type ParseResult } from './parser.ts';

export const TRANSITIONS = ['fade', 'dissolve', 'move', 'wipe', 'none'];
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
  kind: 'line' | 'choice' | 'name' | 'meta' | 'achievement' | 'ending' | 'ui' | 'screen' | 'replay' | 'music';
  /** Character id for dialogue, null for narration and everything else. */
  speaker: string | null;
  /** Source text, with its markup and {variables}. */
  text: string;
  label: string | null;
  /** 1-based source line (0 for text that isn't in the script, like the player's own buttons). */
  line: number;
  /** The file, when it isn't the main story.vn. */
  file?: string;
}

/** Parse + compile in one go. */
/** What the compiler knows about the game beyond its script. */
/**
 * What one label compiled to, kept between compiles by a CompileCache: its code
 * (targets counted from its first instruction), messages and translatable
 * strings, and its jumps to other labels (`at` is the instruction).
 */
export interface LabelCode {
  key: string;
  code: Instr[];
  diagnostics: Diagnostic[];
  strings: SourceString[];
  jumps: Array<{ at: number; name: string; loc: Loc }>;
  usedIds: Map<string, number>;
  hash: string;
}

/**
 * Lets compiling the same game again redo only what changed: a file whose text
 * is the same isn't parsed again, and its labels aren't compiled again unless
 * the declarations (images, characters, variables...) changed. Make one per
 * game and pass it to every compile of that game.
 */
export interface CompileCache {
  files: Map<string, { source: string; result: ParseResult }>;
  labels: WeakMap<object, LabelCode>;
}

export function createCompileCache(): CompileCache {
  return { files: new Map(), labels: new WeakMap() };
}

export interface CompileOptions {
  /** Reuse work from earlier compiles of the same game; see CompileCache. */
  cache?: CompileCache;
  /**
   * The game's plugins by name (from plugins/<name>/plugin.json). Absent: not
   * known here, so `@` lines aren't checked (an editor showing one file);
   * the CLI, dev server and exports always pass them.
   */
  plugins?: Record<string, PluginManifest>;
}

export function compile(source: string, opts: CompileOptions = {}): CompileResult {
  return compileFiles(source, [], opts);
}

/** One more file of a story; `path` is relative to the game folder, e.g. `chapters/ch2.vn`. */
export interface StoryFile {
  path: string;
  source: string;
}

/**
 * Compile a story split across files. `main` is story.vn, the only file with
 * a header; `parts` are the game's other .vn files. Everything is shared:
 * a label in one file can jump to a label in another, and characters, images
 * and variables can be declared in any file. Locations in the parts carry
 * their `file`; locations in story.vn have none.
 */
export function compileFiles(main: string, parts: StoryFile[] = [], opts: CompileOptions = {}): CompileResult {
  const { program, diagnostics: all } = combineFiles(main, parts, opts);
  const res = compileProgram(program, opts);
  all.push(...res.diagnostics);
  // story.vn first, then the parts in order; by line within a file.
  const order = new Map(parts.map((p, i) => [p.path, i + 1]));
  all.sort((a, b) => (order.get(a.file ?? '') ?? 0) - (order.get(b.file ?? '') ?? 0) || a.line - b.line);
  const hasErrors = all.some((d) => d.severity === 'error');
  return { story: hasErrors ? null : res.story, diagnostics: all, program, strings: res.strings };
}

/**
 * The story's files parsed and put together into one program, without
 * compiling it: what tools need for names, symbols and completion. The
 * diagnostics are only the files' syntax errors (compileFiles adds the rest).
 */
export function combineFiles(main: string, parts: StoryFile[] = [], opts: CompileOptions = {}): { program: Program; diagnostics: Diagnostic[] } {
  const parseFile = (path: string, source: string): ParseResult => {
    const hit = opts.cache?.files.get(path);
    if (hit && hit.source === source) return hit.result;
    const r = parse(source);
    if (path) tagFile(r.program, path);
    opts.cache?.files.set(path, { source, result: r });
    return r;
  };
  // story.vn's program collects every file's declarations and labels, so it's a copy.
  const mainResult = parseFile('', main);
  const program: Program = { ...mainResult.program };
  for (const k of ['characters', 'images', 'audio', 'layered', 'screens', 'vars', 'achievements', 'endings', 'labels'] as const) {
    (program as unknown as Record<string, unknown[]>)[k] = [...mainResult.program[k]];
  }
  if (program.replays) program.replays = [...program.replays];
  if (program.animations) program.animations = [...program.animations];
  if (program.grades) program.grades = [...program.grades];
  const all: Diagnostic[] = [...mainResult.diagnostics];
  for (const part of parts) {
    const r = parseFile(part.path, part.source);
    for (const d of r.diagnostics) all.push({ ...d, file: part.path });
    if (r.program.meta.length) {
      all.push({ severity: 'error', line: 1, file: part.path, code: 'header-in-part', message: 'Only story.vn can have a header (title, start, ...); move these lines there' });
    }
    program.characters.push(...r.program.characters);
    program.images.push(...r.program.images);
    program.audio.push(...r.program.audio);
    program.layered.push(...r.program.layered);
    program.screens.push(...r.program.screens);
    program.vars.push(...r.program.vars);
    program.achievements.push(...r.program.achievements);
    program.endings.push(...r.program.endings);
    if (r.program.replays?.length) (program.replays ??= []).push(...r.program.replays);
    if (r.program.animations?.length) (program.animations ??= []).push(...r.program.animations);
    if (r.program.grades?.length) (program.grades ??= []).push(...r.program.grades);
    program.labels.push(...r.program.labels);
  }
  return { program, diagnostics: all };
}

/** Mark every location in a parsed file as belonging to `file`. */
function tagFile(node: unknown, file: string): void {
  if (Array.isArray(node)) { for (const n of node) tagFile(n, file); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' && v && typeof v === 'object' && 'line' in v) (v as Loc).file = file;
    else if (v && typeof v === 'object') tagFile(v, file);
  }
}

export function compileProgram(program: Program, opts: CompileOptions = {}): { story: CompiledStory; diagnostics: Diagnostic[]; strings: SourceString[] } {
  const diagnostics: Diagnostic[] = [];
  const strings: SourceString[] = [];
  const at = (where: number | Loc) => (typeof where === 'number' ? { line: where } : where.file ? { line: where.line, file: where.file } : { line: where.line });
  /** Where messages go: the story's list, or the label being compiled (see LabelCode). */
  let sink = diagnostics;
  const error = (where: number | Loc, code: string, message: string) =>
    sink.push({ severity: 'error', ...at(where), code, message });
  const warn = (where: number | Loc, code: string, message: string) =>
    sink.push({ severity: 'warning', ...at(where), code, message });

  // --- Declarations -----------------------------------------------------
  const meta: Record<string, string> = {};
  for (const [k, v] of program.meta) meta[k] = v;

  const endings: Record<string, { name: string }> = {};
  for (const e of program.endings) {
    if (endings[e.id]) error(e.loc, 'duplicate', `Ending '${e.id}' is already declared`);
    endings[e.id] = { name: e.name };
  }
  const achievements: Record<string, { name: string }> = {};
  for (const a of program.achievements) {
    if (achievements[a.id]) error(a.loc, 'duplicate', `Achievement '${a.id}' is already declared`);
    achievements[a.id] = { name: a.name };
  }
  const characters: CompiledStory['characters'] = {};
  for (const c of program.characters) {
    if (characters[c.id]) error(c.loc, 'duplicate', `Character '${c.id}' is already defined`);
    characters[c.id] = { name: c.name, color: c.color };
  }

  const images: Record<string, string> = {};
  for (const im of program.images) {
    if (images[im.name]) error(im.loc, 'duplicate', `Image '${im.name}' is already defined`);
    images[im.name] = im.path;
  }

  // Layered characters: which layer each option belongs to, to check `show mira coat smile`.
  const layered: Record<string, CompiledLayer[]> = {};
  const optionLayer: Record<string, Map<string, number>> = {};
  for (const l of program.layered) {
    if (layered[l.tag]) { error(l.loc, 'duplicate', `'layered ${l.tag}' is already defined`); continue; }
    if (Object.keys(images).some((n) => n === l.tag || n.startsWith(l.tag + ' '))) {
      error(l.loc, 'duplicate', `'${l.tag}' already has images declared with 'image'; a character is either layered or plain images`);
    }
    const options = new Map<string, number>();
    const groups = new Set<string>();
    layered[l.tag] = l.layers.map((layer, i): CompiledLayer => {
      if (layer.kind === 'always') return { path: layer.path };
      if (groups.has(layer.name)) error(layer.loc, 'duplicate', `${l.tag} already has a group called '${layer.name}'`);
      groups.add(layer.name);
      const paths: Record<string, string> = {};
      for (const o of layer.options) {
        if (options.has(o.attr)) error(o.loc, 'duplicate', `${l.tag} already has an option called '${o.attr}' (each name picks one layer, so it can only be used once)`);
        options.set(o.attr, i);
        paths[o.attr] = o.path;
      }
      return { group: layer.name, options: paths, default: layer.optional ? null : layer.options[0]?.attr ?? null };
    });
    optionLayer[l.tag] = options;
  }

  /** `show mira coat smile` / `mira -blush:`: plain images must exist; layered options must exist, one per group. */
  const checkSprite = (tag: string, attrs: string[], loc: Loc) => {
    const options = optionLayer[tag];
    if (!options) {
      const off = attrs.find((a) => a.startsWith('-'));
      if (off) { error(loc, 'bad-attribute', `Only a layered character can take a layer off ('${off}')`); return; }
      const name = `${tag} ${attrs.join(' ')}`;
      if (!images[name] && !images[`side ${name}`]) error(loc, 'unknown-image', `No image named '${name}'`);
      return;
    }
    const used = new Set<number>();
    for (const a of attrs) {
      const name = a.replace(/^-/, '');
      const i = options.get(name);
      if (i === undefined) {
        error(loc, 'unknown-image', didYouMean(name, [...options.keys()]) ?? `${tag} has no option '${name}' (see 'layered ${tag}')`);
        continue;
      }
      const layer = layered[tag]![i] as Extract<CompiledLayer, { group: string }>;
      if (a.startsWith('-') && layer.default !== null) {
        error(loc, 'bad-attribute', `${tag}'s ${layer.group} always shows one of its options, so '${a}' can't take it off (declare it 'group ${layer.group} optional:')`);
      }
      if (used.has(i)) error(loc, 'bad-attribute', `Two options of ${tag}'s ${layer.group} group at once; pick one`);
      used.add(i);
    }
  };

  const audio: Record<string, string> = {};
  for (const a of program.audio) {
    if (audio[a.name]) error(a.loc, 'duplicate', `Audio '${a.name}' is already defined`);
    audio[a.name] = a.path;
  }

  const vars: Record<string, Value> = {};
  for (const v of program.vars) {
    if (Object.prototype.hasOwnProperty.call(vars, v.name)) {
      error(v.loc, 'duplicate', `Variable '${v.name}' is already declared`);
      continue;
    }
    try {
      vars[v.name] = evaluate(v.init, {});
    } catch (e) {
      if (!(e instanceof EvalError)) throw e;
      error(v.loc, 'bad-var', pluginCalls(v.init).length
        ? `A starting value can't call a plugin (it's worked out before the game runs): start it at 0 and 'set' it at the start of the story`
        : `Starting values must be plain values (numbers, text, true/false)`);
      vars[v.name] = 0;
    }
  }

  const labelNames = new Set<string>();
  for (const l of program.labels) {
    if (labelNames.has(l.name)) error(l.loc, 'duplicate', `Label '${l.name}' is already defined`);
    labelNames.add(l.name);
  }

  const imageTags = new Set([...Object.keys(images), ...BUILTIN_IMAGES, ...Object.keys(layered)].map((n) => n.split(' ')[0]));
  // Layers named with `as` (D-062), anywhere in the story, and the canvas their pixel positions are on.
  const layerNames = new Set<string>();
  const findNames = (stmts: Stmt[]): void => {
    for (const s of stmts) {
      if (s.type === 'show' && s.as) layerNames.add(s.as);
      else if (s.type === 'if') s.branches.forEach((b) => findNames(b.body));
      else if (s.type === 'menu') s.choices.forEach((c) => findNames(c.body));
    }
  };
  for (const l of program.labels) findNames(l.body);
  const layerCanvas = parseCanvas(meta.canvas);
  const animations: Record<string, CompiledAnimation> = {};
  for (const a of program.animations ?? []) {
    if (animations[a.name]) { error(a.loc, 'duplicate', `Animation '${a.name}' is already defined`); continue; }
    const keys = a.keys.map((k) => ({ t: k.time, props: compileLayerProps(k.props, layerCanvas), ease: k.ease ?? 'linear' }));
    if (a.loop && (keys.at(-1)?.t ?? 0) <= 0) error(a.loc, 'bad-animation', `A looping animation needs keys after 0 seconds`);
    animations[a.name] = { loop: a.loop, duration: keys.at(-1)?.t ?? 0, keys };
  }
  const grades: Record<string, Grade> = {};
  for (const g of program.grades ?? []) {
    if (grades[g.name]) { error(g.loc, 'duplicate', `Grade '${g.name}' is already defined`); continue; }
    grades[g.name] = g.grade;
  }
  const checkGrade = (p: LayerPropsSource | undefined, loc: Loc) => {
    if (p?.grade && p.grade !== 'none' && !grades[p.grade]) error(loc, 'unknown-grade', didYouMean(p.grade, Object.keys(grades)) ?? `No grade named '${p.grade}'. Declare it at the top: grade ${p.grade}: ...`);
  };

  // --- Code generation --------------------------------------------------
  const code: Instr[] = [];
  const labels: Record<string, number> = {};
  const pendingTargets: Array<{ instr: { target: number; label?: string }; name: string; loc: Loc }> = [];
  /** The label being compiled. Its targets count from its own first instruction. */
  let frag: LabelCode = { key: '', code: [], diagnostics: [], strings: [], jumps: [], usedIds: new Map(), hash: '' };

  const lineId = (label: string, key: string): string => {
    const base = `${label}.${fnv1a(key)}`;
    const n = frag.usedIds.get(base) ?? 0;
    frag.usedIds.set(base, n + 1);
    return n === 0 ? base : `${base}.${n + 1}`;
  };

  const checkVars = (e: Expr, line: Loc) => {
    for (const name of freeVars(e)) {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) {
        error(line, 'unknown-variable', didYouMean(name, Object.keys(vars)) ?? `Unknown variable '${name}'. Declare it at the top: var ${name} = 0`);
      }
    }
    checkPluginFunctions(e, opts.plugins, (code, message) => error(line, code, message));
  };

  const checkTransition = (t: string | null, line: Loc) => {
    if (t && !TRANSITIONS.includes(t)) warn(line, 'unknown-transition', `Unknown transition '${t}' (known: ${TRANSITIONS.join(', ')})`);
  };

  const checkText = (text: string, line: Loc) => {
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
  const styledText = (raw: string, line: Loc): { text: string; spans?: Span[] } => {
    const m = parseMarkup(raw);
    if (m.error) error(line, 'bad-markup', m.error);
    return m.styled ? { text: m.plain, spans: m.spans } : { text: m.plain };
  };

  const emitBlock = (stmts: Stmt[], label: string): void => {
    for (const s of stmts) emitStmt(s, label);
  };

  const emitStmt = (s: Stmt, label: string): void => {
    const src: SrcRef = srcRef(s.loc, label);
    switch (s.type) {
      case 'say': {
        if (s.who !== null && !characters[s.who]) {
          error(s.loc, 'unknown-character', didYouMean(s.who, Object.keys(characters)) ?? `Unknown character '${s.who}'. Add: define ${s.who} "Name"`);
        }
        if (s.attrs.length && s.who) checkSprite(s.who, s.attrs, s.loc);
        checkText(s.text, s.loc);
        const styled = styledText(s.text, s.loc);
        const id = lineId(label, `${s.who ?? ''}|${s.text}`);
        frag.strings.push({ id, kind: 'line', speaker: s.who, text: s.text, label, ...lineOf(s.loc) });
        frag.code.push({ op: 'say', id, who: s.who, attrs: s.attrs, ...styled, src });
        return;
      }
      case 'scene': {
        if (s.image && !images[s.image] && !BUILTIN_IMAGES.includes(s.image)) {
          error(s.loc, 'unknown-image', didYouMean(s.image, Object.keys(images)) ?? `No image named '${s.image}'`);
        }
        checkTransition(s.transition, s.loc);
        frag.code.push({ op: 'scene', image: s.image, transition: s.transition, ...dur(s), src });
        return;
      }
      case 'show': {
        if (s.attrs.length) checkSprite(s.tag, s.attrs, s.loc);
        else if (!imageTags.has(s.tag)) {
          error(s.loc, 'unknown-image', `No image named '${s.tag}'`);
        }
        if (s.at && !POSITIONS.includes(s.at) && !isPercentPosition(s.at)) error(s.loc, 'bad-position', `Unknown position '${s.at}' (use ${POSITIONS.join(', ')}, or a percentage of the screen's width like 30%)`);
        checkTransition(s.transition, s.loc);
        checkGrade(s.props, s.loc);
        frag.code.push({
          op: 'show', tag: s.tag, attrs: s.attrs.length ? s.attrs : null, ...(s.as ? { layer: s.as } : {}), at: s.at,
          ...(s.props ? { props: compileLayerProps(s.props, layerCanvas) } : {}), transition: s.transition, ...dur(s), src,
        });
        return;
      }
      case 'animate':
        if (s.animation && !animations[s.animation]) {
          error(s.loc, 'unknown-animation', didYouMean(s.animation, Object.keys(animations)) ?? `No animation named '${s.animation}'. Declare it at the top: animation ${s.animation}:`);
        }
        if (!imageTags.has(s.target) && !layerNames.has(s.target)) {
          error(s.loc, 'unknown-image', didYouMean(s.target, [...imageTags, ...layerNames]) ?? `Nothing called '${s.target}' is ever shown, so it can't be animated`);
        }
        frag.code.push({
          op: 'animate', layer: s.target, props: compileLayerProps(s.props, layerCanvas), duration: s.over, ease: s.ease ?? 'linear',
          ...(s.animation !== undefined ? { animation: s.animation } : {}), src,
        });
        return;
      case 'with':
        checkTransition(s.transition, s.loc);
        let rule: string | undefined;
        if (s.rule) {
          rule = images[s.rule] ?? (/[./]/.test(s.rule) ? s.rule : undefined);
          if (!rule) error(s.loc, 'unknown-image', didYouMean(s.rule, Object.keys(images)) ?? `No image named '${s.rule}' for the wipe's rule picture`);
        }
        frag.code.push({ op: 'with', transition: s.transition, ...(rule ? { rule } : {}), ...dur(s), src });
        return;
      case 'hide':
        if (!imageTags.has(s.tag) && !layerNames.has(s.tag)) warn(s.loc, 'unknown-image', `Nothing called '${s.tag}' can be shown, so it can't be hidden`);
        checkTransition(s.transition, s.loc);
        frag.code.push({ op: 'hide', tag: s.tag, transition: s.transition, ...dur(s), src });
        return;
      case 'play': {
        let path = '';
        if (s.asset.kind === 'path') path = s.asset.path;
        else if (audio[s.asset.name]) path = audio[s.asset.name];
        else error(s.loc, 'unknown-audio', `Unknown audio '${s.asset.name}'. Add: audio ${s.asset.name} = "audio/file.ogg"`);
        frag.code.push({ op: 'play', channel: s.channel, path, loop: s.loop ?? (s.channel === 'music' || s.channel === 'ambience'), fade: s.fade, src });
        return;
      }
      case 'stop':
        frag.code.push({ op: 'stop', channel: s.channel, fade: s.fade, src });
        return;
      case 'set': {
        if (!Object.prototype.hasOwnProperty.call(vars, s.name)) {
          error(s.loc, 'unknown-variable', didYouMean(s.name, Object.keys(vars)) ?? `Unknown variable '${s.name}'. Declare it at the top: var ${s.name} = 0`);
        }
        checkVars(s.expr, s.loc);
        const expr: Expr = s.op === '='
          ? s.expr
          : { k: 'bin', op: s.op === '+=' ? '+' : '-', l: { k: 'var', name: s.name }, r: s.expr };
        frag.code.push({ op: 'set', name: s.name, expr, src });
        return;
      }
      case 'jump': {
        frag.jumps.push({ at: frag.code.length, name: s.target, loc: s.loc });
        frag.code.push({ op: 'jump', target: -1, label: s.target, src });
        return;
      }
      case 'call': {
        frag.jumps.push({ at: frag.code.length, name: s.target, loc: s.loc });
        frag.code.push({ op: 'call', target: -1, label: s.target, src });
        return;
      }
      case 'return': frag.code.push({ op: 'return', src }); return;
      case 'end':
        if (s.ending && !endings[s.ending]) {
          error(s.loc, 'unknown-ending', didYouMean(s.ending, Object.keys(endings))
            ?? `Unknown ending '${s.ending}'. Declare it at the top: ending ${s.ending} "Its Name"`);
        }
        frag.code.push(s.ending ? { op: 'end', ending: s.ending, src } : { op: 'end', src });
        return;
      case 'wait': frag.code.push({ op: 'wait', seconds: s.seconds, src }); return;
      case 'achieve':
        if (!achievements[s.id]) {
          error(s.loc, 'unknown-achievement', didYouMean(s.id, Object.keys(achievements))
            ?? `Unknown achievement '${s.id}'. Declare it at the top: achievement ${s.id} "Its Name"`);
        }
        frag.code.push({ op: 'achieve', id: s.id, src });
        return;
      case 'nvl':
        frag.code.push({ op: 'nvl', mode: s.mode, src });
        return;
      case 'shake':
        frag.code.push({ op: 'shake', ...dur(s), src });
        return;
      case 'motion':
        if (s.target !== 'textbox' && !imageTags.has(s.target)) {
          error(s.loc, 'unknown-image', didYouMean(s.target, [...imageTags, 'textbox'])
            ?? `Nothing called '${s.target}' can be on screen to ${s.motion} (use a character's image name, or textbox)`);
        }
        if (s.forever && s.target === 'textbox') error(s.loc, `bad-${s.motion}`, `Only characters can keep moving; the text box moves once at a time`);
        frag.code.push({
          op: 'motion', motion: s.motion, target: s.target,
          ...(s.times ? { times: s.times } : {}), ...(s.forever ? { forever: true as const } : {}), src,
        });
        return;
      case 'still':
        if (!imageTags.has(s.target)) error(s.loc, 'unknown-image', didYouMean(s.target, [...imageTags]) ?? `No character named '${s.target}' to keep still`);
        frag.code.push({ op: 'still', target: s.target, src });
        return;
      case 'tone':
        frag.code.push({ op: 'tone', tone: s.tone, ...(s.over !== null ? { duration: s.over } : {}), src });
        return;
      case 'textbox':
        frag.code.push({ op: 'textbox', show: s.show, ...(s.over !== null ? { duration: s.over } : {}), src });
        return;
      case 'movie':
        frag.code.push({ op: 'movie', path: s.path, src });
        return;
      case 'plugin': {
        const spec = checkPluginCall(s.call, 'command', opts.plugins, (n) => Object.prototype.hasOwnProperty.call(vars, n), (code, message) => error(s.loc, code, message)) as PluginCommandSpec | null;
        if (s.into) {
          if (!Object.prototype.hasOwnProperty.call(vars, s.into)) error(s.loc, 'unknown-variable', `Unknown variable '${s.into}'. Declare it at the top: var ${s.into} = 0`);
          if (spec && !spec.waits) error(s.loc, 'bad-plugin', `@${s.call.plugin} ${s.call.name} doesn't wait for a result, so it has nothing to put in '${s.into}'`);
        }
        const waits = spec ? spec.waits : !!s.into;
        frag.code.push({
          op: 'plugin', plugin: s.call.plugin, command: s.call.name, args: s.call.args,
          ...(waits ? { waits: true as const } : {}), ...(spec?.lasting ? { lasting: spec.lasting } : {}), ...(spec?.ends ? { ends: true as const } : {}),
          ...(s.into ? { into: s.into } : {}), src,
        });
        return;
      }
      case 'screen': {
        const def = program.screens.find((d) => d.name === s.name);
        if ((REPLACEABLE_SCREENS as readonly string[]).includes(s.name)) {
          error(s.loc, 'bad-screen', `'${s.name}' is opened by the player (the quick menu, the title), not during the story; give your screen another name`);
        } else if (!def) {
          error(s.loc, 'unknown-screen', didYouMean(s.name, program.screens.map((d) => d.name)) ?? `No screen named '${s.name}'. Write it with 'screen ${s.name}:'`);
        } else if (s.mode === 'call' && !screenCanLeave(def)) {
          warn(s.loc, 'no-return', `Nothing on 'screen ${s.name}' returns, so the story would wait forever; give a button '-> return' (or '-> return value')`);
        }
        if (s.into && !Object.prototype.hasOwnProperty.call(vars, s.into)) {
          error(s.loc, 'unknown-variable', `Unknown variable '${s.into}'. Declare it at the top: var ${s.into} = ""`);
        }
        frag.code.push({ op: 'screen', mode: s.mode, name: s.name, ...(s.into ? { into: s.into } : {}), src });
        return;
      }
      case 'flash':
        frag.code.push({ op: 'flash', color: s.color ?? 'white', ...dur(s), src });
        return;
      case 'camera':
        frag.code.push({
          op: 'camera', zoom: s.zoom ?? 1, x: s.at?.[0] ?? 50, y: s.at?.[1] ?? 50,
          ...(s.over !== null ? { duration: s.over } : {}), src,
        });
        return;
      case 'menu': {
        const choices: CompiledChoice[] = s.choices.map((c) => {
          if (c.cond) checkVars(c.cond, c.loc);
          checkText(c.text, c.loc);
          const text = styledText(c.text, c.loc);
          if (text.spans?.some((sp) => sp.pause !== undefined)) error(c.loc, 'bad-markup', `Pauses ([w], [nw]) only work in dialogue and narration, not in choices`);
          return { id: '', ...text, cond: c.cond, target: -1 };
        });
        const menuId = lineId(label, `menu|${s.choices.map((c) => c.text).join('|')}`);
        choices.forEach((c, i) => {
          c.id = lineId(label, `choice|${s.choices[i].text}`);
          frag.strings.push({ id: c.id, kind: 'choice', speaker: null, text: s.choices[i].text, label, ...lineOf(s.choices[i].loc) });
        });
        frag.code.push({ op: 'menu', id: menuId, choices, src });
        const exits: Array<{ target: number }> = [];
        s.choices.forEach((c, i) => {
          choices[i].target = frag.code.length;
          emitBlock(c.body, label);
          const j = { op: 'jump' as const, target: -1, src: srcRef(c.loc, label) };
          exits.push(j);
          frag.code.push(j);
        });
        for (const j of exits) j.target = frag.code.length;
        return;
      }
      case 'if': {
        const exits: Array<{ target: number }> = [];
        for (const b of s.branches) {
          let skip: { target: number } | null = null;
          if (b.cond) {
            checkVars(b.cond, b.loc);
            const ji = { op: 'jumpIfNot' as const, cond: b.cond, target: -1, src: srcRef(b.loc, label) };
            frag.code.push(ji);
            skip = ji;
          }
          emitBlock(b.body, label);
          const j = { op: 'jump' as const, target: -1, src: srcRef(b.loc, label) };
          exits.push(j);
          frag.code.push(j);
          if (skip) skip.target = frag.code.length;
        }
        for (const j of exits) j.target = frag.code.length;
        return;
      }
    }
  };

  // Each label compiles on its own, against the declarations. With a cache, a label
  // that hasn't changed (the same parsed label, the same declarations) is reused.
  const cache = opts.cache;
  const declKey = fnv1a(JSON.stringify([
    characters, images, layered, audio, vars, endings, achievements,
    program.screens.map((d) => [d.name, screenCanLeave(d)]), opts.plugins ?? null,
    layerCanvas, [...layerNames].sort(), Object.keys(animations).sort(), Object.keys(grades).sort(),
  ]));
  const labelHashes: string[] = [];
  for (const l of program.labels) {
    let f = cache?.labels.get(l);
    if (!f || f.key !== declKey) {
      frag = { key: declKey, code: [], diagnostics: [], strings: [], jumps: [], usedIds: new Map(), hash: '' };
      sink = frag.diagnostics;
      emitBlock(l.body, l.name);
      // Reaching the end of a label behaves like `return` (ends the story if nothing called it).
      frag.code.push({ op: 'return', src: srcRef(l.loc, l.name) });
      sink = diagnostics;
      frag.hash = fnv1a(JSON.stringify(frag.code));
      f = frag;
      cache?.labels.set(l, f);
    }
    // Link: move its targets to where it lands; jumps to other labels are resolved below.
    const offset = code.length;
    labels[l.name] = offset;
    diagnostics.push(...f.diagnostics);
    strings.push(...f.strings);
    let next = 0;
    for (let i = 0; i < f.code.length; i++) {
      const ins = f.code[i]!;
      if (f.jumps[next]?.at === i) {
        const j = f.jumps[next++]!;
        const copy = { ...ins } as Extract<Instr, { op: 'jump' | 'call' }>;
        pendingTargets.push({ instr: copy, name: j.name, loc: j.loc });
        code.push(copy);
      } else if (ins.op === 'jump' || ins.op === 'jumpIfNot') code.push({ ...ins, target: ins.target + offset });
      else if (ins.op === 'menu') code.push({ ...ins, choices: ins.choices.map((c) => ({ ...c, target: c.target + offset })) });
      else code.push(ins);
    }
    labelHashes.push(f.hash);
  }

  for (const p of pendingTargets) {
    if (labels[p.name] === undefined) error(p.loc, 'unknown-label', didYouMean(p.name, Object.keys(labels)) ?? `No label named '${p.name}'`);
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
    const unknown = meta.title_buttons.split(/[\s,]+/).filter((b) => b && !['start', 'load', 'extras', 'settings', 'quit'].includes(b));
    if (unknown.length) warn(1, 'bad-title-buttons', `Unknown title button '${unknown[0]}' (use start, load, extras, settings, quit)`);
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
  if (meta.voice !== undefined) {
    const bad = [...meta.voice.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).find((p) => p !== 'id' && p !== 'speaker');
    if (!meta.voice.includes('{id}')) warn(1, 'bad-voice', `'voice: ${meta.voice}' needs {id} where each line's id goes, like voice/{id}.ogg`);
    else if (bad !== undefined) warn(1, 'bad-voice', `Unknown '{${bad}}' in 'voice:' (use {id} and {speaker})`);
  }
  if (meta.nvl !== undefined && meta.nvl !== 'on' && meta.nvl !== 'off') {
    warn(1, 'bad-nvl', `'nvl: ${meta.nvl}' should be 'on' (start in full-screen text) or 'off' (the default)`);
  }
  if (meta.narration !== undefined && !['italic', 'plain'].includes(meta.narration)) {
    warn(1, 'bad-narration', `'narration: ${meta.narration}' should be 'italic' (the default) or 'plain'`);
  }
  if (meta.aspect !== undefined && parseAspect(meta.aspect) === null) {
    warn(1, 'bad-aspect', `'aspect: ${meta.aspect}' isn't a shape the player understands; use width:height, like 16:9 or 4:3`);
  }

  // --- Extras: replayable scenes -----------------------------------------
  const replays: NonNullable<CompiledStory['replays']> = [];
  for (const r of program.replays ?? []) {
    if (labels[r.label] === undefined) error(r.loc, 'unknown-label', didYouMean(r.label, Object.keys(labels)) ?? `No label named '${r.label}' to replay`);
    if (r.until && labels[r.until] === undefined) error(r.loc, 'unknown-label', `No label named '${r.until}' (where the replay stops)`);
    if (r.image && !images[r.image]) error(r.loc, 'unknown-image', `No image named '${r.image}'`);
    if (replays.some((x) => x.label === r.label)) error(r.loc, 'duplicate', `The scene at '${r.label}' is already a replay`);
    replays.push({ label: r.label, name: r.name, ...(r.image && images[r.image] ? { image: images[r.image]! } : {}), ...(r.until ? { until: r.until } : {}) });
  }

  // --- Screens ----------------------------------------------------------
  const canvas = parseCanvas(meta.canvas);
  if (meta.save_slots !== undefined && !/^\d+$/.test(meta.save_slots)) warn(1, 'bad-save-slots', `'save_slots: ${meta.save_slots}' should be a number of save slots, like 60`);
  for (const k of ['escape', 'right_click'] as const) {
    const v = meta[k]?.trim().toLowerCase();
    if (v !== undefined && !(KEY_ACTIONS as readonly string[]).includes(v)) warn(1, 'bad-key-action', `'${k}: ${meta[k]}' should be one of ${KEY_ACTIONS.join(', ')}`);
  }
  if (meta.canvas !== undefined && !canvas) warn(1, 'bad-canvas', `'canvas: ${meta.canvas}' should be the size your UI art is drawn at, like 1920x1080`);
  const screenStrings: SourceString[] = [];
  const screens = compileScreens(program.screens, {
    images, labels: new Set(Object.keys(labels)), vars, canvas, saveSlots: saveSlotCount(meta.save_slots), characters: new Set(Object.keys(characters)),
    ...(opts.plugins ? { plugins: opts.plugins } : {}),
    error: (loc, code, message) => error(loc, code, message),
    warn: (loc, code, message) => warn(loc, code, message),
    textId: (screen, text) => `screen.${screen}.${fnv1a(text)}`,
    addString: (id, text, loc) => {
      if (!screenStrings.some((s) => s.id === id)) screenStrings.push({ id, kind: 'screen', speaker: null, text, label: null, ...lineOf(loc) });
    },
  });
  if (screens.title && labels.title !== undefined && program.labels.find((l) => l.name === 'title')?.body.some((s) => s.type === 'menu')) {
    warn(program.screens.find((s) => s.name === 'title')!.loc, 'title-menu', `Both 'screen title' and a menu in 'label title': the screen replaces the menu, so its choices won't show`);
  }

  // --- Reachability -----------------------------------------------------
  if (code.length && !diagnostics.some((d) => d.severity === 'error')) {
    const seen = reachable(code, start);
    if (labels.title !== undefined) for (const i of reachable(code, labels.title)) seen.add(i);
    // Labels a screen's buttons start or jump to are ways in too.
    for (const label of screenTargets(program.screens)) {
      if (labels[label] !== undefined) for (const i of reachable(code, labels[label]!)) seen.add(i);
    }
    for (const l of program.labels) {
      if (!seen.has(labels[l.name])) warn(l.loc, 'unreachable-label', `Label '${l.name}' can never be reached`);
    }
  }

  const story: CompiledStory = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    meta, start, characters, images, audio,
    ...(Object.keys(layered).length ? { layered } : {}),
    ...(Object.keys(animations).length ? { animations } : {}),
    ...(Object.keys(grades).length ? { grades } : {}),
    ...(Object.keys(screens).length ? { screens } : {}),
    ...(Object.keys(achievements).length ? { achievements } : {}),
    ...(Object.keys(endings).length ? { endings } : {}),
    ...(program.images.some((i) => i.gallery) ? { gallery: program.images.filter((i) => i.gallery).map((i) => i.name) } : {}),
    ...(program.audio.some((a) => a.music !== undefined) ? { music: program.audio.filter((a) => a.music !== undefined).map((a) => ({ name: a.name, title: a.music!, path: a.path })) } : {}),
    ...(replays.length ? { replays } : {}),
    vars,
    ...(program.vars.some((v) => v.global) ? { globals: program.vars.filter((v) => v.global).map((v) => v.name) } : {}),
    labels, code,
    hash: '',
  };
  // Each label's code was hashed once, when it was compiled; `labels` says where each one landed.
  story.hash = fnv1a(JSON.stringify({ ...story, code: labelHashes, hash: '' }));
  // Names and the title come first in a translation file, as translators expect.
  const header: SourceString[] = [
    ...program.meta.filter(([k]) => k === 'title').map(([k, v]): SourceString => ({ id: `meta.${k}`, kind: 'meta', speaker: null, text: v, label: null, line: 0 })),
    ...program.characters.map((c): SourceString => ({ id: `name.${c.id}`, kind: 'name', speaker: c.id, text: c.name, label: null, ...lineOf(c.loc) })),
    ...program.achievements.map((a): SourceString => ({ id: `achievement.${a.id}`, kind: 'achievement', speaker: null, text: a.name, label: null, ...lineOf(a.loc) })),
    ...program.endings.map((e): SourceString => ({ id: `ending.${e.id}`, kind: 'ending', speaker: null, text: e.name, label: null, ...lineOf(e.loc) })),
    ...(program.replays ?? []).map((r): SourceString => ({ id: `replay.${r.label}`, kind: 'replay', speaker: null, text: r.name, label: null, ...lineOf(r.loc) })),
    ...program.audio.filter((a) => a.music !== undefined).map((a): SourceString => ({ id: `music.${a.name}`, kind: 'music', speaker: null, text: a.music!, label: null, ...lineOf(a.loc) })),
  ];
  return { story, diagnostics, strings: [...header, ...strings, ...screenStrings] };
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

/**
 * A line's voice file for the header's `voice:` pattern: `{id}` is the line's
 * id and `{speaker}` its character id (`narrator` for narration).
 */
export function voicePath(pattern: string, id: string, who: string | null): string {
  return pattern.replaceAll('{id}', id).replaceAll('{speaker}', who ?? 'narrator');
}

/**
 * For a story whose header has `voice: voice/{id}.ogg`, the voice file of every
 * line for which `exists(path)` (a path inside assets/) is true.
 */
export function voiceMap(story: CompiledStory, exists: (path: string) => boolean): Record<string, string> {
  const pattern = story.meta.voice;
  const out: Record<string, string> = {};
  if (!pattern?.includes('{id}')) return out;
  for (const ins of story.code) {
    if (ins.op !== 'say') continue;
    const path = voicePath(pattern, ins.id, ins.who);
    if (exists(path)) out[ins.id] = path;
  }
  return out;
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

function srcRef(loc: Loc, label: string): SrcRef {
  return loc.file ? { line: loc.line, file: loc.file, label } : { line: loc.line, label };
}

function lineOf(loc: Loc): { line: number; file?: string } {
  return loc.file ? { line: loc.line, file: loc.file } : { line: loc.line };
}

/** A transition's duration, only when the script gave one. */
function dur(s: { duration?: number }): { duration?: number } {
  return s.duration !== undefined ? { duration: s.duration } : {};
}

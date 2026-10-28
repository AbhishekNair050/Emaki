/**
 * Structural edits to a script, for visual tools (the flowchart, the asset browser).
 *
 * Each edit parses the script, changes the syntax tree and prints it back with
 * the printer, so the result is clean, canonical text that keeps every comment.
 * A script with syntax errors is never edited: the tree would be incomplete and
 * printing it could lose lines.
 */
import {
  KEYWORDS, parse, print,
  type Choice, type IfBranch, type LabelDef, type Program, type Stmt,
} from '@emaki/format';

export type EditResult =
  | { ok: true; text: string; /** 1-based line to show after the edit. */ line: number }
  | { ok: false; error: string };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * For stories split across files: what the rest of the story holds. Scene
 * edits work on one file's text and use this to know about the others.
 */
export interface SceneContext {
  /** Scenes defined in the story's other files. */
  others: string[];
  /** The label the story starts at (it can be in another file). */
  start?: string;
}

const NO_CONTEXT: SceneContext = { others: [] };

function load(src: string): Program | string {
  const { program, diagnostics } = parse(src);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) {
    return `Fix the script's ${errors.length === 1 ? 'error' : `${errors.length} errors`} first (line ${errors[0]!.line}: ${errors[0]!.message}).`;
  }
  return program;
}

const fail = (error: string): EditResult => ({ ok: false, error });

/** Print, then find where something ended up (by re-parsing the result). */
function done(program: Program, find: (p: Program) => number | undefined): EditResult {
  const text = print(program);
  const line = find(parse(text).program) ?? 1;
  return { ok: true, text, line };
}

function checkName(program: Program, name: string, ctx: SceneContext): string | null {
  if (!IDENT.test(name)) return `'${name}' isn't a valid scene name: use letters, digits and _ (not starting with a digit), like kitchen_talk.`;
  if (KEYWORDS.has(name)) return `'${name}' is a keyword, so it can't name a scene.`;
  if (program.labels.some((l) => l.name === name) || ctx.others.includes(name)) return `There is already a scene called '${name}'.`;
  return null;
}

const labelLine = (name: string) => (p: Program) => p.labels.find((l) => l.name === name)?.loc.line;

// ------------------------------------------------------------------ scenes

/** Add an empty scene (after `after`, or at the end). */
export function addScene(src: string, name: string, after?: string, ctx: SceneContext = NO_CONTEXT): EditResult {
  const program = load(src);
  if (typeof program === 'string') return fail(program);
  const bad = checkName(program, name.trim(), ctx);
  if (bad) return fail(bad);
  const label: LabelDef = {
    name: name.trim(),
    body: [{ type: 'say', who: null, attrs: [], text: '...', loc: { line: 0 } }],
    loc: { line: 0 },
  };
  const at = after ? program.labels.findIndex((l) => l.name === after) : -1;
  program.labels.splice(at >= 0 ? at + 1 : program.labels.length, 0, label);
  return done(program, labelLine(label.name));
}

/**
 * Rename a scene, and every jump, call and `start:` that points at it. In a
 * multi-file story, run it on every file: the file defining the scene renames
 * it, the others only update what points at it (`ctx.others` has the scene).
 */
export function renameScene(src: string, from: string, to: string, ctx: SceneContext = NO_CONTEXT): EditResult {
  const program = load(src);
  if (typeof program === 'string') return fail(program);
  const label = program.labels.find((l) => l.name === from);
  if (!label && !ctx.others.includes(from)) return fail(`There is no scene called '${from}'.`);
  to = to.trim();
  if (to === from) return done(program, labelLine(from));
  const bad = checkName(program, to, { ...ctx, others: ctx.others.filter((o) => o !== from) });
  if (bad) return fail(bad);
  if (label) label.name = to;
  for (const l of program.labels) {
    walk(l.body, (s) => {
      if ((s.type === 'jump' || s.type === 'call') && s.target === from) s.target = to;
    });
  }
  for (const m of program.meta) if (m[0] === 'start' && m[1].trim() === from) m[1] = to;
  return done(program, (p) => labelLine(to)(p) ?? firstRef(p, to));
}

/** Delete a scene. Refused while anything else in this file still leads to it (check the other files first). */
export function deleteScene(src: string, name: string, ctx: SceneContext = NO_CONTEXT): EditResult {
  const program = load(src);
  if (typeof program === 'string') return fail(program);
  const i = program.labels.findIndex((l) => l.name === name);
  if (i < 0) return fail(`There is no scene called '${name}'.`);
  if (program.labels.length === 1 && !ctx.others.length) return fail('A story needs at least one scene.');
  const start = ctx.start ?? program.meta.find((m) => m[0] === 'start')?.[1].trim() ?? program.labels[0]!.name;
  if (start === name) return fail(`'${name}' is where the story starts. Choose another start first.`);
  const refs: string[] = [];
  for (const l of program.labels) {
    if (l.name === name) continue;
    walk(l.body, (s) => {
      if ((s.type === 'jump' || s.type === 'call') && s.target === name) refs.push(`${l.name} (line ${s.loc.line})`);
    });
  }
  if (refs.length) return fail(`Other scenes still lead to '${name}': ${refs.join(', ')}. Change those first.`);
  // The comments above the scene go with it: they were about that scene.
  program.labels.splice(i, 1);
  const next = program.labels[i] ?? program.labels[i - 1];
  return done(program, next ? labelLine(next.name) : () => 1);
}

/**
 * Make scene `from` lead to scene `to`:
 *  - a scene that just ends (or falls off) gets `jump to`
 *  - a scene that already jumps somewhere becomes a choice between the two
 *  - a scene that ends in a choice gets one more option
 * New choice text is a placeholder for the writer to replace.
 */
export function connectScenes(src: string, from: string, to: string, ctx: SceneContext = NO_CONTEXT): EditResult {
  const program = load(src);
  if (typeof program === 'string') return fail(program);
  const label = program.labels.find((l) => l.name === from);
  if (!label) return fail(`There is no scene called '${from}'.`);
  if (!program.labels.some((l) => l.name === to) && !ctx.others.includes(to)) return fail(`There is no scene called '${to}'.`);

  const body = label.body;
  const last = body[body.length - 1];
  const jump = (target: string): Stmt => ({ type: 'jump', target, loc: { line: 0 } });
  const choice = (target: string): Choice => ({ text: choiceText(target), cond: null, body: [jump(target)], loc: { line: 0 } });

  if (last?.type === 'jump') {
    if (last.target === to) return fail(`'${from}' already leads to '${to}'.`);
    body[body.length - 1] = {
      type: 'menu', choices: [choice(last.target), choice(to)], loc: { line: 0 },
      ...(last.leading ? { leading: last.leading } : {}),
    };
  } else if (last?.type === 'menu') {
    if (last.choices.some((c) => c.body.length === 1 && c.body[0]!.type === 'jump' && c.body[0]!.target === to)) {
      return fail(`'${from}' already has a choice leading to '${to}'.`);
    }
    last.choices.push(choice(to));
  } else if (last?.type === 'return') {
    return fail(`'${from}' returns to the scene that called it, so it can't lead anywhere else. Edit it in the script instead.`);
  } else if (last?.type === 'end') {
    body[body.length - 1] = { ...jump(to), ...(last.leading ? { leading: last.leading } : {}) };
  } else {
    body.push(jump(to));
  }
  return done(program, (p) => {
    const l = p.labels.find((x) => x.name === from);
    return l?.body[l.body.length - 1]?.loc.line;
  });
}

/** Placeholder text for a new choice: the scene name, readable. */
function choiceText(label: string): string {
  const words = label.replace(/_+/g, ' ').trim();
  return `(Choice) ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function walk(stmts: Stmt[], fn: (s: Stmt) => void): void {
  for (const s of stmts) {
    fn(s);
    if (s.type === 'menu') s.choices.forEach((c: Choice) => walk(c.body, fn));
    if (s.type === 'if') s.branches.forEach((b: IfBranch) => walk(b.body, fn));
  }
}

// ------------------------------------------------------------------ assets

export type AssetKind = 'image' | 'audio';

/**
 * A script name for an asset file: `bg/Kitchen Night.png` → `kitchen_night`.
 * An image named after a character (`sprites/mira_smile.png`) becomes that
 * character's sprite, `mira smile`. Never clashes with an existing name.
 */
export function suggestAssetName(src: string, kind: AssetKind, path: string): string {
  const { program } = parse(src);
  const file = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
  let base = file.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || kind;
  base = base.replace(/^(bg|background|img|image|sfx|bgm|music)_(?=.)/, '');
  if (/^\d/.test(base)) base = `${kind}_${base}`;
  if (KEYWORDS.has(base)) base += '_';

  let name = base;
  if (kind === 'image') {
    const char = program.characters.find((c) => base.startsWith(c.id + '_') && base.length > c.id.length + 1);
    if (char) name = `${char.id} ${base.slice(char.id.length + 1)}`;
  }
  const taken = new Set(kind === 'image' ? program.images.map((i) => i.name) : program.audio.map((a) => a.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name}_${n}`)) return `${name}_${n}`;
}

/** The name an asset file is already declared under, if any. */
export function declaredName(src: string, kind: AssetKind, path: string): string | undefined {
  const { program } = parse(src);
  const list = kind === 'image' ? program.images : program.audio;
  return list.find((d) => normalizePath(d.path) === normalizePath(path))?.name;
}

/** Add `image name = "path"` (or `audio ...`) after the other declarations of its kind. */
export function declareAsset(src: string, kind: AssetKind, path: string, name?: string): EditResult & { name?: string } {
  const program = load(src);
  if (typeof program === 'string') return fail(program);
  const list = kind === 'image' ? program.images : program.audio;
  const existing = list.find((d) => normalizePath(d.path) === normalizePath(path));
  if (existing) return { ...done(program, (p) => findDecl(p, kind, existing.name)), name: existing.name };
  name ??= suggestAssetName(src, kind, path);
  if (list.some((d) => d.name === name)) return fail(`There is already an ${kind} called '${name}'.`);
  list.push({ name, path, loc: { line: 0 } });
  return { ...done(program, (p) => findDecl(p, kind, name)), name };
}

/**
 * Drop an asset onto line `line` (1-based) of the script: declare it if
 * needed, and if the line is inside a scene, put the matching statement
 * there (`scene kitchen`, `show mira smile`, `play music theme`).
 */
export function dropAsset(src: string, kind: AssetKind, path: string, line: number | null): EditResult & { name?: string } {
  const declared = declareAsset(src, kind, path);
  if (!declared.ok || line === null) return declared;
  const name = declared.name!;

  // Where does the dropped line fall in the original script?
  const program = load(src) as Program;
  const label = [...program.labels].reverse().find((l) => l.loc.line < line);
  const lines = src.split('\n');
  if (!label || line > lines.length + 1) return declared;
  const nextLabel = program.labels.find((l) => l.loc.line > label.loc.line);
  if (nextLabel && line >= nextLabel.loc.line) return declared;

  const stmt = kind === 'audio'
    ? `play ${/(^|\/)(sfx|sounds?|se)\//i.test(path) ? 'sound' : 'music'} ${name}`
    : name.includes(' ') ? `show ${name}` : `scene ${name}`;
  // Indent like the story line nearest the drop point, so the new line joins that block.
  const near = (i: number) => lines[i] !== undefined && /^\s+\S/.test(lines[i]!) ? lines[i]! : undefined;
  const ref = near(line - 1) ?? near(line - 2) ?? '  ';
  const indent = /^\s*/.exec(ref)![0] || '  ';
  const before = src.split('\n');
  before.splice(line - 1, 0, indent + stmt);
  const withStmt = before.join('\n');

  // Declare in the edited text, so both changes come out of one print.
  const result = declareAsset(withStmt, kind, path, name);
  if (!result.ok) return declared; // e.g. dropped inside a menu header: just declare
  const shift = (result.text.split('\n').length) - withStmt.split('\n').length;
  // The statement moved down by however many lines the declaration (and tidying) added above it.
  const stmtLine = result.text.split('\n').findIndex((l, i) => i >= line - 1 && l.trim() === stmt) + 1;
  return { ok: true, text: result.text, line: stmtLine || line + shift, name };
}

function findDecl(p: Program, kind: AssetKind, name: string): number | undefined {
  return (kind === 'image' ? p.images : p.audio).find((d) => d.name === name)?.loc.line;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '');
}

/** The line of the first jump or call to `name` (where a rename shows up in a file that only points at the scene). */
function firstRef(p: Program, name: string): number | undefined {
  let line: number | undefined;
  for (const l of p.labels) {
    walk(l.body, (s) => {
      if (line === undefined && (s.type === 'jump' || s.type === 'call') && s.target === name) line = s.loc.line;
    });
  }
  return line;
}

/**
 * The inspector's view of one line (D-065): what the statement on it is, and
 * the same line rewritten with a change. Only that line is read and printed,
 * so it costs the same in a ten-line script and an 80,000-line one, and the
 * rest of the file stays exactly as the writer wrote it.
 */
import { parse, printStatement, type Stmt } from '@emaki/format';

/** The statements the inspector can show and change: each one fits on one line. */
export type InspectedStmt = Extract<Stmt, { type: 'show' | 'scene' | 'hide' | 'say' }>;

export interface InspectedLine {
  stmt: InspectedStmt;
  /** The line's indentation, kept as it is when the line is rewritten. */
  indent: string;
}

const INSPECTABLE = new Set(['show', 'scene', 'hide', 'say']);

/** The statement on a line of script, if it is one the inspector understands. */
export function inspectLine(lineText: string): InspectedLine | null {
  const indent = /^[ \t]*/.exec(lineText)![0];
  const body = lineText.slice(indent.length);
  if (!body || body.startsWith('#')) return null;
  // A menu choice (`"Read it.":`) reads like narration on its own.
  if (body.startsWith('"') && /:\s*(#.*)?$/.test(body)) return null;
  // Parsed on its own, inside a scene, as it would be in the file.
  const { program, diagnostics } = parse(`label inspected_line:\n  ${body}\n`);
  if (diagnostics.some((d) => d.severity === 'error')) return null;
  const stmts = program.labels[0]?.body ?? [];
  const stmt = stmts[0];
  if (stmts.length !== 1 || !stmt || !INSPECTABLE.has(stmt.type)) return null;
  return { stmt: stmt as InspectedStmt, indent };
}

export type LineChange =
  /** A character's look: `show mira smile`, or `mira smile: ...` on a line of dialogue. */
  | { look: string[] }
  /** Where a character stands: `left`, `center`, `right`, `30%`; null for the default. */
  | { at: string | null }
  /** `with dissolve 0.5`; null for none. */
  | { transition: string | null; duration?: number }
  /** A scene's background. */
  | { image: string }
  /** A character's size (1 = as drawn); null for the default. */
  | { zoom: number | null }
  /** A character turned by degrees, clockwise; null for none. */
  | { rotate: number | null };

export type LineEdit = { ok: true; text: string } | { ok: false; error: string };

/** The line rewritten with one change, keeping its indentation and end-of-line comment. */
export function editLine(lineText: string, change: LineChange): LineEdit {
  const found = inspectLine(lineText);
  if (!found) return { ok: false, error: 'This line can’t be changed from the inspector.' };
  const s: InspectedStmt = { ...found.stmt };
  if ('look' in change) {
    if (s.type !== 'show' && s.type !== 'say') return { ok: false, error: 'Only characters have looks.' };
    if (s.type === 'say' && s.who === null) return { ok: false, error: 'Narration has no speaker to change.' };
    const bad = change.look.find((a) => !/^-?[A-Za-z_]\w*$/.test(a));
    if (bad !== undefined) return { ok: false, error: `'${bad}' isn't a valid look: use letters, digits and _.` };
    s.attrs = change.look;
  } else if ('at' in change) {
    if (s.type !== 'show') return { ok: false, error: 'Only a show line has a place.' };
    if (change.at !== null && !/^([A-Za-z_]\w*|-?\d+(\.\d+)?%)$/.test(change.at)) return { ok: false, error: `'${change.at}' isn't a place: use left, center, right or a percentage like 30%.` };
    s.at = change.at;
  } else if ('transition' in change) {
    if (s.type === 'say') return { ok: false, error: 'Dialogue has no transition.' };
    s.transition = change.transition === 'none' ? null : change.transition;
    if (s.transition === null || change.duration === undefined) delete s.duration;
    else s.duration = change.duration;
  } else if ('zoom' in change || 'rotate' in change) {
    if (s.type !== 'show') return { ok: false, error: 'Only a show line can size or turn a character.' };
    const props = { ...s.props };
    if ('zoom' in change) {
      if (change.zoom === null || change.zoom === 1) delete props.zoom;
      else if (!Number.isFinite(change.zoom) || change.zoom === 0) return { ok: false, error: 'Zoom must be a number other than 0, like 1.2.' };
      else props.zoom = [round(change.zoom), round(change.zoom)];
    } else {
      if (change.rotate === null || change.rotate === 0) delete props.rotate;
      else if (!Number.isFinite(change.rotate)) return { ok: false, error: 'Rotate must be a number of degrees, like -5.' };
      else props.rotate = round(change.rotate);
    }
    if (Object.keys(props).length) s.props = props;
    else delete s.props;
  } else {
    if (s.type !== 'scene') return { ok: false, error: 'Only a scene line has a background.' };
    if (!/^[A-Za-z_]\w*$/.test(change.image)) return { ok: false, error: `'${change.image}' isn't an image name.` };
    s.image = change.image;
  }
  const printed = printStatement(s);
  if (printed.length !== 1) return { ok: false, error: 'That change doesn’t fit on one line.' };
  return { ok: true, text: found.indent + printed[0] };
}

/**
 * The looks declared for a character, from the story's image names
 * (`mira smile` → `smile`): each look as its list of attributes.
 */
export function looksOf(tag: string, imageNames: Iterable<string>): string[][] {
  const out: string[][] = [];
  for (const name of imageNames) {
    const [t, ...attrs] = name.split(' ');
    if (t === tag && attrs.length) out.push(attrs);
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

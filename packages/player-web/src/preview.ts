/**
 * Dev preview links: `?line=52&trust=2&read_letter=true` opens the game at
 * line 52 of story.vn with those variables set. Used by the editor
 * integration ("Preview from this line") and handy to bookmark while writing.
 */
import type { Value } from '@emaki/format';

export interface PreviewRequest {
  line: number;
  vars: Record<string, Value>;
  /** Parameters that aren't declared variables, or whose value doesn't fit the variable's type. */
  ignored: string[];
}

/**
 * Read a preview request from a URL query string. Values are converted to the
 * type of the variable's starting value, so `trust=2` is a number and
 * `read_letter=true` a boolean. Returns null when there's no valid `line`.
 */
export function parsePreview(search: string, declared: Readonly<Record<string, Value>>): PreviewRequest | null {
  const params = new URLSearchParams(search);
  const lineText = params.get('line');
  if (lineText === null || !/^\d+$/.test(lineText.trim()) || Number(lineText) < 1) return null;
  const vars: Record<string, Value> = {};
  const ignored: string[] = [];
  for (const [name, raw] of params) {
    if (name === 'line') continue;
    if (!Object.prototype.hasOwnProperty.call(declared, name)) { ignored.push(name); continue; }
    const value = convert(raw, declared[name]!);
    if (value === undefined) ignored.push(name);
    else vars[name] = value;
  }
  return { line: Number(lineText), vars, ignored };
}

function convert(raw: string, like: Value): Value | undefined {
  if (typeof like === 'number') {
    const n = Number(raw);
    return raw.trim() !== '' && Number.isFinite(n) ? n : undefined;
  }
  if (typeof like === 'boolean') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return undefined;
  }
  return raw;
}

/** Build a preview query string (the inverse of parsePreview). */
export function previewQuery(line: number, vars: Readonly<Record<string, Value>> = {}): string {
  const params = new URLSearchParams({ line: String(line) });
  for (const [k, v] of Object.entries(vars)) params.set(k, String(v));
  return '?' + params.toString();
}

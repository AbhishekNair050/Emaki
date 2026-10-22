/**
 * Localization: translation catalogs, keyed by line id.
 *
 *   strings (from the compiler) ──updateCatalog──▶ catalog ──writePo / writeCsv──▶ lang/fr.po
 *   lang/fr.po ──parsePo / parseCsv──▶ catalog ──compileTranslation──▶ what the runtime loads
 *
 * Every line has a stable id (D-008), so a translation follows its line even
 * when scenes move. Editing a line changes its id; on the next update the
 * old translation is offered back for that line, flagged for review, so
 * translators see what changed instead of starting over.
 *
 * PO is the standard format of translation tools (Poedit, Weblate, Crowdin,
 * Lokalize). CSV is for spreadsheets. Both hold the same information.
 */
import type { Diagnostic } from './ast.ts';
import type { SourceString } from './compiler.ts';
import { parseMarkup, type Span } from './markup.ts';

export const TRANSLATION_FORMAT = 'emaki-translation';

/** `ok`: use it. `review`: a suggestion after the source changed (not used in game). `obsolete`: its line is gone. */
export type EntryStatus = 'ok' | 'review' | 'obsolete';

export interface CatalogEntry {
  id: string;
  kind: SourceString['kind'];
  speaker: string | null;
  /** Source text this translation is for. */
  source: string;
  /** Empty when not translated yet. */
  translation: string;
  status: EntryStatus;
  /** For `review`: the source text the translation was written for. */
  previous?: string;
  /** Where the text is, for translators ("story.vn:42"). */
  ref?: string;
}

export interface Catalog {
  /** Language code, e.g. "fr", "pt-BR". */
  lang: string;
  entries: CatalogEntry[];
}

/** What a runtime loads for one language. */
export interface CompiledTranslation {
  format: typeof TRANSLATION_FORMAT;
  version: 1;
  lang: string;
  /** Translated text by id (lines, choices, `ui.*`), already split into styled spans. */
  strings: Record<string, { text: string; spans?: Span[] }>;
  /** Character id → translated name. */
  names: Record<string, string>;
  /** Translated header values (title). */
  meta: Record<string, string>;
}

export interface TranslationStats {
  total: number;
  translated: number;
  review: number;
}

// ------------------------------------------------------------------ updating

/**
 * Bring a catalog up to date with the script: new lines are added (empty),
 * existing translations kept, changed lines get their old translation back
 * as a `review` suggestion, and translations for removed lines are kept as
 * `obsolete` so no work is lost.
 */
export function updateCatalog(strings: SourceString[], existing: Catalog | null, lang: string, file = 'story.vn'): Catalog {
  const old = new Map((existing?.entries ?? []).map((e) => [e.id, e]));
  const used = new Set<string>();
  const entries: CatalogEntry[] = [];

  for (const s of strings) {
    const ref = s.line ? `${file}:${s.line}` : undefined;
    const base = { id: s.id, kind: s.kind, speaker: s.speaker, source: s.text, ...(ref ? { ref } : {}) };
    const same = old.get(s.id);
    if (same && same.status !== 'obsolete') {
      used.add(s.id);
      const changed = same.source !== s.text; // only for ids that don't hash the text (names, title, ui)
      entries.push({
        ...base,
        translation: same.translation,
        status: changed && same.translation ? 'review' : same.status,
        ...(changed && same.translation ? { previous: same.source } : same.previous ? { previous: same.previous } : {}),
      });
      continue;
    }
    entries.push({ ...base, translation: '', status: 'ok' });
  }

  // Lines whose text changed have new ids: offer the closest old translation from the same scene.
  const leftovers = (existing?.entries ?? []).filter((e) => !used.has(e.id) && e.translation);
  for (const e of entries) {
    if (e.translation || (e.kind !== 'line' && e.kind !== 'choice')) continue;
    const scene = labelOf(e.id);
    let best: CatalogEntry | undefined;
    let bestScore = 0.5;
    for (const o of leftovers) {
      // Catalogs read from files don't record who speaks, so match on the scene and the words.
      if (used.has(o.id) || labelOf(o.id) !== scene || (o.kind !== 'line' && o.kind !== 'choice')) continue;
      const score = similarity(o.source, e.source);
      if (score > bestScore) { best = o; bestScore = score; }
    }
    if (best) {
      used.add(best.id);
      e.translation = best.translation;
      e.status = 'review';
      e.previous = best.source;
    }
  }

  for (const o of leftovers) {
    if (!used.has(o.id)) entries.push({ ...o, status: 'obsolete', ref: undefined, previous: undefined });
  }
  for (const e of entries) {
    if (e.ref === undefined) delete e.ref;
    if (e.previous === undefined) delete e.previous;
  }
  return { lang, entries };
}

export function catalogStats(catalog: Catalog): TranslationStats {
  const live = catalog.entries.filter((e) => e.status !== 'obsolete');
  return {
    total: live.length,
    translated: live.filter((e) => e.translation && e.status === 'ok').length,
    review: live.filter((e) => e.status === 'review').length,
  };
}

function labelOf(id: string): string {
  return id.slice(0, id.indexOf('.'));
}

/** 0..1, how alike two texts are (1 - edit distance / length), on words. */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().split(/\s+/).filter(Boolean);
  const y = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (!x.length && !y.length) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length]! / Math.max(x.length, y.length);
}

// ------------------------------------------------------------------ compiling

/**
 * Turn a catalog into what the runtime loads. Only `ok` entries with a
 * translation are used; anything missing falls back to the source text.
 * Markup is checked, and a translation may only use the variables its
 * source line uses (a typo there would show "{nmae}" to players).
 */
export function compileTranslation(catalog: Catalog, strings: SourceString[]): {
  translation: CompiledTranslation; diagnostics: Diagnostic[]; stats: TranslationStats;
} {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(strings.map((s) => [s.id, s]));
  const out: CompiledTranslation = { format: TRANSLATION_FORMAT, version: 1, lang: catalog.lang, strings: {}, names: {}, meta: {} };
  let translated = 0;
  let review = 0;

  for (const e of catalog.entries) {
    if (e.status === 'obsolete') continue;
    const src = byId.get(e.id);
    if (!src) continue; // a line that no longer exists; `emaki strings` will mark it obsolete
    if (e.status === 'review') { review++; continue; }
    if (!e.translation) continue;
    const line = src.line;
    const problem = (message: string, code: string, severity: Diagnostic['severity'] = 'error') =>
      diagnostics.push({ severity, line, code, message: `${e.id}: ${message}` });

    if (src.kind === 'name') { out.names[src.speaker!] = e.translation; translated++; continue; }
    if (src.kind === 'meta') { out.meta[e.id.slice('meta.'.length)] = e.translation; translated++; continue; }

    const want = varsIn(src.text);
    const got = varsIn(e.translation);
    const extra = [...got].filter((v) => !want.has(v));
    if (extra.length) { problem(`uses {${extra.join('}, {')}}, which the original line doesn't`, 'translation-variable'); continue; }
    const missing = [...want].filter((v) => !got.has(v));
    if (missing.length) problem(`leaves out {${missing.join('}, {')}}`, 'translation-variable', 'warning');
    const m = parseMarkup(e.translation);
    if (m.error) { problem(m.error, 'translation-markup'); continue; }
    out.strings[e.id] = m.styled ? { text: m.plain, spans: m.spans } : { text: m.plain };
    translated++;
  }
  return { translation: out, diagnostics, stats: { total: strings.length, translated, review } };
}

function varsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{|\}\}|\{\s*([A-Za-z_]\w*)\s*\}/g)) if (m[1]) out.add(m[1]);
  return out;
}

// ------------------------------------------------------------------ PO

/**
 * Write a gettext PO file. The id is the message context (msgctxt), so two
 * identical lines in different places can be translated differently.
 */
export function writePo(catalog: Catalog, title = ''): string {
  const out: string[] = [];
  if (title) out.push(`# ${title}`);
  out.push(
    'msgid ""',
    'msgstr ""',
    `"Language: ${catalog.lang}\\n"`,
    '"MIME-Version: 1.0\\n"',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    '"X-Generator: Emaki\\n"',
  );
  for (const e of catalog.entries) {
    out.push('');
    const obsolete = e.status === 'obsolete';
    const p = obsolete ? '#~ ' : '';
    const note = describe(e);
    if (note && !obsolete) out.push(`#. ${note}`);
    if (e.ref && !obsolete) out.push(`#: ${e.ref}`);
    if (e.status === 'review') out.push('#, fuzzy');
    if (e.previous !== undefined && !obsolete) out.push(`#| msgid ${poString(e.previous)}`);
    out.push(`${p}msgctxt ${poString(e.id)}`, `${p}msgid ${poString(e.source)}`, `${p}msgstr ${poString(e.translation)}`);
  }
  return out.join('\n') + '\n';
}

/** What a translator needs to know about an entry (shown as a comment in their tool). */
function describe(e: CatalogEntry): string {
  switch (e.kind) {
    case 'line': return e.speaker ? `Spoken by ${e.speaker}` : 'Narration';
    case 'choice': return 'Menu choice';
    case 'name': return `Name of the character '${e.speaker}'`;
    case 'meta': return 'Title of the game';
    case 'ui': return 'Game interface';
  }
}

function poString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

export function parsePo(text: string): { catalog: Catalog; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const entries: CatalogEntry[] = [];
  let lang = '';

  interface Draft { ctx?: string; id?: string; str?: string; fuzzy: boolean; obsolete: boolean; previous?: string; ref?: string; line: number }
  let cur: Draft = { fuzzy: false, obsolete: false, line: 1 };
  let field: 'ctx' | 'id' | 'str' | 'previous' | null = null;

  const flush = () => {
    if (cur.id !== undefined) {
      if (cur.id === '' && cur.ctx === undefined) {
        lang = /(?:^|\n)Language:\s*([^\n]*)/.exec(cur.str ?? '')?.[1]?.trim() ?? '';
      } else if (cur.ctx === undefined) {
        diagnostics.push({ severity: 'warning', line: cur.line, code: 'po-no-context', message: 'Entry without msgctxt (line id): ignored' });
      } else {
        entries.push({
          id: cur.ctx, kind: kindOf(cur.ctx), speaker: null, source: cur.id, translation: cur.str ?? '',
          status: cur.obsolete ? 'obsolete' : cur.fuzzy ? 'review' : 'ok',
          ...(cur.previous !== undefined ? { previous: cur.previous } : {}),
          ...(cur.ref ? { ref: cur.ref } : {}),
        });
      }
    }
    cur = { fuzzy: false, obsolete: false, line: 0 };
    field = null;
  };

  lines.forEach((raw, i) => {
    let line = raw.trim();
    if (!line) { flush(); return; }
    const obsolete = line.startsWith('#~');
    if (obsolete) line = line.slice(2).trim();
    if (!obsolete && line.startsWith('#')) {
      if (cur.id !== undefined) flush();
      if (line.startsWith('#,') && /\bfuzzy\b/.test(line)) cur.fuzzy = true;
      else if (line.startsWith('#:')) cur.ref = line.slice(2).trim();
      else if (line.startsWith('#|')) {
        const m = /^#\|\s*msgid\s+(".*")$/.exec(line);
        if (m) { cur.previous = unquote(m[1]!); field = 'previous'; }
      }
      if (!cur.line) cur.line = i + 1;
      return;
    }
    if (!cur.line) cur.line = i + 1;
    if (obsolete) cur.obsolete = true;
    const m = /^(msgctxt|msgid|msgstr)\s+(".*")$/.exec(line);
    if (m) {
      const key = m[1] === 'msgctxt' ? 'ctx' : m[1] === 'msgid' ? 'id' : 'str';
      if (key === 'ctx' && cur.id !== undefined) flush();
      if (key === 'id' && cur.str !== undefined) flush();
      if (!cur.line) cur.line = i + 1;
      if (obsolete) cur.obsolete = true;
      cur[key] = unquote(m[2]!);
      field = key;
      return;
    }
    if (line.startsWith('"') && field) {
      cur[field] = (cur[field] ?? '') + unquote(line);
      return;
    }
    if (/^msgid_plural|^msgstr\[/.test(line)) {
      diagnostics.push({ severity: 'warning', line: i + 1, code: 'po-plural', message: 'Plural forms are not used by Emaki: ignored' });
      return;
    }
    diagnostics.push({ severity: 'error', line: i + 1, code: 'po-syntax', message: `Can't read this line of the PO file: ${raw.trim()}` });
  });
  flush();
  return { catalog: { lang, entries }, diagnostics };
}

function unquote(s: string): string {
  const body = s.trim().slice(1, -1);
  return body.replace(/\\(.)/g, (_, c: string) => ({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[c] ?? c);
}

function kindOf(id: string): CatalogEntry['kind'] {
  if (id.startsWith('name.')) return 'name';
  if (id.startsWith('meta.')) return 'meta';
  if (id.startsWith('ui.')) return 'ui';
  return 'line'; // lines and choices are told apart by the script on the next update
}

// ------------------------------------------------------------------ CSV

const CSV_HEADER = ['id', 'speaker', 'source', 'translation', 'status'];

/** A spreadsheet-friendly catalog: one row per string. Status is empty, "review" or "obsolete". */
export function writeCsv(catalog: Catalog): string {
  const rows = [CSV_HEADER];
  for (const e of catalog.entries) {
    const speaker = e.kind === 'line' ? e.speaker ?? '' : e.kind === 'name' ? '(name)' : e.kind === 'choice' ? '(choice)' : e.kind === 'meta' ? '(title)' : '(interface)';
    rows.push([e.id, speaker, e.source, e.translation, e.status === 'ok' ? '' : e.status]);
  }
  // A byte-order mark so Excel opens UTF-8 correctly.
  return '﻿' + rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function parseCsv(text: string, lang: string): { catalog: Catalog; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const rows = csvRows(text.replace(/^﻿/, ''));
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const [ci, cs, ct, cst] = [col('id'), col('source'), col('translation'), col('status')];
  if (ci < 0 || ct < 0) {
    diagnostics.push({ severity: 'error', line: 1, code: 'csv-header', message: `The first row must name the columns, including 'id' and 'translation' (found: ${header.join(', ')})` });
    return { catalog: { lang, entries: [] }, diagnostics };
  }
  const entries: CatalogEntry[] = [];
  rows.forEach((r, i) => {
    const id = r[ci]?.trim();
    if (!id) return;
    const status = (r[cst] ?? '').trim().toLowerCase();
    if (status && status !== 'review' && status !== 'obsolete') {
      diagnostics.push({ severity: 'warning', line: i + 2, code: 'csv-status', message: `Unknown status '${status}' (use review, obsolete or leave empty)` });
    }
    entries.push({
      id, kind: kindOf(id), speaker: null, source: cs >= 0 ? r[cs] ?? '' : '', translation: r[ct] ?? '',
      status: status === 'review' ? 'review' : status === 'obsolete' ? 'obsolete' : 'ok',
    });
  });
  return { catalog: { lang, entries }, diagnostics };
}

/** RFC 4180 rows (quoted fields may contain commas, quotes and line breaks). */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

/** Read a catalog file by its extension. */
export function parseCatalog(fileName: string, text: string): { catalog: Catalog; diagnostics: Diagnostic[] } {
  const lang = fileName.replace(/^.*[\\/]/, '').replace(/\.(po|csv)$/i, '');
  if (/\.csv$/i.test(fileName)) return parseCsv(text, lang);
  const r = parsePo(text);
  return { catalog: { ...r.catalog, lang: r.catalog.lang || lang }, diagnostics: r.diagnostics };
}

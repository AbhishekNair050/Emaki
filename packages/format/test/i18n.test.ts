import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  catalogStats, compile, compileTranslation, parseCatalog, parseCsv, parsePo, updateCatalog, writeCsv, writePo,
  type Catalog,
} from '../src/index.ts';

const SRC = `---
title: The Pier
start: a
---

define mira "Mira"

var name = "Ren"

label a:
  "The pier creaks."
  mira: Hello, {name}. *Careful.*
  menu:
    "Walk on.":
      jump b
    "Go home.":
      mira: Already?

label b:
  "The end."
`;

const strings = (src = SRC) => compile(src).strings;
const tr = (cat: Catalog, id: string, text: string) => {
  const e = cat.entries.find((x) => x.id === id || x.source === id);
  if (!e) throw new Error(`no entry ${id}`);
  e.translation = text;
};

describe('source strings', () => {
  it('lists the title, names, lines and choices with stable ids', () => {
    const s = strings();
    expect(s.map((x) => [x.kind, x.text])).toEqual([
      ['meta', 'The Pier'],
      ['name', 'Mira'],
      ['line', 'The pier creaks.'],
      ['line', 'Hello, {name}. *Careful.*'],
      ['choice', 'Walk on.'],
      ['choice', 'Go home.'],
      ['line', 'Already?'],
      ['line', 'The end.'],
    ]);
    expect(s[0]!.id).toBe('meta.title');
    expect(s[1]!.id).toBe('name.mira');
    // Same ids as the runtime sees.
    const story = compile(SRC).story!;
    const sayIds = story.code.filter((i) => i.op === 'say').map((i) => (i as { id: string }).id);
    expect(s.filter((x) => x.kind === 'line').map((x) => x.id)).toEqual(sayIds);
    expect(s[3]!.id).toMatch(/^a\./);
  });

  it('keeps ids when scenes move around', () => {
    const moved = SRC.replace('label b:\n  "The end."\n', '').replace('label a:', 'label b:\n  "The end."\n\nlabel a:');
    const before = new Map(strings().map((x) => [x.text, x.id]));
    for (const x of strings(moved)) expect(x.id).toBe(before.get(x.text));
  });
});

describe('catalogs', () => {
  it('a new catalog has every string, untranslated', () => {
    const cat = updateCatalog(strings(), null, 'fr');
    expect(cat.entries).toHaveLength(8);
    expect(catalogStats(cat)).toEqual({ total: 8, translated: 0, review: 0 });
    expect(cat.entries[3]).toMatchObject({ kind: 'line', speaker: 'mira', translation: '', status: 'ok', ref: 'story.vn:12' });
  });

  it('keeps translations, flags edited lines for review, keeps removed ones as obsolete', () => {
    const cat = updateCatalog(strings(), null, 'fr');
    tr(cat, 'The pier creaks.', 'Le ponton grince.');
    tr(cat, 'Hello, {name}. *Careful.*', 'Bonjour, {name}. *Attention.*');
    tr(cat, 'The end.', 'Fin.');
    const edited = SRC
      .replace('"The pier creaks."', '"The old pier creaks."')   // small edit → suggestion
      .replace('  "The end."\n', '  "Something entirely different happens now."\n'); // rewrite → obsolete
    const next = updateCatalog(strings(edited), cat, 'fr');
    const creak = next.entries.find((e) => e.source === 'The old pier creaks.')!;
    expect(creak).toMatchObject({ translation: 'Le ponton grince.', status: 'review', previous: 'The pier creaks.' });
    expect(next.entries.find((e) => e.source.startsWith('Hello'))).toMatchObject({ translation: 'Bonjour, {name}. *Attention.*', status: 'ok' });
    expect(next.entries.find((e) => e.source.startsWith('Something'))).toMatchObject({ translation: '', status: 'ok' });
    expect(next.entries.at(-1)).toMatchObject({ source: 'The end.', translation: 'Fin.', status: 'obsolete' });
    expect(catalogStats(next)).toEqual({ total: 8, translated: 1, review: 1 });
  });

  it('a renamed character keeps its id; the translation is flagged for review', () => {
    const cat = updateCatalog(strings(), null, 'fr');
    tr(cat, 'name.mira', 'Mira');
    const next = updateCatalog(strings(SRC.replace('"Mira"', '"Mirabel"')), cat, 'fr');
    expect(next.entries.find((e) => e.id === 'name.mira')).toMatchObject({ source: 'Mirabel', status: 'review', previous: 'Mira' });
  });
});

describe('PO files', () => {
  it('round-trips, including quotes, newlines, review and obsolete entries', () => {
    const cat = updateCatalog(strings(), null, 'fr');
    tr(cat, 'The pier creaks.', 'Le "ponton"\ngrince.');
    cat.entries.push({ id: 'old.x', kind: 'line', speaker: null, source: 'Gone', translation: 'Parti', status: 'obsolete' });
    cat.entries[2]!.status = 'review';
    cat.entries[2]!.previous = 'The pier creaked.';
    const po = writePo(cat, 'The Pier');
    expect(po).toContain('msgctxt "meta.title"\nmsgid "The Pier"');
    expect(po).toContain('#. Spoken by mira');
    expect(po).toContain('#, fuzzy\n#| msgid "The pier creaked."');
    expect(po).toContain('msgstr "Le \\"ponton\\"\\ngrince."');
    expect(po).toContain('#~ msgctxt "old.x"');
    const back = parsePo(po);
    expect(back.diagnostics).toEqual([]);
    expect(back.catalog.lang).toBe('fr');
    expect(back.catalog.entries.map((e) => [e.id, e.source, e.translation, e.status])).toEqual(
      cat.entries.map((e) => [e.id, e.source, e.translation, e.status]));
    expect(back.catalog.entries[2]!.previous).toBe('The pier creaked.');
  });

  it('reads multi-line strings as written by translation tools', () => {
    const po = [
      'msgid ""', 'msgstr ""', '"Language: de\\n"', '',
      '#: story.vn:11', 'msgctxt "a.x"', 'msgid ""', '"The pier "', '"creaks."', 'msgstr ""', '"Der Steg "', '"knarrt."', '',
    ].join('\n');
    const { catalog } = parsePo(po);
    expect(catalog.entries).toEqual([{ id: 'a.x', kind: 'line', speaker: null, source: 'The pier creaks.', translation: 'Der Steg knarrt.', status: 'ok', ref: 'story.vn:11' }]);
  });
});

describe('CSV files', () => {
  it('round-trips through a spreadsheet-friendly format', () => {
    const cat = updateCatalog(strings(), null, 'es');
    tr(cat, 'Hello, {name}. *Careful.*', 'Hola, {name}. *Cuidado,* "amigo".');
    cat.entries[2]!.status = 'review';
    const csv = writeCsv(cat);
    expect(csv.startsWith('\uFEFFid,speaker,source,translation,status\r\n')).toBe(true);
    expect(csv).toContain('"Hola, {name}. *Cuidado,* ""amigo""."');
    const back = parseCsv(csv, 'es');
    expect(back.diagnostics).toEqual([]);
    expect(back.catalog.entries.map((e) => [e.id, e.source, e.translation, e.status])).toEqual(
      cat.entries.map((e) => [e.id, e.source, e.translation, e.status]));
  });

  it('names the language after the file and explains a bad header', () => {
    expect(parseCatalog('lang/pt-BR.csv', 'id,translation\r\na.x,Olá\r\n').catalog).toMatchObject({ lang: 'pt-BR', entries: [{ id: 'a.x', translation: 'Olá' }] });
    expect(parseCatalog('fr.csv', 'foo,bar\n').diagnostics[0]!.message).toContain("'id' and 'translation'");
  });
});

describe('compiled translations', () => {
  it('uses ok entries, splits markup, and checks variables', () => {
    const s = strings();
    const cat = updateCatalog(s, null, 'fr');
    tr(cat, 'meta.title', 'Le Ponton');
    tr(cat, 'name.mira', 'Myra');
    tr(cat, 'Hello, {name}. *Careful.*', 'Bonjour, {name}. *Attention.*');
    tr(cat, 'Walk on.', 'Avancer {nmae}.');
    tr(cat, 'Already?', 'Déjà ?');
    cat.entries.find((e) => e.source === 'Already?')!.status = 'review';
    tr(cat, 'Go home.', 'Rentrer *à la maison.');
    const r = compileTranslation(cat, s);
    expect(r.translation.meta).toEqual({ title: 'Le Ponton' });
    expect(r.translation.names).toEqual({ mira: 'Myra' });
    const hello = s.find((x) => x.text.startsWith('Hello'))!.id;
    expect(r.translation.strings[hello]).toEqual({
      text: 'Bonjour, {name}. Attention.',
      spans: [{ text: 'Bonjour, {name}. ' }, { text: 'Attention.', i: true }],
    });
    expect(Object.keys(r.translation.strings)).toEqual([hello]); // the bad and the review ones are left out
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual(['translation-markup', 'translation-variable']);
    expect(r.stats).toEqual({ total: 8, translated: 3, review: 1 });
  });

  it('covers the whole demo', () => {
    const demo = readFileSync(new URL('../../../games/gullwing/story.vn', import.meta.url), 'utf8');
    const s = compile(demo).strings;
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    expect(s.filter((x) => x.kind === 'line').length).toBe(64);
    const po = writePo(updateCatalog(s, null, 'fr'));
    expect(parsePo(po).catalog.entries).toHaveLength(s.length);
  });
});

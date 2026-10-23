#!/usr/bin/env node
/**
 * Emaki CLI.
 *
 *   emaki check <story.vn>            report errors and warnings
 *   emaki build <story.vn> [out.json] compile to the runtime format
 *   emaki graph <story.vn>            print a Mermaid flowchart of labels
 *   emaki fmt <story.vn> [--write|--check]  print, rewrite, or verify canonical form
 *                                     (comments and blank lines are kept)
 *   emaki strings <story.vn> [--lang fr,de] [--csv]
 *                                     create/update translation files in lang/, or report progress
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  buildGraph, catalogStats, compile, compileTranslation, parse, parseCatalog, print, toMermaid, updateCatalog, writeCsv, writePo,
  type Diagnostic,
} from '@emaki/format';
import { uiSourceStrings } from '@emaki/player-web/ui-strings';

const [cmd, file, ...rest] = process.argv.slice(2);

const USAGE = `Usage:
  emaki check <story.vn>
  emaki build <story.vn> [out.json]
  emaki graph <story.vn>
  emaki fmt   <story.vn> [--write | --check]
  emaki strings <story.vn> [--lang fr,de] [--csv]   translation files in lang/ (without --lang: progress)`;

if (!cmd || !file || cmd === 'help' || cmd === '--help') {
  console.log(USAGE);
  process.exit(cmd ? 0 : 1);
}

let source: string;
try {
  source = readFileSync(file, 'utf8');
} catch {
  console.error(`Can't read '${file}'`);
  process.exit(1);
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

function report(diags: Diagnostic[]): boolean {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  for (const d of diags) {
    const tag = d.severity === 'error' ? c('31;1', 'error') : c('33;1', 'warning');
    console.log(`${basename(file!)}:${d.line}: ${tag} ${d.message} ${c('2', `[${d.code}]`)}`);
    const src = lines[d.line - 1];
    if (src !== undefined) console.log(c('2', `  ${String(d.line).padStart(4)} | `) + src.trim());
  }
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.length - errors;
  console.log(errors || warnings
    ? `${errors} error(s), ${warnings} warning(s)`
    : c('32', '✓ No problems found'));
  return errors === 0;
}

switch (cmd) {
  case 'check': {
    const r = compile(source);
    const ok = report(r.diagnostics);
    if (r.story) {
      const says = r.story.code.filter((i) => i.op === 'say').length;
      const menus = r.story.code.filter((i) => i.op === 'menu').length;
      console.log(c('2', `${Object.keys(r.story.labels).length} labels, ${says} lines of dialogue, ${menus} menus`));
    }
    process.exit(ok ? 0 : 1);
  }
  // falls through (unreachable; process.exit above)
  case 'build': {
    const r = compile(source);
    if (!report(r.diagnostics) || !r.story) process.exit(1);
    const out = rest[0] ?? file.replace(/\.vn$/, '') + '.compiled.json';
    writeFileSync(out, JSON.stringify(r.story, null, 2));
    console.log(`Wrote ${out}`);
    break;
  }
  case 'graph': {
    const { program, diagnostics } = parse(source);
    if (diagnostics.some((d) => d.severity === 'error')) { report(diagnostics); process.exit(1); }
    process.stdout.write(toMermaid(buildGraph(program)));
    break;
  }
  case 'fmt': {
    const { program, diagnostics } = parse(source);
    if (diagnostics.some((d) => d.severity === 'error')) {
      report(diagnostics);
      console.error('Not formatting a file with errors.');
      process.exit(1);
    }
    const out = print(program);
    const formatted = out === source.replace(/\r\n?/g, '\n');
    if (rest.includes('--check')) {
      if (formatted) {
        console.log(c('32', `✓ ${file} is formatted`));
        break;
      }
      console.log(`${file} is not formatted. Run: emaki fmt ${file} --write`);
      process.exit(1);
    }
    if (rest.includes('--write')) {
      if (formatted) console.log(`${file} was already formatted`);
      else {
        writeFileSync(file, out);
        console.log(`Formatted ${file}`);
      }
    } else process.stdout.write(out);
    break;
  }
  case 'strings':
    strings();
    break;
  default:
    console.error(`Unknown command '${cmd}'\n\n${USAGE}`);
    process.exit(1);
}

/**
 * Translation files. With --lang: create or update lang/<code>.po (or .csv)
 * next to the story, keeping existing translations. Without: show progress.
 */
function strings(): void {
  const r = compile(source);
  if (!r.story) {
    report(r.diagnostics);
    console.error('Fix the errors first: translations are matched to lines of the compiled story.');
    process.exit(1);
  }
  const all = [...r.strings, ...uiSourceStrings()];
  const langDir = join(dirname(file!), 'lang');
  const at = rest.indexOf('--lang');
  const langs = at >= 0 ? (rest[at + 1] ?? '').split(',').map((x) => x.trim()).filter(Boolean) : null;
  const pct = (a: number, b: number) => `${Math.floor((a / Math.max(b, 1)) * 100)}%`;

  if (!langs) {
    const files = existsSync(langDir) ? readdirSync(langDir).filter((f) => /\.(po|csv)$/i.test(f)).sort() : [];
    if (!files.length) {
      console.log(`No translations yet. Start one with: emaki strings ${file} --lang fr`);
      return;
    }
    let ok = true;
    for (const f of files) {
      const { catalog, diagnostics } = parseCatalog(f, readFileSync(join(langDir, f), 'utf8'));
      const t = compileTranslation(catalog, all);
      const problems = [...diagnostics, ...t.diagnostics];
      if (problems.some((d) => d.severity === 'error')) ok = false;
      const review = t.stats.review ? `, ${t.stats.review} to review` : '';
      console.log(`${c('1', catalog.lang.padEnd(6))} ${pct(t.stats.translated, t.stats.total).padStart(4)}  ${t.stats.translated}/${t.stats.total} translated${review}  ${c('2', `lang/${f}`)}`);
      for (const d of problems) console.log(`  ${d.severity === 'error' ? c('31;1', 'error') : c('33;1', 'warning')} ${d.message}`);
    }
    if (!ok) process.exit(1);
    return;
  }

  if (!langs.length) {
    console.error('Name the languages: --lang fr or --lang fr,de,pt-BR');
    process.exit(1);
  }
  mkdirSync(langDir, { recursive: true });
  for (const lang of langs) {
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(lang)) {
      console.error(`'${lang}' isn't a language code (examples: fr, de, pt-BR, zh-Hans)`);
      process.exit(1);
    }
    const po = join(langDir, `${lang}.po`);
    const csv = join(langDir, `${lang}.csv`);
    const target = existsSync(po) ? po : existsSync(csv) ? csv : rest.includes('--csv') ? csv : po;
    const existing = existsSync(target) ? parseCatalog(target, readFileSync(target, 'utf8')).catalog : null;
    const updated = updateCatalog(all, existing, lang, basename(file!));
    writeFileSync(target, target.endsWith('.csv') ? writeCsv(updated) : writePo(updated, r.story.meta.title ?? ''));
    const st = catalogStats(updated);
    const obsolete = updated.entries.filter((e) => e.status === 'obsolete').length;
    console.log(`${existing ? 'Updated' : 'Created'} ${target}: ${st.translated}/${st.total} translated (${pct(st.translated, st.total)})`
      + (st.review ? `, ${st.review} to review (the original changed)` : '')
      + (obsolete ? `, ${obsolete} kept from lines that no longer exist` : ''));
  }
}

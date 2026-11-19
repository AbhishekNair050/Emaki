#!/usr/bin/env node
/**
 * Emaki CLI.
 *
 * A story.vn stands for its whole game: every other .vn file in its folder
 * is part of the same story (see @emaki/format/files). Any other .vn file is
 * checked on its own.
 *
 *   emaki new <folder> [--title "Name"]  start a game: a small story that runs as it is
 *   emaki check <story.vn>            report errors and warnings
 *   emaki build <story.vn> [out.json] compile to the runtime format
 *   emaki graph <story.vn>            print a Mermaid flowchart of labels
 *   emaki fmt <story.vn> [--write|--check]  print, rewrite, or verify canonical form
 *                                     (comments and blank lines are kept)
 *   emaki strings <story.vn> [--lang fr,de] [--csv]
 *                                     create/update translation files in lang/, or report progress
 *   emaki voices <story.vn>           write the recording script (voice-script.csv) and report
 *                                     which voice files are missing or left over
 *   emaki plugin <game folder> <name> [--ts]
 *                                     start a plugin: plugins/<name>/ with a command that works as it is
 *   emaki export <web|desktop|android|ios> <game folder> [--platform win32|darwin|linux] [--arch x64|arm64] [--no-build]
 *                                     package the game for players (into <game>/export/)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import {
  buildGraph, catalogStats, compileFiles, compileTranslation, packStory, parse, parseCatalog, print, toMermaid, updateCatalog, voicePath, writeCsv, writePo,
  type Diagnostic, type StoryFile,
} from '@emaki/format';
import { addVoices, MAIN_FILE, pluginManifests, readPlugins, storyParts } from '@emaki/format/files';
import { uiSourceStrings } from '@emaki/player-web/ui-strings';
import { runExport, TARGETS, type Target } from './export.ts';
import { newGame } from './new.ts';
import { newPlugin } from './new-plugin.ts';

const [cmd, file, ...rest] = process.argv.slice(2);

const USAGE = `Usage:
  emaki launch [--port 5175] [--no-open]          open the project launcher
  emaki edit  <game folder> [--no-open]           open the editor for a game
  emaki play  <game folder> [--no-open]           play a game with live reload
  emaki new   <folder> [--title "Name"]            start a new game in a new folder
  emaki plugin <game folder> <name> [--ts]         start a plugin (plugins/<name>/, see docs/plugins.md)
  emaki check <story.vn>
  emaki build <story.vn> [out.json]
  emaki graph <story.vn>
  emaki fmt   <story.vn> [--write | --check]
  emaki strings <story.vn> [--lang fr,de] [--csv]   translation files in lang/ (without --lang: progress)
  emaki voices  <story.vn>                          recording script and missing voice files (header 'voice:')
  emaki export  <web|desktop|android|ios> <game folder> [--platform win32|darwin|linux] [--arch x64|arm64] [--shell webview2|electron] [--no-build]`;

if (cmd === 'launch' || cmd === 'edit' || cmd === 'play') {
  try {
    const { installShutdown, openOnDesktop, Sessions } = await import('./serve.ts');
    const args = process.argv.slice(3);
    const open = !args.includes('--no-open');
    if (cmd === 'launch') {
      const unknown = args.filter((a, i) => a !== '--no-open' && a !== '--port' && args[i - 1] !== '--port');
      if (unknown.length) throw new Error(`Unknown launcher option: ${unknown[0]}`);
      const portIndex = args.indexOf('--port');
      const port = portIndex < 0 ? 5175 : Number(args[portIndex + 1]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be a number from 1 to 65535.');
      const { startLauncher } = await import('./launcher.ts');
      const launcher = await startLauncher({ port, open });
      installShutdown(() => launcher.close());
      console.log(`\nEmaki launcher: ${launcher.url}\nKeep this terminal open. Press Ctrl+C to stop the launcher and its previews.\n`);
    } else {
      if (!file || file.startsWith('--')) throw new Error(`Usage: emaki ${cmd} <game folder> [--no-open]`);
      if (rest.some((a) => a !== '--no-open')) throw new Error(`Unknown option: ${rest.find((a) => a !== '--no-open')}`);
      const sessions = new Sessions();
      const session = await sessions.start(file, cmd === 'edit' ? 'editor' : 'play');
      installShutdown(() => sessions.close());
      console.log(`\n${cmd === 'edit' ? 'Editor' : 'Player'}: ${session.url}\nPress Ctrl+C to stop.\n`);
      if (open) await openOnDesktop(session.url).catch(() => console.log('Open the address above in your browser.'));
    }
    // Servers keep Node alive. The remaining CLI commands run only in the other branch.
    await new Promise<never>(() => {});
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (!cmd || !file || cmd === 'help' || cmd === '--help') {
  console.log(USAGE);
  process.exit(cmd ? 0 : 1);
}

if (cmd === 'export') await exportCommand();
if (cmd === 'new') newCommand();
if (cmd === 'plugin') pluginCommand();

let source: string;
try {
  source = readFileSync(file, 'utf8');
} catch {
  console.error(`Can't read '${file}'`);
  process.exit(1);
}
/** The story's other files, when `file` is a game's story.vn. */
const parts: StoryFile[] = basename(file) === MAIN_FILE
  ? storyParts(dirname(file)).map((path) => ({ path, source: readFileSync(join(dirname(file!), path), 'utf8') }))
  : [];
/** The story; for a game's story.vn, with the voice files found in its assets/. */
const compileStory = () => {
  if (basename(file!) !== MAIN_FILE) return compileFiles(source, parts);
  // A game: its plugins are checked too, and their uses in the script against them.
  const { plugins, diagnostics } = readPlugins(dirname(file!));
  const r = compileFiles(source, parts, { plugins: pluginManifests(plugins) });
  if (r.story) addVoices(r.story, dirname(file!));
  const all = [...diagnostics, ...r.diagnostics];
  return { ...r, diagnostics: all, story: all.some((d) => d.severity === 'error') ? null : r.story };
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

function report(diags: Diagnostic[]): boolean {
  const split = (t: string) => t.replace(/\r\n?/g, '\n').split('\n');
  const files = new Map<string | undefined, string[]>([[undefined, split(source)], ...parts.map((p): [string, string[]] => [p.path, split(p.source)])]);
  for (const d of diags) {
    const tag = d.severity === 'error' ? c('31;1', 'error') : c('33;1', 'warning');
    console.log(`${d.file ?? basename(file!)}:${d.line}: ${tag} ${d.message} ${c('2', `[${d.code}]`)}`);
    const src = files.get(d.file)?.[d.line - 1];
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
    const r = compileStory();
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
    const r = compileStory();
    if (!report(r.diagnostics) || !r.story) process.exit(1);
    const out = rest[0] ?? file.replace(/\.vn$/, '') + '.compiled.json';
    writeFileSync(out, JSON.stringify(packStory(r.story)));
    console.log(`Wrote ${out}`);
    break;
  }
  case 'graph': {
    const { program, diagnostics } = compileStory();
    if (diagnostics.some((d) => d.severity === 'error')) { report(diagnostics); process.exit(1); }
    process.stdout.write(toMermaid(buildGraph(program)));
    break;
  }
  case 'fmt': {
    // Each file of the story is formatted on its own.
    const all = [{ path: file, source }, ...parts.map((p) => ({ path: join(dirname(file), p.path), source: p.source }))];
    const check = rest.includes('--check');
    const write = rest.includes('--write');
    if (!check && !write && all.length > 1) {
      console.error(`${file} has ${all.length - 1} more file(s); use --write or --check to format them all.`);
      process.exit(1);
    }
    let bad = false;
    for (const f of all) {
      const { program, diagnostics } = parse(f.source);
      if (diagnostics.some((d) => d.severity === 'error')) {
        for (const d of diagnostics) console.log(`${f.path}:${d.line}: ${d.message}`);
        console.error(`Not formatting ${f.path}: it has errors.`);
        process.exit(1);
      }
      const out = print(program);
      const formatted = out === f.source.replace(/\r\n?/g, '\n');
      if (check) {
        if (formatted) console.log(c('32', `✓ ${f.path} is formatted`));
        else { console.log(`${f.path} is not formatted. Run: emaki fmt ${file} --write`); bad = true; }
      } else if (write) {
        if (formatted) console.log(`${f.path} was already formatted`);
        else { writeFileSync(f.path, out); console.log(`Formatted ${f.path}`); }
      } else process.stdout.write(out);
    }
    if (bad) process.exit(1);
    break;
  }
  case 'strings':
    strings();
    break;
  case 'voices':
    voices();
    break;
  default:
    console.error(`Unknown command '${cmd}'\n\n${USAGE}`);
    process.exit(1);
}

function newCommand(): never {
  const at = rest.indexOf('--title');
  const title = at >= 0 ? rest[at + 1] : undefined;
  try {
    const files = newGame(file!, title);
    console.log(`✓ Started a game in ${file}`);
    for (const f of files) console.log(`  ${f}`);
    const game = file!.replace(/\\/g, '/');
    console.log(`
Play it while you write (it reloads as you save):
  bash:       EMAKI_GAME=${game} npm run dev
  PowerShell: $env:EMAKI_GAME="${game}"; npm run dev
Or open it in the editor: the same, with 'npm run edit'.
Then: docs/getting-started.md`);
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

function pluginCommand(): never {
  const name = rest.find((a) => !a.startsWith('--'));
  const unknown = rest.find((a) => a.startsWith('--') && a !== '--ts');
  try {
    if (!name) throw new Error('Usage: emaki plugin <game folder> <name> [--ts]');
    if (unknown) throw new Error(`Unknown option: ${unknown}`);
    const files = newPlugin(file!, name, rest.includes('--ts'));
    console.log(`✓ Started the plugin @${name}`);
    for (const f of files) console.log(`  ${f}`);
    console.log(`
Use it in the story:  @${name} note text="Hello!"
Then: docs/plugins.md`);
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

/**
 * For a voiced game (header `voice: voice/{id}.ogg`): write voice-script.csv,
 * every line with the file it needs, for recording; then report the lines
 * still missing a file and the files no line uses (a line whose text changed
 * gets a new id, so its old recording shows up here).
 */
function voices(): void {
  const r = compileStory();
  if (!r.story) {
    report(r.diagnostics);
    process.exit(1);
  }
  const pattern = r.story.meta.voice;
  if (!pattern?.includes('{id}')) {
    console.error(`Add a voice pattern to the header first, for example:\n  voice: voice/{id}.ogg\n(paths are inside assets/; {speaker} is the character id)`);
    process.exit(1);
  }
  const gameDir = dirname(file!);
  const assets = join(gameDir, 'assets');
  const lines = r.story.code.flatMap((i) => (i.op === 'say' ? [i] : []));
  // Lines voiced by a `play voice` just before them don't need a file of their own.
  const code = r.story.code;
  const played = new Set(code.flatMap((ins, k) => {
    const prev = code[k - 1];
    return ins.op === 'say' && prev?.op === 'play' && prev.channel === 'voice' ? [ins.id] : [];
  }));
  const names = r.story.characters;
  const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [['file', 'speaker', 'text', 'recorded', 'label', 'where'].join(',')];
  const expected = new Set<string>();
  let spoken = 0;
  let recorded = 0;
  let narrationRecorded = 0;
  for (const ins of lines) {
    const path = voicePath(pattern, ins.id, ins.who);
    expected.add(path);
    const has = played.has(ins.id) || existsSync(join(assets, path));
    if (ins.who) { spoken++; if (has) recorded++; } else if (has) narrationRecorded++;
    const speaker = ins.who ? (names[ins.who]?.name ?? ins.who) : '';
    rows.push([path, speaker, ins.text, played.has(ins.id) ? 'play voice' : has ? 'yes' : 'no', ins.src.label, `${ins.src.file ?? MAIN_FILE}:${ins.src.line}`].map(quote).join(','));
  }
  const out = join(gameDir, 'voice-script.csv');
  writeFileSync(out, rows.join('\n') + '\n');
  console.log(`Wrote ${out}: ${lines.length} lines, ${spoken} spoken by characters`);
  console.log(`${recorded}/${spoken} spoken lines have a voice file${narrationRecorded ? `, and ${narrationRecorded} narration line(s)` : ''}`);
  // Files in the voice folder that no line asks for.
  const folder = pattern.slice(0, pattern.indexOf('{')).replace(/[^/]*$/, '');
  const root = join(assets, folder);
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else found.push(relative(assets, p).split(sep).join('/'));
    }
  };
  if (folder && existsSync(root)) walk(root);
  const extra = found.filter((f) => !expected.has(f)).sort();
  if (extra.length) {
    console.log(c('33;1', `${extra.length} file(s) in assets/${folder} no line uses`) + c('2', ' (a line whose speaker or text changed gets a new id; rename its file to the new one in voice-script.csv)'));
    for (const f of extra.slice(0, 20)) console.log(`  ${f}`);
    if (extra.length > 20) console.log(`  ... and ${extra.length - 20} more`);
  }
}

/**
 * Translation files. With --lang: create or update lang/<code>.po (or .csv)
 * next to the story, keeping existing translations. Without: show progress.
 */
function strings(): void {
  const r = compileStory();
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

async function exportCommand(): Promise<never> {
  const target = file as Target;
  const game = rest[0] && !rest[0].startsWith('--') ? rest[0] : '.';
  const opt = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (!TARGETS.includes(target)) {
    console.error(`Export to what? One of: ${TARGETS.join(', ')}`);
    console.error(USAGE);
    process.exit(1);
  }
  try {
    const platform = opt('--platform');
    const arch = opt('--arch');
    const shell = opt('--shell');
    if (rest.includes('--shell') && !shell) throw new Error('--shell requires webview2 or electron.');
    const notes = await runExport({
      target, game, noBuild: rest.includes('--no-build'),
      ...(platform ? { platform } : {}),
      ...(arch ? { arch } : {}),
      ...(shell ? { shell } : {}),
    }, (m) => console.log(m));
    console.log('');
    for (const n of notes) console.log(n);
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

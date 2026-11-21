/**
 * `emaki import renpy <Ren'Py project> <new folder>`: a Ren'Py project (its .rpy scripts and files) as a new Emaki
 * game. The scripts are converted (convert.ts), the game's files copied into assets/, pictures Ren'Py composed from
 * parts made into single files, and the result compiled: a line that still doesn't compile is commented out, so the
 * game always opens, and import-report.md lists everything left out.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { compileGame, where } from '@emaki/format/files';
import { parseRpy } from './lines.ts';
import { convertRenpy, type Converted, type ImageDecl, type Issue } from './convert.ts';

/** Never copied into the Emaki game: Ren'Py's scripts, compiled scripts, archives and caches. */
const SKIP_FILES = /\.(rpy|rpyc|rpym|rpymc|rpyb|rpa|bak|pyc|pyo)$/i;
const SKIP_DIRS = new Set(['cache', 'saves', 'tl', 'python-packages', '__pycache__', '.git']);
const PICTURES = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;

export interface ImportResult {
  dest: string;
  scripts: number;
  labels: number;
  lines: number;
  copied: number;
  made: number;
  /** Lines left out or changed, and lines commented out because they didn't compile. */
  issues: number;
  fixed: number;
  report: string;
}

/** The project's game/ folder: the folder given, or its game/ subfolder. */
export function findGameFolder(src: string): string {
  const dir = resolve(src);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder.`);
  const game = existsSync(join(dir, 'game')) && statSync(join(dir, 'game')).isDirectory() ? join(dir, 'game') : dir;
  const scripts = walk(game).filter((f) => /\.rpy$/i.test(f));
  if (!scripts.length) {
    const packed = walk(game).some((f) => /\.(rpa|rpyc)$/i.test(f));
    throw new Error(packed
      ? `${game} has only built scripts (.rpyc, .rpa): the importer reads a project's .rpy sources, as the Ren'Py launcher keeps them.`
      : `No Ren'Py scripts (.rpy) in ${game}.`);
  }
  return game;
}

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(root, join(dir, e.name), out); }
    else if (e.isFile()) out.push(relative(root, join(dir, e.name)).split(sep).join('/'));
  }
  return out;
}

export async function importRenpy(src: string, destArg: string, opts: { title?: string; log?: (m: string) => void } = {}): Promise<ImportResult> {
  const log = opts.log ?? (() => {});
  const game = findGameFolder(src);
  const dest = resolve(destArg);
  if (existsSync(dest) && readdirSync(dest).length) throw new Error(`${dest} already has files in it. Choose a new folder.`);
  mkdirSync(dest, { recursive: true });

  const all = walk(game);
  const scripts = all.filter((f) => /\.rpy$/i.test(f) && !f.startsWith('renpy/'));
  const files = new Set(all.filter((f) => !SKIP_FILES.test(f)));
  // Ren'Py finds files without regard to case on Windows; so do the paths it is given here.
  const lower = new Map([...files].map((f) => [f.toLowerCase(), f]));
  const exists = (rel: string) => files.has(rel) || lower.has(rel.toLowerCase());
  log(`Reading ${scripts.length} scripts…`);
  const parsed = scripts.map((path) => ({ path, lines: parseRpy(readFileSync(join(game, path), 'utf8')) }));
  const imageFiles = [...files].filter((f) => f.toLowerCase().startsWith('images/') && PICTURES.test(f)).map((f) => f.slice('images/'.length));
  const c = convertRenpy(parsed, { exists, imageFiles });
  // Paths as the game's files spell them.
  const spell = (rel: string) => files.has(rel) ? rel : lower.get(rel.toLowerCase()) ?? rel;

  log(`Copying ${files.size} files…`);
  const assets = join(dest, 'assets');
  for (const rel of files) {
    const to = join(assets, ...rel.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(game, ...rel.split('/')), to);
  }
  const made = c.images.filter((i) => i.made);
  if (made.length) log(`Making ${made.length} pictures Ren'Py composed from parts…`);
  await makeImages(made, game, assets, spell);

  let story = c.story;
  if (opts.title) story = story.replace(/^---\n(title: .*\n)?/, `---\ntitle: ${opts.title}\n`);
  writeFileSync(join(dest, 'story.vn'), fixCase(story, spell));
  for (const [path, text] of Object.entries(c.files)) {
    mkdirSync(dirname(join(dest, path)), { recursive: true });
    writeFileSync(join(dest, path), fixCase(text, spell));
  }

  log('Checking the imported story…');
  const fixes = repair(dest);
  const report = writeReport(dest, game, c, fixes);
  const labels = Object.values(c.files).reduce((n, t) => n + (t.match(/^label /gm)?.length ?? 0), 0);
  return {
    dest, scripts: scripts.length, labels, lines: parsed.reduce((n, f) => n + countLines(f.lines), 0),
    copied: files.size, made: made.length, issues: c.issues.length, fixed: fixes.length, report,
  };
}

const countLines = (lines: { block: unknown[] }[]): number => lines.reduce((n, l) => n + 1 + countLines(l.block as { block: unknown[] }[]), 0);

/** Quoted asset paths, spelt as the files are. */
function fixCase(text: string, spell: (rel: string) => string): string {
  return text.replace(/^(\s*(?:image|audio)\s+[^=]+=\s*)"([^"]+)"/gm, (_, head: string, p: string) => `${head}"${spell(p)}"`);
}

async function makeImages(list: ImageDecl[], game: string, assets: string, spell: (rel: string) => string): Promise<void> {
  if (!list.length) return;
  const { default: sharp } = await import('sharp');
  sharp.cache(false);
  const one = async (img: ImageDecl) => {
    const out = join(assets, ...img.asset.split('/'));
    mkdirSync(dirname(out), { recursive: true });
    const m = img.made!;
    if (m.kind === 'solid') {
      const hex = m.color.replace('#', '');
      const full = hex.length <= 4 ? hex.split('').map((ch) => ch + ch).join('') : hex;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
      const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
      await sharp({ create: { width: 16, height: 9, channels: 4, background: { r: r!, g: g!, b: b!, alpha } } }).png().toFile(out);
      return;
    }
    const layers = m.parts.map((p) => ({ input: join(game, ...spell(p.path).split('/')), left: Math.round(p.at[0]), top: Math.round(p.at[1]) }));
    await sharp({ create: { width: m.size[0], height: m.size[1], channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(layers).png({ compressionLevel: 6 }).toFile(out);
  };
  // PNG, quick to write: an export's compression can make them WebP.
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, cpus().length)) }, async () => {
    while (next < list.length) await one(list[next++]!);
  }));
}

interface Fix { file: string; line: number; text: string; message: string }

/**
 * Compile the imported game and comment out each line that doesn't compile (a block with its lines), until it does.
 * A line whose only problem is a character's expression keeps its words and loses the expression.
 */
function repair(dest: string): Fix[] {
  const fixes: Fix[] = [];
  for (let round = 0; round < 25; round++) {
    const r = compileGame(dest);
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    if (!errors.length) break;
    const byFile = new Map<string, typeof errors>();
    for (const e of errors) byFile.set(e.file ?? 'story.vn', [...(byFile.get(e.file ?? 'story.vn') ?? []), e]);
    let changed = false;
    for (const [f, list] of byFile) {
      const path = join(dest, f);
      if (!existsSync(path)) continue;
      const lines = readFileSync(path, 'utf8').split('\n');
      // From the bottom, so the line numbers above stay right.
      for (const e of [...list].sort((a, b) => b.line - a.line)) {
        const i = e.line - 1;
        const line = lines[i];
        if (line === undefined || line.trimStart().startsWith('#')) continue;
        const say = /^(\s*)([A-Za-z_]\w*)((?:\s+-?[A-Za-z_]\w*)+)(:\s.*)$/.exec(line);
        if (say && /image|sprite|attribute|expression/i.test(e.message)) {
          lines[i] = `${say[1]}${say[2]}${say[4]}`;
          fixes.push({ file: f, line: e.line, text: line.trim(), message: `${e.message} (kept the line without the expression)` });
          changed = true;
          continue;
        }
        const indent = /^\s*/.exec(line)![0].length;
        let end = i + 1;
        if (line.trimEnd().endsWith(':')) while (end < lines.length && (lines[end]!.trim() === '' || /^\s*/.exec(lines[end]!)![0].length > indent)) end++;
        for (let k = i; k < end; k++) if (lines[k]!.trim()) lines[k] = `${' '.repeat(indent)}# renpy (didn't compile): ${lines[k]!.trim()}`;
        // A block left empty gets a line that does nothing.
        const prev = lines.slice(0, i).reverse().find((x) => x.trim() && !x.trim().startsWith('#'));
        const prevIndent = prev ? /^\s*/.exec(prev)![0].length : -1;
        const nextReal = lines.slice(end).find((x) => x.trim() && !x.trim().startsWith('#'));
        const nextIndent = nextReal ? /^\s*/.exec(nextReal)![0].length : -1;
        if (prev?.trimEnd().endsWith(':') && prevIndent < indent && nextIndent < indent) lines.splice(end, 0, `${' '.repeat(indent)}wait 0`);
        fixes.push({ file: f, line: e.line, text: line.trim(), message: e.message });
        changed = true;
      }
      writeFileSync(path, lines.join('\n'));
    }
    if (!changed) break;
  }
  return fixes;
}

function writeReport(dest: string, game: string, c: Converted, fixes: Fix[]): string {
  const out: string[] = [];
  out.push(`# Imported from Ren'Py`, '', `From \`${game}\`. Each script is in \`scripts/\`, next to \`story.vn\` (the header and every character, picture, sound and variable); the game's files are in \`assets/\` as they were.`, '');
  out.push(`Lines the importer couldn't convert are kept as \`# renpy:\` comments where they were, so the story around them still runs. Look for them with your editor's search.`, '');
  const byWhy = new Map<string, Issue[]>();
  for (const i of c.issues) byWhy.set(i.why, [...(byWhy.get(i.why) ?? []), i]);
  if (byWhy.size) {
    out.push('## Left out or changed', '');
    for (const [why, list] of [...byWhy].sort((a, b) => b[1].length - a[1].length)) {
      out.push(`### ${why[0]!.toUpperCase()}${why.slice(1)} (${list.length})`, '');
      for (const i of list.slice(0, 40)) out.push(`- \`${i.file}:${i.line}\` \`${i.text.length > 120 ? i.text.slice(0, 117) + '…' : i.text}\``);
      if (list.length > 40) out.push(`- …and ${list.length - 40} more`);
      out.push('');
    }
  }
  const counts = Object.entries(c.counts).sort((a, b) => b[1] - a[1]);
  if (counts.length) {
    out.push('## Left out without a comment', '', '| What | Times |', '|---|---|');
    for (const [what, n] of counts) out.push(`| ${what} | ${n} |`);
    out.push('');
  }
  if (fixes.length) {
    out.push(`## Commented out because they didn't compile (${fixes.length})`, '');
    for (const f of fixes.slice(0, 200)) out.push(`- \`${where({ line: f.line, ...(f.file !== 'story.vn' ? { file: f.file } : {}) })}\` ${f.message}: \`${f.text.length > 100 ? f.text.slice(0, 97) + '…' : f.text}\``);
    if (fixes.length > 200) out.push(`- …and ${fixes.length - 200} more`);
    out.push('');
  }
  if (!c.canvas) out.push(`The game's screen size wasn't found (\`gui.init\` or \`config.screen_width\`), so 1280x720 is assumed in \`story.vn\`'s \`canvas:\`.`, '');
  const text = out.join('\n');
  writeFileSync(join(dest, 'import-report.md'), text);
  return join(dest, 'import-report.md');
}



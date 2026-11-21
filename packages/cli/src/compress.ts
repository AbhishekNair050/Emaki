/**
 * Making an exported game smaller: pictures to WebP (and, if asked, no bigger
 * than the game's screen needs), sound and voices to Opus, movies to H.264.
 * Only the export's copy changes; the game's assets/ folder is never touched.
 *
 * Each setting is off unless the game's export.json turns it on (the launcher
 * writes it from the Export card). Files that come out no smaller stay as
 * they were. A file whose name changes (bg/a.png → bg/a.webp) is listed in
 * game.json's `renamed`, and a picture made smaller in `sizes` (its size as
 * drawn): the player looks every path up in both, so the story itself never
 * needs rewriting.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import { parseAspect, parseCanvas } from '@emaki/format';

export interface Compression {
  /** WebP for PNG and BMP: `lossless`, or a quality from 50 to 100. */
  images: 'off' | 'lossless' | number;
  /**
   * Pictures bigger than the game's screen, made smaller: a percentage of the screen (100 to 400) a picture must
   * still cover. A picture that is wider or taller than the screen in only one direction (a panorama) is kept.
   */
  shrink: 'off' | number;
  /** Music and sound effects: Opus, in kbit/s for a stereo file (24 to 256); mono files get half. */
  audio: 'off' | number;
  /**
   * Voices (see `gameFacts`): Opus, in kbit/s (16 to 256), mono or stereo; or `audio`, the default, to treat them as
   * music and sound are.
   */
  voice: 'off' | 'audio' | number;
  /** H.264 CRF: 15 (near perfect, large) to 40 (small). */
  video: 'off' | number;
}

export const NO_COMPRESSION: Compression = { images: 'off', shrink: 'off', audio: 'off', voice: 'audio', video: 'off' };
/** In the game folder, next to story.vn. */
export const SETTINGS_FILE = 'export.json';
const SETTINGS = Object.keys(NO_COMPRESSION) as (keyof Compression)[];

export const IMAGE_QUALITY = { min: 50, max: 100 } as const;
export const SHRINK_PERCENT = { min: 100, max: 400 } as const;
export const AUDIO_KBPS = { min: 24, max: 256 } as const;
export const VOICE_KBPS = { min: 16, max: 256 } as const;
export const VIDEO_CRF = { min: 15, max: 40 } as const;

/** Pictures WebP can replace. */
const IMAGE_TO_WEBP = new Set(['.png', '.bmp']);
/** Pictures that are only made smaller, in their own format. */
const IMAGE_SHRINK_ONLY = new Set(['.jpg', '.jpeg', '.webp']);
const AUDIO_IN = new Set(['.wav', '.flac', '.aif', '.aiff', '.ogg', '.oga', '.mp3']);
// WebM is left alone: it is often a movie with a transparent background, which H.264 can't keep.
const VIDEO_IN = new Set(['.mp4', '.m4v', '.mov', '.ogv', '.avi', '.mkv', '.mpg', '.mpeg', '.wmv']);
/** Codecs that are already exact copies of the sound: always worth encoding. */
const LOSSLESS_AUDIO = /^(pcm_|flac$|alac$|wavpack$|ape$)/;
/** Bigger than this, WebP can't hold the picture. */
const WEBP_MAX_SIDE = 16383;
/** A converted file must save at least this share of the original to be used. */
const MIN_SAVING = 0.05;
/** A picture that would shrink by less than this is left at its size: the change wouldn't be worth the blur. */
const MIN_SHRINK = 0.95;
/** The screen a game's picture pixels are measured on when it has no `canvas:` (as in the player). */
const DEFAULT_WIDTH = 1920;

function integer(value: unknown, range: { min: number; max: number }, what: string): number {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < range.min || n > range.max) {
    throw new Error(`${what} must be off or a whole number from ${range.min} to ${range.max} (got ${JSON.stringify(value)}).`);
  }
  return n;
}

/** Check settings from export.json, the launcher or the command line; throws a message for the writer. */
export function parseCompression(data: unknown): Compression {
  if (data === undefined || data === null) return { ...NO_COMPRESSION };
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('compress must be an object like { "images": 90, "audio": "off", "video": "off" }.');
  const d = data as Record<string, unknown>;
  for (const key of Object.keys(d)) {
    if (!(SETTINGS as string[]).includes(key)) throw new Error(`Unknown compress setting '${key}': use ${SETTINGS.slice(0, -1).join(', ')} or video.`);
  }
  const off = (v: unknown) => v === undefined || v === 'off' || v === false;
  return {
    images: off(d.images) ? 'off' : d.images === 'lossless' ? 'lossless' : integer(d.images, IMAGE_QUALITY, 'images'),
    shrink: off(d.shrink) ? 'off' : integer(d.shrink, SHRINK_PERCENT, 'shrink'),
    audio: off(d.audio) ? 'off' : integer(d.audio, AUDIO_KBPS, 'audio'),
    // Settings saved before voices had their own say nothing: voices go with music and sound, as they did.
    voice: d.voice === undefined || d.voice === 'audio' ? 'audio' : off(d.voice) ? 'off' : integer(d.voice, VOICE_KBPS, 'voice'),
    video: off(d.video) ? 'off' : integer(d.video, VIDEO_CRF, 'video'),
  };
}

/** export.json's `compress` as written (unchecked), or undefined. */
export function readCompressionSettings(gameDir: string): unknown {
  const file = join(gameDir, SETTINGS_FILE);
  if (!existsSync(file)) return undefined;
  let data: unknown;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
    throw new Error(`${SETTINGS_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${SETTINGS_FILE} must hold an object.`);
  return (data as Record<string, unknown>).compress;
}

/** The game's compression settings (all off when it has no export.json). */
export function readCompression(gameDir: string): Compression {
  return parseCompression(readCompressionSettings(gameDir));
}

/** Save the settings, keeping anything else export.json holds. */
export function writeCompression(gameDir: string, c: Compression): void {
  const file = join(gameDir, SETTINGS_FILE);
  let data: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      const old: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (old && typeof old === 'object' && !Array.isArray(old)) data = old as Record<string, unknown>;
    } catch { /* replaced below */ }
  }
  const all = { ...data, compress: parseCompression(c) };
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
  renameSync(tmp, file);
}

export interface Tools {
  ffmpeg: string | null;
  /** Encoders this ffmpeg has: Opus for sound, x264 for movies. */
  opus: boolean;
  x264: boolean;
}

let tools: Tools | null = null;

/** ffmpeg from FFMPEG_PATH (Emaki Studio sets it to the one it comes with) or the PATH. */
export function findTools(refresh = false): Tools {
  if (tools && !refresh) return tools;
  const run = (exe: string, args: string[]) => {
    const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    return r.status === 0 ? r.stdout : null;
  };
  const named = process.env.FFMPEG_PATH;
  const ffmpeg = named && run(named, ['-hide_banner', '-version']) !== null ? named : run('ffmpeg', ['-hide_banner', '-version']) !== null ? 'ffmpeg' : null;
  const encoders = ffmpeg ? run(ffmpeg, ['-hide_banner', '-encoders']) ?? '' : '';
  tools = { ffmpeg, opus: /\slibopus\s/.test(encoders), x264: /\slibx264\s/.test(encoders) };
  return tools;
}

/** Why sound or movies can't be compressed on this computer, or null when they can. */
export function missingTool(kind: 'audio' | 'voice' | 'video', t: Tools = findTools()): string | null {
  if (!t.ffmpeg) return 'needs ffmpeg installed and on the PATH';
  if (kind !== 'video' && !t.opus) return 'needs an ffmpeg built with libopus';
  if (kind === 'video' && !t.x264) return 'needs an ffmpeg built with libx264';
  return null;
}

/** What a report counts separately. Voices are sound files the story plays as voices. */
export type Kind = 'images' | 'audio' | 'voice' | 'video';
export const KINDS: readonly Kind[] = ['images', 'audio', 'voice', 'video'];
const NAMES: Record<Kind, string> = { images: 'pictures', audio: 'music and sound', voice: 'voices', video: 'movies' };

export interface KindReport { converted: number; kept: number; before: number; after: number; skipped: string | null }
export interface CompressReport {
  images: KindReport; audio: KindReport; voice: KindReport; video: KindReport;
  renamed: Record<string, string>;
  /** Pictures made smaller, by their path in the export: the size they are drawn at. */
  sizes: Record<string, [number, number]>;
}

/** What compression needs to know about the game besides its files. */
export interface GameFacts {
  /** The screen picture pixels are measured on: the `canvas:`, or 1920 wide at the game's aspect. */
  screen: [number, number];
  /** Sound files the story plays as voices, as paths in assets/. */
  voices: Set<string>;
}

/** Every `channel: 'voice'` path in a compiled story (packed or not), and the voiced lines' files. */
function storyVoices(story: unknown, out: Set<string>): void {
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) visit(x); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o.channel === 'voice' && typeof o.path === 'string') out.add(o.path);
    for (const x of Object.values(o)) visit(x);
  };
  visit(story);
  const voices = (story as { voices?: Record<string, string> } | null)?.voices;
  for (const path of Object.values(voices ?? {})) out.add(path);
}

/** The facts for a compiled story (null when it couldn't be compiled: voices are then found by folder only). */
export function gameFacts(story: { meta?: Record<string, string> } | null): GameFacts {
  const meta = story?.meta ?? {};
  const canvas = parseCanvas(meta.canvas);
  const aspect = (meta.aspect ? parseAspect(meta.aspect) : null) ?? 16 / 9;
  const voices = new Set<string>();
  if (story) storyVoices(story, voices);
  return { screen: canvas ?? [DEFAULT_WIDTH, Math.round(DEFAULT_WIDTH / aspect)], voices };
}

/** A voice: played as one by the story, or kept in a folder named voice or voices. */
const isVoice = (rel: string, facts: GameFacts) => facts.voices.has(rel) || /^voices?\//i.test(rel);

interface Job { kind: Kind; rel: string; source: string; to: string }

/** The files of a folder, as paths relative to it with forward slashes. */
function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(root, full, out);
    else if (e.isFile()) out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** An animated PNG: WebP from sharp would keep only its first frame. */
function animatedPng(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(64 * 1024);
    const n = readSync(fd, head, 0, head.length, 0);
    // acTL comes before the first IDAT in an APNG.
    const idat = head.subarray(0, n).indexOf('IDAT');
    const actl = head.subarray(0, n).indexOf('acTL');
    return actl >= 0 && (idat < 0 || actl < idat);
  } finally { closeSync(fd); }
}

function run(exe: string, args: string[]): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.stderr.on('data', (c: Buffer) => { err = (err + c.toString('utf8')).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolveRun(out) : reject(new Error(err.trim().split('\n').pop() || `${exe} failed (${code})`))));
  });
}

export interface Probe {
  /** The first sound stream's codec. */
  codec: string | null;
  /** Its bit rate (else the file's), in bit/s. */
  bitRate: number | null;
  channels: number;
  /** Has a moving picture (not just cover art). */
  video: boolean;
  /** Seconds. */
  duration: number | null;
}

/** What `ffmpeg -i` says about a file (it has no output, so it ends with an error: only what it printed counts). */
export function parseProbe(text: string): Probe {
  const time = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const duration = time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : null;
  const fileRate = /Duration:[^\n]*bitrate: (\d+) kb\/s/.exec(text);
  const audio = /Stream #[^\n]*?: Audio: ([^\s,(]+)([^\n]*)/.exec(text);
  let channels = 2;
  let bitRate = fileRate ? Number(fileRate[1]) * 1000 : null;
  if (audio) {
    const rest = audio[2]!;
    const n = /(\d+) channels/.exec(rest);
    channels = /\bmono\b/.test(rest) ? 1 : n ? Number(n[1]) : /\b5\.1\b/.test(rest) ? 6 : /\b7\.1\b/.test(rest) ? 8 : 2;
    const rate = /(\d+) kb\/s/.exec(rest);
    if (rate) bitRate = Number(rate[1]) * 1000;
  }
  const video = [...text.matchAll(/Stream #[^\n]*?: Video: ([^\s,(]+)([^\n]*)/g)]
    .some((m) => !['mjpeg', 'png', 'bmp', 'gif'].includes(m[1]!) && !m[2]!.includes('(attached pic)'));
  return { codec: audio?.[1] ?? null, bitRate: bitRate && bitRate > 0 ? bitRate : null, channels, video, duration };
}

function probe(ffmpeg: string, file: string): Promise<Probe> {
  return new Promise((resolveProbe, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let text = '';
    child.stderr.on('data', (c: Buffer) => { if (text.length < 64_000) text += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', () => resolveProbe(parseProbe(text)));
  });
}

async function sharpOf() {
  const { default: sharp } = await import('sharp');
  // sharp's cache keeps files open, and Windows can't delete an open file (the next export would fail).
  sharp.cache(false);
  return sharp;
}

/** How much to scale a picture so it still just covers `share` of the screen (1 when it needn't change). */
export function shrinkScale(width: number, height: number, screen: [number, number], percent: number): number {
  const s = Math.max((screen[0] * percent) / 100 / width, (screen[1] * percent) / 100 / height);
  return s < MIN_SHRINK ? s : 1;
}

/** What `convert` made: false when the file is better left as it is. `size` is the picture's own size, when it was made smaller. */
type Converted = false | { size?: [number, number] };

/** Convert `job.source` into `out`. */
async function convert(job: Job, c: Compression, t: Tools, facts: GameFacts, out: string): Promise<Converted> {
  if (job.kind === 'images') {
    const ext = extname(job.rel).toLowerCase();
    if (ext === '.png' && animatedPng(job.source)) return false;
    const sharp = await sharpOf();
    const img = sharp(job.source, { limitInputPixels: false });
    const meta = await img.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height || (meta.pages ?? 1) > 1) return false;
    const scale = c.shrink === 'off' ? 1 : shrinkScale(width, height, facts.screen, c.shrink);
    const outExt = extname(job.to).toLowerCase();
    // Nothing to do: a JPEG or WebP at its size, or a PNG kept as PNG.
    if (scale === 1 && outExt === ext) return false;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (outExt === '.webp' && (w > WEBP_MAX_SIDE || h > WEBP_MAX_SIDE)) return false;
    const resized = scale === 1 ? img : img.resize(w, h, { kernel: 'lanczos3', fit: 'fill' });
    const quality = typeof c.images === 'number' ? c.images : 90;
    if (outExt === '.webp') {
      await resized.webp(c.images === 'lossless'
        ? { lossless: true, effort: 4 }
        // Edges of sprites stay exact: only the colour is lossy.
        : { quality, alphaQuality: 100, effort: 4, smartSubsample: true }).toFile(out);
    } else if (outExt === '.png') await resized.png({ compressionLevel: 9 }).toFile(out);
    else await resized.jpeg({ quality, mozjpeg: true }).toFile(out);
    return scale === 1 ? {} : { size: [width, height] };
  }
  const p = await probe(t.ffmpeg!, job.source);
  if (job.kind === 'audio' || job.kind === 'voice') {
    if (p.video || !p.codec) return false;
    const own = job.kind === 'voice' && c.voice !== 'audio';
    const setting = (own ? c.voice : c.audio) as number;
    const kbps = own || p.channels !== 1 ? setting : Math.max(AUDIO_KBPS.min, Math.round(setting / 2));
    // Already lossy and about as small: encoding again would only lose quality.
    if (!LOSSLESS_AUDIO.test(p.codec) && p.bitRate !== null && p.bitRate <= kbps * 1000 * 1.2) return false;
    await run(t.ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-i', job.source, '-vn', '-map', '0:a:0',
      '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-threads', '1', '-f', 'ogg', out]);
    return {};
  }
  if (!p.video) return false;
  await run(t.ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-i', job.source, ...movieArgs(c), out]);
  return {};
}

const movieArgs = (c: Compression) => ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-crf', String(c.video), '-preset', 'medium',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-f', 'mp4'];

/** Run `work` on each item, `limit` at a time. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

/** At once: each picture or sound uses one core; x264 uses them all for one movie. */
function parallel(kind: Kind): number {
  const cores = Math.max(1, cpus().length);
  return kind === 'video' ? 1 : kind === 'images' ? Math.max(1, Math.floor(cores / 2)) : cores;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const emptyKind = (): KindReport => ({ converted: 0, kept: 0, before: 0, after: 0, skipped: null });
const noTools: Tools = { ffmpeg: null, opus: false, x264: false };

/** Is this setting on? Pictures are worked on for WebP or for shrinking; voices may go with music and sound. */
const isOn = (c: Compression, k: Kind) => k === 'images' ? c.images !== 'off' || c.shrink !== 'off'
  : k === 'voice' && c.voice === 'audio' ? c.audio !== 'off' : c[k] !== 'off';

/**
 * The work for a game: which files of assets/ change, and into what. Kinds that can't run here (no ffmpeg) are
 * marked skipped in `report` and logged.
 */
function plan(gameDir: string, c: Compression, facts: GameFacts, t: Tools, report: Record<Kind, KindReport>, log: (m: string) => void): Job[] {
  for (const k of ['audio', 'voice', 'video'] as const) {
    const why = isOn(c, k) ? missingTool(k, t) : null;
    if (why) { report[k].skipped = why; log(`Skipping ${NAMES[k]}: compressing them ${why}.`); }
  }
  const assets = join(gameDir, 'assets');
  if (!existsSync(assets)) return [];
  const files = new Set(walk(assets));
  const jobs: Job[] = [];
  for (const rel of files) {
    const ext = extname(rel).toLowerCase();
    let kind: Kind | null = null;
    let outExt = ext;
    if (IMAGE_TO_WEBP.has(ext)) { kind = 'images'; outExt = c.images !== 'off' ? '.webp' : '.png'; }
    else if (IMAGE_SHRINK_ONLY.has(ext) && c.shrink !== 'off') kind = 'images';
    else if (AUDIO_IN.has(ext)) { kind = isVoice(rel, facts) ? 'voice' : 'audio'; outExt = '.ogg'; }
    else if (VIDEO_IN.has(ext)) { kind = 'video'; outExt = '.mp4'; }
    if (!kind || !isOn(c, kind) || report[kind].skipped) continue;
    const to = rel.slice(0, rel.length - ext.length) + outExt;
    // bg/a.png next to a bg/a.webp of its own: leave both.
    if (to !== rel && files.has(to)) continue;
    jobs.push({ kind, rel, source: join(assets, ...rel.split('/')), to });
  }
  return jobs;
}

interface CacheEntry { key: string; file: string; keep: string; sizeFile: string }

/** Where a job's result is kept: by its file, its size and time, and the settings that change it. */
function cacheEntry(job: Job, c: Compression, facts: GameFacts, cacheDir: string): CacheEntry {
  const st = statSync(job.source);
  // Voices that go with music and sound are converted just as those are, and share their results.
  const kind = job.kind === 'voice' && c.voice === 'audio' ? 'audio' : job.kind;
  const settings = kind === 'images' ? [c.images, c.shrink, c.shrink === 'off' ? '' : facts.screen.join('x')] : [c[kind]];
  const key = createHash('sha1').update([kind, ...settings, job.rel, st.size, Math.round(st.mtimeMs)].join('\0')).digest('hex');
  const file = join(cacheDir, key + extname(job.to).toLowerCase());
  return { key, file, keep: join(cacheDir, key + '.keep'), sizeFile: join(cacheDir, key + '.size') };
}

type Outcome = { use: true; size?: [number, number] } | { use: false };

/** The job's result from the cache, else made now and kept there. */
async function produce(job: Job, c: Compression, t: Tools, facts: GameFacts, cacheDir: string, log: (m: string) => void): Promise<Outcome> {
  const e = cacheEntry(job, c, facts, cacheDir);
  const cached = (): Outcome => {
    if (!existsSync(e.sizeFile)) return { use: true };
    const [w, h] = readFileSync(e.sizeFile, 'utf8').split('x').map(Number);
    return w && h ? { use: true, size: [w, h] } : { use: true };
  };
  if (existsSync(e.file)) return cached();
  if (existsSync(e.keep)) return { use: false };
  const tmp = `${e.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    const made = await convert(job, c, t, facts, tmp);
    if (made && statSync(tmp).size <= statSync(job.source).size * (1 - MIN_SAVING)) {
      if (made.size) writeFileSync(e.sizeFile, made.size.join('x'));
      renameSync(tmp, e.file);
      return cached();
    }
    writeFileSync(e.keep, '');
  } catch (err) {
    log(`  ${job.rel}: left as it is (${err instanceof Error ? err.message : String(err)})`);
  } finally { rmSync(tmp, { force: true }); }
  return { use: false };
}

/** The game's facts from a finished build's game.json. */
function buildFacts(webDir: string): GameFacts {
  try {
    const game = JSON.parse(readFileSync(join(webDir, 'game.json'), 'utf8')) as { story?: { meta?: Record<string, string> } | null };
    return gameFacts(game.story ?? null);
  } catch { return gameFacts(null); }
}

/**
 * Compress the game's files in a finished web build (`webDir`, made from
 * `gameDir`'s assets/). Results are kept in `cacheDir`, so exporting again
 * converts only what changed.
 */
export async function compressBuild(
  gameDir: string, webDir: string, c: Compression, opts: { cacheDir: string; log: (msg: string) => void; tools?: Tools },
): Promise<CompressReport> {
  const report: CompressReport = { images: emptyKind(), audio: emptyKind(), voice: emptyKind(), video: emptyKind(), renamed: {}, sizes: {} };
  if (!KINDS.some((k) => isOn(c, k))) return report;
  const t = opts.tools ?? (isOn(c, 'audio') || isOn(c, 'voice') || isOn(c, 'video') ? findTools() : noTools);
  const facts = buildFacts(webDir);
  const jobs = plan(gameDir, c, facts, t, report, opts.log)
    .filter((j) => existsSync(join(webDir, ...j.rel.split('/'))));
  if (!jobs.length) return report;
  mkdirSync(opts.cacheDir, { recursive: true });

  let lastLog = 0;
  for (const kind of KINDS) {
    const list = jobs.filter((j) => j.kind === kind);
    if (!list.length) continue;
    opts.log(`Compressing ${list.length} ${NAMES[kind]}…`);
    let done = 0;
    const progress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastLog < 2000) return;
      lastLog = now;
      opts.log(`  ${NAMES[kind]}: ${done} of ${list.length}`);
    };
    const r = report[kind];
    await pool(list, parallel(kind), async (job) => {
      const from = join(webDir, ...job.rel.split('/'));
      const before = statSync(from).size;
      r.before += before;
      const o = await produce(job, c, t, facts, opts.cacheDir, opts.log);
      if (o.use) {
        const e = cacheEntry(job, c, facts, opts.cacheDir);
        const dest = join(webDir, ...job.to.split('/'));
        copyFileSync(e.file, dest);
        if (dest !== from) { rmSync(from); report.renamed[job.rel] = job.to; }
        if (o.size) report.sizes[job.to] = o.size;
        r.converted++;
        r.after += statSync(dest).size;
      } else {
        r.kept++;
        r.after += before;
      }
      done++;
      progress();
    });
    progress(true);
    opts.log(`  ${mb(r.before)} → ${mb(r.after)} (${r.converted} converted, ${r.kept} left as they were)`);
  }
  return report;
}

export interface KindEstimate {
  /** Files this setting works on. */
  files: number;
  before: number;
  /** About how big they will be. */
  after: number;
  /** All of them already converted by an earlier export or estimate: `after` is exact. */
  exact: boolean;
  skipped: string | null;
}
export interface Estimate { images: KindEstimate; audio: KindEstimate; voice: KindEstimate; video: KindEstimate; before: number; after: number }

/** Files converted per kind to estimate the rest (pictures and sound are kept in the cache for the export). */
const SAMPLES: Record<Kind, number> = { images: 32, audio: 16, voice: 32, video: 2 };
/** Seconds of each sample movie encoded. */
const MOVIE_SAMPLE = 6;

/**
 * The items in `n` bands by size, each with the one from its middle to try: small, middling and large files
 * compress differently, so each sample speaks for the files of its own size.
 */
function bands<T>(items: T[], size: (x: T) => number, n: number): { sample: T; members: T[] }[] {
  const sorted = [...items].sort((a, b) => size(a) - size(b));
  const count = Math.min(n, sorted.length);
  return Array.from({ length: count }, (_, i) => {
    const members = sorted.slice(Math.floor((i * sorted.length) / count), Math.floor(((i + 1) * sorted.length) / count));
    return { sample: members[Math.floor(members.length / 2)]!, members };
  });
}

/**
 * About how big the export's files will be with these settings, before exporting. Files converted before (the
 * cache) count exactly; for the rest a few of each kind are converted, and the others are expected to shrink as they
 * did. Pictures and sound converted here go in the cache, so the export doesn't do them again.
 */
export async function estimateCompression(
  gameDir: string, c: Compression, facts: GameFacts, opts: { cacheDir: string; tools?: Tools },
): Promise<Estimate> {
  const estimate = Object.fromEntries(KINDS.map((k) => [k, { files: 0, before: 0, after: 0, exact: true, skipped: null }])) as Record<Kind, KindEstimate>;
  const reports = Object.fromEntries(KINDS.map((k) => [k, emptyKind()])) as Record<Kind, KindReport>;
  const t = opts.tools ?? (isOn(c, 'audio') || isOn(c, 'voice') || isOn(c, 'video') ? findTools() : noTools);
  const jobs = plan(gameDir, c, facts, t, reports, () => {});
  for (const k of KINDS) estimate[k].skipped = reports[k].skipped;
  if (jobs.length) mkdirSync(opts.cacheDir, { recursive: true });
  const quiet = () => {};

  for (const kind of KINDS) {
    const list = jobs.filter((j) => j.kind === kind).map((job) => ({ job, size: statSync(job.source).size }));
    const e = estimate[kind];
    e.files = list.length;
    if (!list.length) continue;
    const known: typeof list = [];
    const unknown: typeof list = [];
    for (const item of list) {
      e.before += item.size;
      const entry = cacheEntry(item.job, c, facts, opts.cacheDir);
      if (existsSync(entry.file)) e.after += statSync(entry.file).size;
      else if (existsSync(entry.keep)) e.after += item.size;
      else { unknown.push(item); continue; }
      known.push(item);
    }
    if (!unknown.length) continue;
    e.exact = false;
    // Try one file of each band of sizes, then expect the band's others to shrink the way it did.
    await pool(bands(unknown, (x) => x.size, SAMPLES[kind]), parallel(kind), async ({ sample: { job, size }, members }) => {
      const [b, a] = kind === 'video' ? await movieSample(job, size, c, t) : await (async () => {
        const o = await produce(job, c, t, facts, opts.cacheDir, quiet);
        const entry = cacheEntry(job, c, facts, opts.cacheDir);
        return [size, o.use && existsSync(entry.file) ? statSync(entry.file).size : size];
      })();
      const ratio = b ? a / b : 1;
      for (const m of members) e.after += m.size * ratio;
    });
  }
  const before = KINDS.reduce((s, k) => s + estimate[k].before, 0);
  const after = KINDS.reduce((s, k) => s + estimate[k].after, 0);
  return { ...estimate, before, after: Math.round(after) };
}

/**
 * A movie's likely size after encoding, from a few seconds of its middle: [the share of the file those seconds are,
 * their size encoded]. A movie that wouldn't save enough is counted at its size.
 */
async function movieSample(job: Job, size: number, c: Compression, t: Tools): Promise<[number, number]> {
  const p = await probe(t.ffmpeg!, job.source);
  if (!p.video || !p.duration) return [size, size];
  const seconds = Math.min(MOVIE_SAMPLE, p.duration);
  const start = Math.max(0, p.duration / 2 - seconds / 2);
  const dir = mkdtempSync(join(tmpdir(), 'emaki-estimate-'));
  try {
    const out = join(dir, 'sample.mp4');
    await run(t.ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', job.source, '-t', String(seconds), ...movieArgs(c), out]);
    const share = (size * seconds) / p.duration;
    const encoded = statSync(out).size;
    return [share, encoded <= share * (1 - MIN_SAVING) ? encoded : share];
  } catch { return [size, size]; } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Add the renamed and resized files to the build's game.json, where the player looks them up. */
export function recordRenamed(webDir: string, r: Pick<CompressReport, 'renamed' | 'sizes'>): void {
  if (!Object.keys(r.renamed).length && !Object.keys(r.sizes).length) return;
  const file = join(webDir, 'game.json');
  const game = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (Object.keys(r.renamed).length) game.renamed = r.renamed;
  if (Object.keys(r.sizes).length) game.sizes = r.sizes;
  writeFileSync(file, JSON.stringify(game));
}

/** One line for the export's notes. */
export function summary(r: CompressReport): string | null {
  const parts = KINDS.filter((k) => r[k].converted).map((k) => `${NAMES[k]} ${mb(r[k].before)} → ${mb(r[k].after)}`);
  return parts.length ? `Compressed: ${parts.join(', ')}.` : null;
}

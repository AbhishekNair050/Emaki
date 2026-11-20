/**
 * Making an exported game smaller: pictures to WebP, sound to Opus, movies to
 * H.264. Only the export's copy changes; the game's assets/ folder is never touched.
 *
 * Each kind is off unless the game's export.json turns it on (the launcher
 * writes it from the Export card). Files that come out no smaller stay as
 * they were. A file whose name changes (bg/a.png → bg/a.webp) is listed in
 * game.json's `renamed`, which the player looks every asset path up in, so
 * the story itself never needs rewriting.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, extname, join, relative, sep } from 'node:path';

export interface Compression {
  /** WebP: `lossless`, or a quality from 50 to 100. */
  images: 'off' | 'lossless' | number;
  /** Opus, in kbit/s for a stereo file (24 to 256); mono files, voices mostly, get half. */
  audio: 'off' | number;
  /** H.264 CRF: 15 (near perfect, large) to 40 (small). */
  video: 'off' | number;
}

export const NO_COMPRESSION: Compression = { images: 'off', audio: 'off', video: 'off' };
/** In the game folder, next to story.vn. */
export const SETTINGS_FILE = 'export.json';

export const IMAGE_QUALITY = { min: 50, max: 100 } as const;
export const AUDIO_KBPS = { min: 24, max: 256 } as const;
export const VIDEO_CRF = { min: 15, max: 40 } as const;

const IMAGE_IN = new Set(['.png', '.bmp']);
const AUDIO_IN = new Set(['.wav', '.flac', '.aif', '.aiff', '.ogg', '.oga', '.mp3']);
// WebM is left alone: it is often a movie with a transparent background, which H.264 can't keep.
const VIDEO_IN = new Set(['.mp4', '.m4v', '.mov', '.ogv', '.avi', '.mkv', '.mpg', '.mpeg', '.wmv']);
/** Codecs that are already exact copies of the sound: always worth encoding. */
const LOSSLESS_AUDIO = /^(pcm_|flac$|alac$|wavpack$|ape$)/;
/** Bigger than this, WebP can't hold the picture. */
const WEBP_MAX_SIDE = 16383;
/** A converted file must save at least this share of the original to be used. */
const MIN_SAVING = 0.05;

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
    if (!['images', 'audio', 'video'].includes(key)) throw new Error(`Unknown compress setting '${key}': use images, audio or video.`);
  }
  const off = (v: unknown) => v === undefined || v === 'off' || v === false;
  return {
    images: off(d.images) ? 'off' : d.images === 'lossless' ? 'lossless' : integer(d.images, IMAGE_QUALITY, 'images'),
    audio: off(d.audio) ? 'off' : integer(d.audio, AUDIO_KBPS, 'audio'),
    video: off(d.video) ? 'off' : integer(d.video, VIDEO_CRF, 'video'),
  };
}

/** The game's compression settings (all off when it has no export.json). */
export function readCompression(gameDir: string): Compression {
  const file = join(gameDir, SETTINGS_FILE);
  if (!existsSync(file)) return { ...NO_COMPRESSION };
  let data: unknown;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
    throw new Error(`${SETTINGS_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${SETTINGS_FILE} must hold an object.`);
  return parseCompression((data as Record<string, unknown>).compress);
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
  ffprobe: string | null;
  /** Encoders this ffmpeg has: Opus for sound, x264 for movies. */
  opus: boolean;
  x264: boolean;
}

let tools: Tools | null = null;

/** ffmpeg and ffprobe from FFMPEG_PATH (the ffmpeg program) or the PATH. */
export function findTools(refresh = false): Tools {
  if (tools && !refresh) return tools;
  const run = (exe: string, args: string[]) => {
    const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    return r.status === 0 ? r.stdout : null;
  };
  const named = process.env.FFMPEG_PATH;
  const ffmpeg = named && run(named, ['-hide_banner', '-version']) !== null ? named : run('ffmpeg', ['-hide_banner', '-version']) !== null ? 'ffmpeg' : null;
  const probeNext = named ? join(dirname(named), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : null;
  const ffprobe = probeNext && run(probeNext, ['-version']) !== null ? probeNext : run('ffprobe', ['-version']) !== null ? 'ffprobe' : null;
  const encoders = ffmpeg ? run(ffmpeg, ['-hide_banner', '-encoders']) ?? '' : '';
  tools = { ffmpeg, ffprobe, opus: /\slibopus\s/.test(encoders), x264: /\slibx264\s/.test(encoders) };
  return tools;
}

/** Why a kind can't be compressed on this computer, or null when it can. */
export function missingTool(kind: 'audio' | 'video', t: Tools = findTools()): string | null {
  if (!t.ffmpeg || !t.ffprobe) return 'needs ffmpeg (with ffprobe) installed and on the PATH';
  if (kind === 'audio' && !t.opus) return 'needs an ffmpeg built with libopus';
  if (kind === 'video' && !t.x264) return 'needs an ffmpeg built with libx264';
  return null;
}

type Kind = 'images' | 'audio' | 'video';

export interface KindReport { converted: number; kept: number; before: number; after: number; skipped: string | null }
export interface CompressReport { images: KindReport; audio: KindReport; video: KindReport; renamed: Record<string, string> }

interface Job { kind: Kind; rel: string; from: string; to: string }

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

interface Probe { codec: string | null; bitRate: number | null; channels: number; video: boolean }
async function probe(ffprobe: string, file: string): Promise<Probe> {
  const out = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=bit_rate:stream=codec_type,codec_name,bit_rate,channels', '-of', 'json', file]);
  const j = JSON.parse(out) as { format?: { bit_rate?: string }; streams?: { codec_type?: string; codec_name?: string; bit_rate?: string; channels?: number }[] };
  const audio = j.streams?.find((s) => s.codec_type === 'audio');
  const rate = Number(audio?.bit_rate ?? j.format?.bit_rate);
  return { codec: audio?.codec_name ?? null, channels: audio?.channels ?? 2, bitRate: Number.isFinite(rate) && rate > 0 ? rate : null, video: !!j.streams?.some((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png') };
}

/**
 * Convert `job.from` into `out`. Returns false when the file is better left
 * as it is (already small, or a kind of file this can't convert faithfully).
 */
async function convert(job: Job, c: Compression, t: Tools, out: string): Promise<boolean> {
  if (job.kind === 'images') {
    if (animatedPng(job.from)) return false;
    const { default: sharp } = await import('sharp');
    // sharp's cache keeps files open, and Windows can't delete an open file (the next export would fail).
    sharp.cache(false);
    const img = sharp(job.from, { limitInputPixels: false });
    const meta = await img.metadata();
    if ((meta.width ?? 0) > WEBP_MAX_SIDE || (meta.height ?? 0) > WEBP_MAX_SIDE) return false;
    await img.webp(c.images === 'lossless'
      ? { lossless: true, effort: 4 }
      // Edges of sprites stay exact: only the colour is lossy.
      : { quality: c.images as number, alphaQuality: 100, effort: 4, smartSubsample: true }).toFile(out);
    return true;
  }
  const p = await probe(t.ffprobe!, job.from);
  if (job.kind === 'audio') {
    if (p.video || !p.codec) return false;
    const kbps = p.channels === 1 ? Math.max(AUDIO_KBPS.min, Math.round((c.audio as number) / 2)) : c.audio as number;
    // Already lossy and about as small: encoding again would only lose quality.
    if (!LOSSLESS_AUDIO.test(p.codec) && p.bitRate !== null && p.bitRate <= kbps * 1000 * 1.2) return false;
    await run(t.ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-i', job.from, '-vn', '-map', '0:a:0',
      '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-threads', '1', '-f', 'ogg', out]);
    return true;
  }
  if (!p.video) return false;
  await run(t.ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-i', job.from, '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-crf', String(c.video), '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-f', 'mp4', out]);
  return true;
}

const OUT_EXT: Record<Kind, string> = { images: '.webp', audio: '.ogg', video: '.mp4' };
const setting = (kind: Kind, c: Compression) => String(c[kind]);

/** Run `work` on each item, `limit` at a time. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/**
 * Compress the game's files in a finished web build (`webDir`, made from
 * `gameDir`'s assets/). Results are kept in `cacheDir`, so exporting again
 * converts only what changed.
 */
export async function compressBuild(
  gameDir: string, webDir: string, c: Compression, opts: { cacheDir: string; log: (msg: string) => void; tools?: Tools },
): Promise<CompressReport> {
  const empty = (): KindReport => ({ converted: 0, kept: 0, before: 0, after: 0, skipped: null });
  const report: CompressReport = { images: empty(), audio: empty(), video: empty(), renamed: {} };
  const on = (k: Kind) => c[k] !== 'off';
  if (!on('images') && !on('audio') && !on('video')) return report;
  const t = on('audio') || on('video') ? opts.tools ?? findTools() : opts.tools ?? { ffmpeg: null, ffprobe: null, opus: false, x264: false };
  for (const k of ['audio', 'video'] as const) {
    const why = on(k) ? missingTool(k, t) : null;
    if (why) { report[k].skipped = why; opts.log(`Skipping ${k} compression: it ${why}.`); }
  }
  const assets = join(gameDir, 'assets');
  if (!existsSync(assets)) return report;

  const files = new Set(walk(assets));
  const jobs: Job[] = [];
  for (const rel of files) {
    const ext = extname(rel).toLowerCase();
    const kind: Kind | null = IMAGE_IN.has(ext) ? 'images' : AUDIO_IN.has(ext) ? 'audio' : VIDEO_IN.has(ext) ? 'video' : null;
    if (!kind || !on(kind) || report[kind].skipped) continue;
    const from = join(webDir, ...rel.split('/'));
    if (!existsSync(from)) continue;
    const to = rel.slice(0, rel.length - ext.length) + OUT_EXT[kind];
    // bg/a.png next to a bg/a.webp of its own: leave both.
    if (to !== rel && files.has(to)) continue;
    jobs.push({ kind, rel, from, to });
  }
  if (!jobs.length) return report;
  mkdirSync(opts.cacheDir, { recursive: true });

  const done: Record<Kind, number> = { images: 0, audio: 0, video: 0 };
  const total: Record<Kind, number> = { images: 0, audio: 0, video: 0 };
  for (const j of jobs) total[j.kind]++;
  let lastLog = 0;
  const progress = (kind: Kind, force = false) => {
    const now = Date.now();
    if (!force && now - lastLog < 2000) return;
    lastLog = now;
    opts.log(`  ${kind}: ${done[kind]} of ${total[kind]}`);
  };

  const one = async (job: Job) => {
    const st = statSync(job.from);
    const r = report[job.kind];
    r.before += st.size;
    const source = join(assets, ...job.rel.split('/'));
    const sst = statSync(source);
    const key = createHash('sha1').update([job.kind, setting(job.kind, c), job.rel, sst.size, Math.round(sst.mtimeMs)].join('\0')).digest('hex');
    const cached = join(opts.cacheDir, key + OUT_EXT[job.kind]);
    const keep = join(opts.cacheDir, key + '.keep');
    let use = false;
    if (existsSync(cached)) use = true;
    else if (!existsSync(keep)) {
      const tmp = `${cached}.${process.pid}.tmp`;
      try {
        if (await convert(job, c, t, tmp) && statSync(tmp).size <= st.size * (1 - MIN_SAVING)) { renameSync(tmp, cached); use = true; }
        else writeFileSync(keep, '');
      } catch (err) {
        opts.log(`  ${job.rel}: left as it is (${err instanceof Error ? err.message : String(err)})`);
      } finally { rmSync(tmp, { force: true }); }
    }
    if (use) {
      const dest = join(webDir, ...job.to.split('/'));
      copyFileSync(cached, dest);
      if (dest !== job.from) { rmSync(job.from); report.renamed[job.rel] = job.to; }
      r.converted++;
      r.after += statSync(dest).size;
    } else {
      r.kept++;
      r.after += st.size;
    }
    done[job.kind]++;
    progress(job.kind);
  };

  const cores = Math.max(1, cpus().length);
  for (const kind of ['images', 'audio', 'video'] as const) {
    const list = jobs.filter((j) => j.kind === kind);
    if (!list.length) continue;
    opts.log(`Compressing ${list.length} ${kind === 'images' ? 'pictures' : kind === 'audio' ? 'sound files' : 'movies'}…`);
    // Each picture or sound uses one core; x264 uses them all for one movie.
    await pool(list, kind === 'video' ? 1 : kind === 'images' ? Math.max(1, Math.floor(cores / 2)) : cores, one);
    progress(kind, true);
    const r = report[kind];
    opts.log(`  ${mb(r.before)} → ${mb(r.after)} (${r.converted} converted, ${r.kept} left as they were)`);
  }
  return report;
}

/** Add the renamed files to the build's game.json, where the player looks them up. */
export function recordRenamed(webDir: string, renamed: Record<string, string>): void {
  if (!Object.keys(renamed).length) return;
  const file = join(webDir, 'game.json');
  const game = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  game.renamed = renamed;
  writeFileSync(file, JSON.stringify(game));
}

/** One line for the export's notes. */
export function summary(r: CompressReport): string | null {
  const parts = (['images', 'audio', 'video'] as const)
    .filter((k) => r[k].converted)
    .map((k) => `${k === 'images' ? 'pictures' : k === 'audio' ? 'sound' : 'movies'} ${mb(r[k].before)} → ${mb(r[k].after)}`);
  return parts.length ? `Compressed: ${parts.join(', ')}.` : null;
}

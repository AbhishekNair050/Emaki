import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import {
  compressBuild, findTools, NO_COMPRESSION, parseCompression, readCompression, recordRenamed, summary, writeCompression,
} from '../src/compress.ts';

sharp.cache(false);
const scratch: string[] = [];
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'emaki-compress-')); scratch.push(d); return d; };

/** A game folder with these files in assets/, and a "build" of it: assets copied next to game.json, as Vite does. */
function game(files: Record<string, Buffer>): { dir: string; web: string; cache: string } {
  const dir = tempDir();
  const web = join(dir, 'export', 'web');
  for (const root of [join(dir, 'assets'), web]) {
    for (const [rel, data] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), data);
    }
  }
  writeFileSync(join(web, 'game.json'), JSON.stringify({ story: {}, translations: [] }));
  return { dir, web, cache: join(dir, 'export', '.compress-cache') };
}

/** A picture like a painted background: noise that PNG stores badly. */
async function painting(width = 320, height = 180): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.sin(i / 7) * 60 + 128 + (i * 2654435761 % 41)) & 255;
  return sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
}

const quiet = () => {};

describe('compression settings', () => {
  it('are off unless asked for, and checked', () => {
    expect(parseCompression(undefined)).toEqual(NO_COMPRESSION);
    expect(parseCompression({ images: 90, audio: '96', video: 'off' })).toEqual({ images: 90, audio: 96, video: 'off' });
    expect(parseCompression({ images: 'lossless' })).toEqual({ images: 'lossless', audio: 'off', video: 'off' });
    expect(() => parseCompression({ images: 101 })).toThrow(/images must be off or a whole number from 50 to 100/);
    expect(() => parseCompression({ audio: 12 })).toThrow(/audio/);
    expect(() => parseCompression({ video: 'small' })).toThrow(/video/);
    expect(() => parseCompression({ picture: 90 })).toThrow(/Unknown compress setting 'picture'/);
    expect(() => parseCompression([90])).toThrow(/object/);
  });

  it('are kept in export.json, next to whatever else it holds', () => {
    const dir = tempDir();
    expect(readCompression(dir)).toEqual(NO_COMPRESSION);
    writeFileSync(join(dir, 'export.json'), JSON.stringify({ other: true }));
    writeCompression(dir, { images: 85, audio: 'off', video: 23 });
    expect(JSON.parse(readFileSync(join(dir, 'export.json'), 'utf8'))).toEqual({ other: true, compress: { images: 85, audio: 'off', video: 23 } });
    expect(readCompression(dir)).toEqual({ images: 85, audio: 'off', video: 23 });
    writeFileSync(join(dir, 'export.json'), '{ nope');
    expect(() => readCompression(dir)).toThrow(/export.json is not valid JSON/);
  });
});

describe('compressing an export', () => {
  it('turns pictures into WebP, records the new names and leaves the game folder alone', async () => {
    const png = await painting();
    const apng = Buffer.concat([png.subarray(0, 33), Buffer.from('\0\0\0\x08acTL\0\0\0\x01\0\0\0\0\0\0\0\0'), png.subarray(33)]);
    const g = game({ 'bg/sea.png': png, 'bg/own.png': png, 'bg/own.webp': Buffer.from('x'), 'fx/spin.png': apng, 'notes.txt': Buffer.from('hi') });
    const r = await compressBuild(g.dir, g.web, { images: 90, audio: 'off', video: 'off' }, { cacheDir: g.cache, log: quiet });
    expect(r.renamed).toEqual({ 'bg/sea.png': 'bg/sea.webp' });
    expect(existsSync(join(g.web, 'bg/sea.png'))).toBe(false);
    expect((await sharp(join(g.web, 'bg/sea.webp')).metadata()).format).toBe('webp');
    expect(statSync(join(g.web, 'bg/sea.webp')).size).toBeLessThan(png.length / 2);
    // A name already taken, and an animation WebP would flatten: as they were.
    expect(readFileSync(join(g.web, 'bg/own.png'))).toEqual(png);
    expect(readFileSync(join(g.web, 'fx/spin.png'))).toEqual(apng);
    expect(readdirSync(join(g.dir, 'assets/bg')).sort()).toEqual(['own.png', 'own.webp', 'sea.png']);
    expect(r.images).toMatchObject({ converted: 1, kept: 1 });
    expect(summary(r)).toMatch(/^Compressed: pictures .* MB → .* MB\.$/);

    recordRenamed(g.web, r.renamed);
    expect(JSON.parse(readFileSync(join(g.web, 'game.json'), 'utf8')).renamed).toEqual({ 'bg/sea.png': 'bg/sea.webp' });
  });

  it('converts again only what changed, and nothing when all is off', async () => {
    const g = game({ 'bg/a.png': await painting() });
    const c = { images: 'lossless' as const, audio: 'off' as const, video: 'off' as const };
    await compressBuild(g.dir, g.web, c, { cacheDir: g.cache, log: quiet });
    const cached = readdirSync(g.cache);
    expect(cached).toHaveLength(1);
    const before = statSync(join(g.cache, cached[0]!)).mtimeMs;
    // A fresh build of the same game.
    rmSync(join(g.web, 'bg/a.webp'));
    writeFileSync(join(g.web, 'bg/a.png'), readFileSync(join(g.dir, 'assets/bg/a.png')));
    const again = await compressBuild(g.dir, g.web, c, { cacheDir: g.cache, log: quiet });
    expect(again.renamed).toEqual({ 'bg/a.png': 'bg/a.webp' });
    expect(statSync(join(g.cache, cached[0]!)).mtimeMs).toBe(before);
    // Another setting is another file.
    writeFileSync(join(g.web, 'bg/a.png'), readFileSync(join(g.dir, 'assets/bg/a.png')));
    await compressBuild(g.dir, g.web, { ...c, images: 80 }, { cacheDir: g.cache, log: quiet });
    expect(readdirSync(g.cache)).toHaveLength(2);

    const off = game({ 'bg/a.png': await painting() });
    expect((await compressBuild(off.dir, off.web, NO_COMPRESSION, { cacheDir: off.cache, log: quiet })).renamed).toEqual({});
    expect(existsSync(off.cache)).toBe(false);
  });

  it('says why sound and movies are skipped without ffmpeg', async () => {
    const g = game({ 'music/a.wav': Buffer.from('RIFF') });
    const logs: string[] = [];
    const r = await compressBuild(g.dir, g.web, { images: 'off', audio: 96, video: 23 }, {
      cacheDir: g.cache, log: (m) => logs.push(m), tools: { ffmpeg: null, ffprobe: null, opus: false, x264: false },
    });
    expect(r.audio.skipped).toMatch(/ffmpeg/);
    expect(logs.join('\n')).toMatch(/Skipping audio compression: it needs ffmpeg/);
    expect(readFileSync(join(g.web, 'music/a.wav')).toString()).toBe('RIFF');
  });

  const tools = findTools();
  it.skipIf(!tools.ffmpeg || !tools.ffprobe || !tools.opus || !tools.x264)('turns sound into Opus and movies into H.264, leaving small lossy files alone', async () => {
    const dir = tempDir();
    const make = (args: string[], out: string) => {
      const r = spawnSync(tools.ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', ...args, join(dir, out)]);
      if (r.status !== 0) throw new Error(r.stderr.toString());
      return readFileSync(join(dir, out));
    };
    const wav = make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '2'], 'a.wav');
    const voice = make(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-ac', '1', '-c:a', 'flac'], 'v.flac');
    const small = make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libvorbis', '-b:a', '48k'], 's.ogg');
    const movie = make(['-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=24', '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv420p'], 'm.mp4');
    const g = game({ 'music/a.wav': wav, 'voice/v.flac': voice, 'se/s.ogg': small, 'movie/op.mp4': movie });
    const r = await compressBuild(g.dir, g.web, { images: 'off', audio: 96, video: 28 }, { cacheDir: g.cache, log: quiet });
    expect(r.renamed).toEqual({ 'music/a.wav': 'music/a.ogg', 'voice/v.flac': 'voice/v.ogg' });
    const codec = (rel: string) => spawnSync(tools.ffprobe!, ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', join(g.web, rel)]).stdout.toString().trim().split(/\s+/);
    expect(codec('music/a.ogg')).toEqual(['opus']);
    expect(codec('voice/v.ogg')).toEqual(['opus']);
    expect(readFileSync(join(g.web, 'se/s.ogg'))).toEqual(small);
    expect(codec('movie/op.mp4')).toEqual(['h264']);
    expect(statSync(join(g.web, 'movie/op.mp4')).size).toBeLessThan(movie.length);
    expect(r.audio).toMatchObject({ converted: 2, kept: 1 });
    expect(r.video).toMatchObject({ converted: 1, kept: 0 });
  }, 60_000);
});

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import {
  compressBuild, estimateCompression, findTools, gameFacts, NO_COMPRESSION, parseCompression, parseProbe, readCompression, recordRenamed,
  shrinkScale, summary, writeCompression, type Compression,
} from '../src/compress.ts';

sharp.cache(false);
const scratch: string[] = [];
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'emaki-compress-')); scratch.push(d); return d; };

/** A game folder with these files in assets/, and a "build" of it: assets copied next to game.json, as Vite does. */
function game(files: Record<string, Buffer>, story: object = {}): { dir: string; web: string; cache: string } {
  const dir = tempDir();
  const web = join(dir, 'export', 'web');
  for (const root of [join(dir, 'assets'), web]) {
    for (const [rel, data] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), data);
    }
  }
  writeFileSync(join(web, 'game.json'), JSON.stringify({ story, translations: [] }));
  return { dir, web, cache: join(dir, 'export', '.compress-cache') };
}

/** A picture like a painted background: noise that PNG stores badly. */
async function painting(width = 320, height = 180, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.sin(i / 7) * 60 + 128 + (i * 2654435761 % 41)) & 255;
  const img = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === 'png' ? img.png({ compressionLevel: 0 }).toBuffer() : img.jpeg({ quality: 95 }).toBuffer();
}

const quiet = () => {};
const settings = (c: Partial<Compression>): Compression => ({ ...NO_COMPRESSION, ...c });
const dims = async (file: string) => { const m = await sharp(file).metadata(); return [m.width, m.height]; };

describe('compression settings', () => {
  it('are off unless asked for, and checked', () => {
    expect(parseCompression(undefined)).toEqual(NO_COMPRESSION);
    expect(parseCompression({ images: 90, audio: '96', video: 'off' })).toEqual(settings({ images: 90, audio: 96 }));
    expect(parseCompression({ images: 'lossless' })).toEqual(settings({ images: 'lossless' }));
    expect(parseCompression({ shrink: '150', audio: 128, voice: 'off' })).toEqual(settings({ shrink: 150, audio: 128, voice: 'off' }));
    expect(parseCompression({ audio: 30, voice: 32 })).toEqual(settings({ audio: 30, voice: 32 }));
    // Settings saved before voices had their own: voices go with music and sound, as they did.
    expect(parseCompression({ audio: 96 }).voice).toBe('audio');
    expect(parseCompression({ voice: 'audio' }).voice).toBe('audio');
    expect(() => parseCompression({ images: 101 })).toThrow(/images must be off or a whole number from 50 to 100/);
    expect(() => parseCompression({ shrink: 50 })).toThrow(/shrink must be off or a whole number from 100 to 400/);
    expect(() => parseCompression({ audio: 12 })).toThrow(/audio/);
    expect(() => parseCompression({ voice: 8 })).toThrow(/voice/);
    expect(() => parseCompression({ video: 'small' })).toThrow(/video/);
    expect(() => parseCompression({ picture: 90 })).toThrow(/Unknown compress setting 'picture'/);
    expect(() => parseCompression([90])).toThrow(/object/);
  });

  it('are kept in export.json, next to whatever else it holds', () => {
    const dir = tempDir();
    expect(readCompression(dir)).toEqual(NO_COMPRESSION);
    writeFileSync(join(dir, 'export.json'), JSON.stringify({ other: true }));
    const c = settings({ images: 85, video: 23, voice: 32 });
    writeCompression(dir, c);
    expect(JSON.parse(readFileSync(join(dir, 'export.json'), 'utf8'))).toEqual({ other: true, compress: c });
    expect(readCompression(dir)).toEqual(c);
    writeFileSync(join(dir, 'export.json'), '{ nope');
    expect(() => readCompression(dir)).toThrow(/export.json is not valid JSON/);
  });
});

describe('the game a compression is for', () => {
  it('has a screen from its canvas, or 1920 wide at its shape', () => {
    expect(gameFacts({ meta: { canvas: '1280x720' } }).screen).toEqual([1280, 720]);
    expect(gameFacts({ meta: {} }).screen).toEqual([1920, 1080]);
    expect(gameFacts({ meta: { aspect: '4:3' } }).screen).toEqual([1920, 1440]);
    expect(gameFacts(null).screen).toEqual([1920, 1080]);
  });

  it('has voices: played as voices, on screens and by voiced lines', () => {
    const story = {
      meta: {}, voices: { a1: 'vo/a1.wav' },
      code: [{ op: 'play', channel: 'voice', path: 'lines/x.flac' }, { op: 'play', channel: 'music', path: 'bgm/x.flac' }],
      screens: { settings: { items: [{ action: { do: 'sample', channel: 'voice', path: 'vo/sample.wav' } }] } },
    };
    expect([...gameFacts(story).voices].sort()).toEqual(['lines/x.flac', 'vo/a1.wav', 'vo/sample.wav']);
  });

  it('shrinks pictures only when they cover more than the screen both ways', () => {
    expect(shrinkScale(3840, 2160, [1920, 1080], 100)).toBe(0.5);
    expect(shrinkScale(3840, 2160, [1920, 1080], 200)).toBe(1);
    expect(shrinkScale(1920, 3240, [1920, 1080], 100)).toBe(1);
    expect(shrinkScale(1980, 1100, [1920, 1080], 100)).toBe(1);
    expect(shrinkScale(4000, 4000, [1920, 1080], 100)).toBeCloseTo(0.48);
  });

  it('reads what ffmpeg says about a file', () => {
    expect(parseProbe(`Input #0, wav, from 'a.wav':
  Duration: 00:01:02.50, bitrate: 1411 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s
At least one output file must be specified`)).toEqual({ codec: 'pcm_s16le', bitRate: 1411000, channels: 2, video: false, duration: 62.5 });
    expect(parseProbe(`  Duration: 00:00:03.00, start: 0.000000, bitrate: 50 kb/s
  Stream #0:0: Audio: vorbis, 48000 Hz, mono, fltp, 48 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p, 300x300, 90k tbr, 90k tbn (attached pic)`)).toMatchObject({ codec: 'vorbis', channels: 1, bitRate: 48000, video: false });
    expect(parseProbe(`  Duration: 00:00:10.00, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 4800 kb/s, 24 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, 5.1, fltp, 192 kb/s (default)`)).toMatchObject({ codec: 'aac', channels: 6, bitRate: 192000, video: true, duration: 10 });
  });
});

describe('compressing an export', () => {
  it('turns pictures into WebP, records the new names and leaves the game folder alone', async () => {
    const png = await painting();
    const apng = Buffer.concat([png.subarray(0, 33), Buffer.from('\0\0\0\x08acTL\0\0\0\x01\0\0\0\0\0\0\0\0'), png.subarray(33)]);
    const g = game({ 'bg/sea.png': png, 'bg/own.png': png, 'bg/own.webp': Buffer.from('x'), 'fx/spin.png': apng, 'notes.txt': Buffer.from('hi') });
    const r = await compressBuild(g.dir, g.web, settings({ images: 90 }), { cacheDir: g.cache, log: quiet });
    expect(r.renamed).toEqual({ 'bg/sea.png': 'bg/sea.webp' });
    expect(r.sizes).toEqual({});
    expect(existsSync(join(g.web, 'bg/sea.png'))).toBe(false);
    expect((await sharp(join(g.web, 'bg/sea.webp')).metadata()).format).toBe('webp');
    expect(statSync(join(g.web, 'bg/sea.webp')).size).toBeLessThan(png.length / 2);
    // A name already taken, and an animation WebP would flatten: as they were.
    expect(readFileSync(join(g.web, 'bg/own.png'))).toEqual(png);
    expect(readFileSync(join(g.web, 'fx/spin.png'))).toEqual(apng);
    expect(readdirSync(join(g.dir, 'assets/bg')).sort()).toEqual(['own.png', 'own.webp', 'sea.png']);
    expect(r.images).toMatchObject({ converted: 1, kept: 1 });
    expect(summary(r)).toMatch(/^Compressed: pictures .* MB → .* MB\.$/);

    recordRenamed(g.web, r);
    const json = JSON.parse(readFileSync(join(g.web, 'game.json'), 'utf8'));
    expect(json.renamed).toEqual({ 'bg/sea.png': 'bg/sea.webp' });
    expect(json.sizes).toBeUndefined();
  });

  it('makes pictures bigger than the screen smaller, and records the size they are drawn at', async () => {
    const g = game({
      'bg/big.png': await painting(640, 360), 'bg/pan.png': await painting(320, 540), 'cg/big.jpg': await painting(640, 360, 'jpeg'),
      'bg/small.png': await painting(160, 90),
    }, { meta: { canvas: '320x180' } });
    const r = await compressBuild(g.dir, g.web, settings({ shrink: 100 }), { cacheDir: g.cache, log: quiet });
    // Kept as PNG and JPEG (WebP is off): same names, half the size.
    expect(r.renamed).toEqual({});
    expect(r.sizes).toEqual({ 'bg/big.png': [640, 360], 'cg/big.jpg': [640, 360] });
    expect(await dims(join(g.web, 'bg/big.png'))).toEqual([320, 180]);
    expect(await dims(join(g.web, 'cg/big.jpg'))).toEqual([320, 180]);
    // A panorama, and a picture smaller than the screen: untouched.
    expect(await dims(join(g.web, 'bg/pan.png'))).toEqual([320, 540]);
    expect(readFileSync(join(g.web, 'bg/small.png'))).toEqual(readFileSync(join(g.dir, 'assets/bg/small.png')));
    expect(await dims(join(g.dir, 'assets/bg/big.png'))).toEqual([640, 360]);

    // With WebP too, the size goes with the new name.
    const w = game({ 'bg/big.png': await painting(640, 360) }, { meta: { canvas: '320x180' } });
    const rw = await compressBuild(w.dir, w.web, settings({ images: 90, shrink: 100 }), { cacheDir: w.cache, log: quiet });
    expect(rw.renamed).toEqual({ 'bg/big.png': 'bg/big.webp' });
    expect(rw.sizes).toEqual({ 'bg/big.webp': [640, 360] });
    recordRenamed(w.web, rw);
    expect(JSON.parse(readFileSync(join(w.web, 'game.json'), 'utf8')).sizes).toEqual({ 'bg/big.webp': [640, 360] });
    // From the cache, the size comes back too.
    writeFileSync(join(w.web, 'bg/big.png'), readFileSync(join(w.dir, 'assets/bg/big.png')));
    rmSync(join(w.web, 'bg/big.webp'));
    expect((await compressBuild(w.dir, w.web, settings({ images: 90, shrink: 100 }), { cacheDir: w.cache, log: quiet })).sizes).toEqual({ 'bg/big.webp': [640, 360] });
  });

  it('converts again only what changed, and nothing when all is off', async () => {
    const g = game({ 'bg/a.png': await painting() });
    const c = settings({ images: 'lossless' });
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
    const r = await compressBuild(g.dir, g.web, settings({ audio: 96, voice: 32, video: 23 }), {
      cacheDir: g.cache, log: (m) => logs.push(m), tools: { ffmpeg: null, opus: false, x264: false },
    });
    expect(r.audio.skipped).toMatch(/ffmpeg/);
    expect(r.voice.skipped).toMatch(/ffmpeg/);
    expect(logs.join('\n')).toMatch(/Skipping music and sound: compressing them needs ffmpeg/);
    expect(readFileSync(join(g.web, 'music/a.wav')).toString()).toBe('RIFF');
  });

  it('estimates the export from a few files, then exactly once they are converted', async () => {
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 40; i++) files[`bg/${i}.png`] = await painting(160 + i * 4, 90);
    const g = game(files);
    const c = settings({ images: 85 });
    const first = await estimateCompression(g.dir, c, gameFacts(null), { cacheDir: g.cache });
    expect(first.images).toMatchObject({ files: 40, exact: false });
    expect(first.images.after).toBeLessThan(first.images.before / 2);
    expect(first.before).toBe(first.images.before);
    // The files it tried are in the cache: the export doesn't do them again.
    expect(readdirSync(g.cache).length).toBe(32);
    const r = await compressBuild(g.dir, g.web, c, { cacheDir: g.cache, log: quiet });
    const exact = await estimateCompression(g.dir, c, gameFacts(null), { cacheDir: g.cache });
    expect(exact.images).toMatchObject({ files: 40, exact: true, before: r.images.before, after: r.images.after });
    expect(Math.abs(first.after - exact.after) / exact.after).toBeLessThan(0.15);
    // Nothing on: nothing to estimate.
    expect((await estimateCompression(g.dir, NO_COMPRESSION, gameFacts(null), { cacheDir: g.cache })).before).toBe(0);
  });

  const tools = findTools();
  const describeFile = (file: string) => parseProbe(spawnSync(tools.ffmpeg!, ['-hide_banner', '-i', file]).stderr.toString());
  it.skipIf(!tools.ffmpeg || !tools.opus || !tools.x264)('turns sound and voices into Opus and movies into H.264, leaving small lossy files alone', async () => {
    const dir = tempDir();
    const make = (args: string[], out: string) => {
      const r = spawnSync(tools.ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', ...args, join(dir, out)]);
      if (r.status !== 0) throw new Error(r.stderr.toString());
      return readFileSync(join(dir, out));
    };
    const wav = make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '2'], 'a.wav');
    const mono = make(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-ac', '1', '-c:a', 'flac'], 'v.flac');
    const small = make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libvorbis', '-b:a', '48k'], 's.ogg');
    const movie = make(['-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=24', '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv420p'], 'm.mp4');
    const g = game(
      { 'music/a.wav': wav, 'voice/v.flac': mono, 'lines/x.flac': mono, 'se/s.ogg': small, 'movie/op.mp4': movie },
      { meta: {}, code: [{ op: 'play', channel: 'voice', path: 'lines/x.flac' }] },
    );
    const c = settings({ audio: 96, voice: 24, video: 28 });
    const estimate = await estimateCompression(g.dir, c, gameFacts({ meta: {}, code: [{ op: 'play', channel: 'voice', path: 'lines/x.flac' }] } as never), { cacheDir: g.cache });
    expect(estimate.voice.files).toBe(2);
    expect(estimate.audio.files).toBe(2);
    expect(estimate.video).toMatchObject({ files: 1, exact: false });
    const r = await compressBuild(g.dir, g.web, c, { cacheDir: g.cache, log: quiet });
    expect(r.renamed).toEqual({ 'music/a.wav': 'music/a.ogg', 'voice/v.flac': 'voice/v.ogg', 'lines/x.flac': 'lines/x.ogg' });
    expect(describeFile(join(g.web, 'music/a.ogg')).codec).toBe('opus');
    expect(describeFile(join(g.web, 'voice/v.ogg')).codec).toBe('opus');
    expect(readFileSync(join(g.web, 'se/s.ogg'))).toEqual(small);
    expect(describeFile(join(g.web, 'movie/op.mp4'))).toMatchObject({ video: true });
    expect(spawnSync(tools.ffmpeg!, ['-hide_banner', '-i', join(g.web, 'movie/op.mp4')]).stderr.toString()).toMatch(/Video: h264/);
    expect(statSync(join(g.web, 'movie/op.mp4')).size).toBeLessThan(movie.length);
    expect(r.audio).toMatchObject({ converted: 1, kept: 1 });
    expect(r.voice).toMatchObject({ converted: 2, kept: 0 });
    expect(r.video).toMatchObject({ converted: 1, kept: 0 });
    // Voices at 24 kbit/s, stereo sound at 96: the voices come out smaller.
    const voice24 = statSync(join(g.web, 'lines/x.ogg')).size;
    expect(voice24).toBeLessThan(statSync(join(g.web, 'music/a.ogg')).size);

    // Voices with music and sound: mono, so half of 96, more than 24.
    const same = game({ 'lines/x.flac': mono }, { meta: {}, code: [{ op: 'play', channel: 'voice', path: 'lines/x.flac' }] });
    const rs = await compressBuild(same.dir, same.web, settings({ audio: 96 }), { cacheDir: same.cache, log: quiet });
    expect(rs.voice).toMatchObject({ converted: 1 });
    expect(statSync(join(same.web, 'lines/x.ogg')).size).toBeGreaterThan(voice24);
  }, 60_000);
});

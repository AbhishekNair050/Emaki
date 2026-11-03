import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compile, voiceMap, voicePath } from '@emaki/format';
import { compileGame } from '@emaki/format/files';
import { Runner } from '../src/index.ts';

const SRC = `---
title: Voiced
voice: voice/{speaker}/{id}.ogg
---
define ann "Ann"

label start:
  ann: Recorded.
  "Narration."
  play voice "voice/special.ogg"
  ann: Played by hand.
  ann: Not recorded yet.
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** A game folder with voice files for the lines whose text is in `recorded`. */
function game(recorded: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'emaki-voice-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'story.vn'), SRC);
  const story = compile(SRC).story!;
  for (const ins of story.code) {
    if (ins.op !== 'say' || !recorded.includes(ins.text)) continue;
    const path = join(dir, 'assets', voicePath(story.meta.voice!, ins.id, ins.who));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '');
  }
  return dir;
}

describe('voice by convention', () => {
  it('finds the voice files that exist, by line id and speaker', () => {
    const r = compileGame(game(['Recorded.', 'Narration.']));
    const ids = r.story!.code.flatMap((i) => (i.op === 'say' ? [i.id] : []));
    expect(r.story!.voices).toEqual({
      [ids[0]!]: `voice/ann/${ids[0]}.ogg`,
      [ids[1]!]: `voice/narrator/${ids[1]}.ogg`,
    });
    // Voice files don't change the story's hash (saves stay valid as recordings arrive).
    expect(r.story!.hash).toBe(compile(SRC).story!.hash);
    expect(compileGame(game([])).story!.voices).toBeUndefined();
  });

  it('plays each line\'s voice and remembers it for the log', () => {
    const run = new Runner(compileGame(game(['Recorded.'])).story!);
    const first = run.start();
    const voiceOf = (fx: typeof first.effects) => fx.filter((e) => e.type === 'play' && e.channel === 'voice').map((e) => (e as { path: string }).path);
    expect(voiceOf(first.effects)).toEqual([expect.stringMatching(/^voice\/ann\/start\.\w+\.ogg$/)]);
    expect(first.block).toMatchObject({ voice: voiceOf(first.effects)[0] });
    const second = run.advance();
    expect(voiceOf(second.effects)).toEqual([]);
    expect(second.block).not.toHaveProperty('voice');
    const third = run.advance();
    expect(voiceOf(third.effects)).toEqual(['voice/special.ogg']);
    expect(third.block).toMatchObject({ voice: 'voice/special.ogg' });
    expect(run.advance().block).not.toHaveProperty('voice');
    expect(run.log.map((b) => b.voice ?? null)).toEqual([voiceOf(first.effects)[0], null, 'voice/special.ogg', null]);
  });

  it('can be looked up from any list of files (the editor uses its asset list)', () => {
    const story = compile(SRC).story!;
    const id = story.code.flatMap((i) => (i.op === 'say' ? [i.id] : []))[0]!;
    const path = voicePath(story.meta.voice!, id, 'ann');
    expect(voiceMap(story, (p) => p === path)).toEqual({ [id]: path });
    expect(voiceMap(compile('label start:\n  "x"\n').story!, () => true)).toEqual({});
  });

  it('warns about a voice pattern without {id}', () => {
    const codes = (v: string) => compile(`---\nvoice: ${v}\n---\nlabel start:\n  "x"\n`).diagnostics.map((d) => d.code);
    expect(codes('voice/line.ogg')).toEqual(['bad-voice']);
    expect(codes('voice/{who}/{id}.ogg')).toEqual(['bad-voice']);
    expect(codes('voice/{speaker}/{id}.ogg')).toEqual([]);
  });
});

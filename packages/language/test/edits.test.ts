import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile, parse, print } from '@emaki/format';
import {
  addScene, connectScenes, declareAsset, declaredName, deleteScene, dropAsset, renameScene, suggestAssetName,
  type EditResult,
} from '../src/index.ts';

const demo = readFileSync(new URL('../../../games/gullwing/story.vn', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const SRC = `---
start: a
---

define mira "Mira"

image kitchen = "bg/kitchen.png"

# The opening.
label a:
  "Hello."
  jump b

label b:
  mira: Hi.

# Nobody goes here yet.
label c:
  "Lonely."
  end
`;

function ok(r: EditResult): { text: string; line: number } {
  if (!r.ok) throw new Error(r.error);
  // Every edit leaves a script that parses, is canonical, and keeps comments.
  expect(parse(r.text).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(print(parse(r.text).program)).toBe(r.text);
  return r;
}
const lineText = (r: { text: string; line: number }) => r.text.split('\n')[r.line - 1];

describe('flowchart edits', () => {
  it('adds a scene after another one', () => {
    const r = ok(addScene(SRC, 'kitchen_talk', 'a'));
    expect(lineText(r)).toBe('label kitchen_talk:');
    expect(r.text).toContain('label a:\n  "Hello."\n  jump b\n\nlabel kitchen_talk:\n  "..."\n\nlabel b:');
    expect(r.text).toContain('# The opening.\nlabel a:');
    expect(r.text).toContain('# Nobody goes here yet.\nlabel c:');
  });

  it('adds a scene at the end by default', () => {
    const r = ok(addScene(SRC, 'epilogue'));
    expect(r.text.endsWith('label epilogue:\n  "..."\n')).toBe(true);
  });

  it('rejects bad or duplicate scene names', () => {
    expect(addScene(SRC, 'b')).toMatchObject({ ok: false, error: expect.stringContaining('already a scene') });
    expect(addScene(SRC, '2nd')).toMatchObject({ ok: false, error: expect.stringContaining('valid scene name') });
    expect(addScene(SRC, 'menu')).toMatchObject({ ok: false, error: expect.stringContaining('keyword') });
  });

  it('renames a scene everywhere it is used, including start', () => {
    const r = ok(renameScene(SRC, 'b', 'bridge'));
    expect(r.text).toContain('jump bridge');
    expect(r.text).toContain('label bridge:');
    expect(r.text).not.toMatch(/\bb\b:/);
    const r2 = ok(renameScene(SRC, 'a', 'opening'));
    expect(r2.text).toContain('start: opening');
    expect(compile(r2.text).diagnostics).toEqual(compile(SRC).diagnostics.map((d) => ({ ...d })));
  });

  it('renames inside menus and conditions', () => {
    const r = ok(renameScene(demo, 'kitchen_talk', 'kitchen'));
    expect(r.text).not.toContain('kitchen_talk');
    expect(compile(r.text).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('deletes a scene nothing leads to, and refuses otherwise', () => {
    const r = ok(deleteScene(SRC, 'c'));
    expect(r.text).not.toContain('label c:');
    expect(r.text).not.toContain('Nobody goes here');
    expect(deleteScene(SRC, 'b')).toMatchObject({ ok: false, error: expect.stringContaining('a (line 12)') });
    expect(deleteScene(SRC, 'a')).toMatchObject({ ok: false, error: expect.stringContaining('starts') });
  });

  it('connecting a scene that falls off the end adds a jump', () => {
    const r = ok(connectScenes(SRC, 'b', 'c'));
    expect(lineText(r)).toBe('  jump c');
    expect(r.text).toContain('label b:\n  mira: Hi.\n  jump c\n');
  });

  it('connecting an ending replaces its end', () => {
    const r = ok(connectScenes(SRC, 'c', 'a'));
    expect(r.text).toContain('label c:\n  "Lonely."\n  jump a\n');
  });

  it('connecting a scene that already jumps turns it into a choice', () => {
    const r = ok(connectScenes(SRC, 'a', 'c'));
    expect(r.text).toContain([
      'label a:',
      '  "Hello."',
      '  menu:',
      '    "(Choice) B":',
      '      jump b',
      '    "(Choice) C":',
      '      jump c',
    ].join('\n'));
    expect(lineText(r)).toBe('  menu:');
    // ... and a third connection adds a third option.
    const r2 = ok(connectScenes(r.text, 'a', 'a'));
    expect(r2.text).toContain('    "(Choice) A":\n      jump a\n');
    expect(connectScenes(r2.text, 'a', 'c')).toMatchObject({ ok: false });
  });

  it('works on the demo and keeps every comment', () => {
    const r = ok(connectScenes(demo, 'the_long_night', 'arrival'));
    const comments = (t: string) => t.split('\n').filter((l) => l.trim().startsWith('#'));
    expect(comments(r.text)).toEqual(comments(demo));
  });

  it('never edits a script with syntax errors', () => {
    const broken = SRC.replace('jump b', 'jump');
    expect(addScene(broken, 'x')).toMatchObject({ ok: false, error: expect.stringContaining('Fix the script') });
    expect(connectScenes(broken, 'b', 'c')).toMatchObject({ ok: false });
  });
});

describe('asset edits', () => {
  it('suggests readable names, sprites for characters, and avoids clashes', () => {
    expect(suggestAssetName(SRC, 'image', 'images/Cliff Road (dusk).png')).toBe('cliff_road_dusk');
    expect(suggestAssetName(SRC, 'image', 'bg/bg_kitchen.png')).toBe('kitchen_2');
    expect(suggestAssetName(SRC, 'image', 'sprites/mira_smile.png')).toBe('mira smile');
    expect(suggestAssetName(SRC, 'audio', 'audio/01-theme.mp3')).toBe('audio_01_theme');
    expect(suggestAssetName(SRC, 'image', 'images/label.png')).toBe('label_');
  });

  it('declares an image after the other images', () => {
    const r = ok(declareAsset(SRC, 'image', 'images/hall.png'));
    expect(lineText(r)).toBe('image hall = "images/hall.png"');
    expect(r.text).toContain('image kitchen = "bg/kitchen.png"\nimage hall = "images/hall.png"\n');
    expect(declaredName(r.text, 'image', 'images/hall.png')).toBe('hall');
  });

  it('declaring an already-declared file is a no-op that reports its name', () => {
    const r = declareAsset(SRC, 'image', 'bg/kitchen.png');
    expect(r).toMatchObject({ ok: true, name: 'kitchen', text: SRC });
  });

  it('starts the audio section when there is none', () => {
    const r = ok(declareAsset(SRC, 'audio', 'audio/rain.mp3'));
    expect(r.text).toContain('image kitchen = "bg/kitchen.png"\n\naudio rain = "audio/rain.mp3"\n');
  });

  it('dropping an image into a scene declares it and shows it there', () => {
    // Line 11 is '  "Hello."': drop a background before it.
    const r = ok(dropAsset(SRC, 'image', 'images/hall.png', 11));
    expect(lineText(r)).toBe('  scene hall');
    expect(r.text).toContain('label a:\n  scene hall\n  "Hello."');
    expect(compile(r.text).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const sprite = ok(dropAsset(SRC, 'image', 'sprites/mira_happy.png', 15));
    expect(sprite.text).toContain('label b:\n  show mira happy\n  mira: Hi.');
    const music = ok(dropAsset(SRC, 'audio', 'audio/theme.mp3', 11));
    expect(music.text).toContain('  play music theme\n  "Hello."');
    const sound = ok(dropAsset(SRC, 'audio', 'sfx/door.mp3', 11));
    expect(sound.text).toContain('  play sound door\n');
  });

  it('dropping outside a scene only declares', () => {
    const r = ok(dropAsset(SRC, 'image', 'images/hall.png', 3));
    expect(lineText(r)).toBe('image hall = "images/hall.png"');
    expect(r.text.match(/hall/g)).toHaveLength(2);
  });
});

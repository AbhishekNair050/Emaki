import { describe, expect, it } from 'vitest';
import { compile, parse, print } from '../src/index.ts';

const SRC = `---
title: The Pier
canvas: 1920x1080
---

image logo = "ui/logo.png"

var trust = 0
global var endings = 0

screen title:
  image "ui/title_bg.png"
  image logo at 50% 30% anchor center alt "The Pier"
  column at 1536px 648px anchor center gap 2%:
    button "New Game" image "ui/new.png" hover "ui/new_on.png" -> start
    button "Continue" -> continue
    button "Epilogue" -> start epilogue if endings >= 3
    button "Settings" -> open settings
    button "About" -> open about
    button "Quit" -> quit
  text "Version 1.0" at 98% 98% anchor bottom-right class=version

screen about:
  box at 10% 10% size 80% 80% class=panel:
    text "Made with *care*."
    row gap 12px:
      button "Trust" -> set trust += 1, set endings = endings + 1
      button "Back" -> close

label start:
  "Hello."

label epilogue:
  "Later."
`;

describe('screens', () => {
  it('parse and print back unchanged', () => {
    const p = parse(SRC);
    expect(p.diagnostics).toEqual([]);
    expect(print(p.program)).toBe(SRC.slice(SRC.indexOf('---')));
  });

  it('compile to percentages of the screen, with translatable text', () => {
    const r = compile(SRC);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const title = r.story!.screens!.title!;
    expect(title.items[1]).toMatchObject({ kind: 'image', image: 'ui/logo.png', x: 50, y: 30, anchor: [0.5, 0.5], alt: 'The Pier' });
    const col = title.items[2]!;
    expect(col).toMatchObject({ kind: 'column', x: 80, y: 60, gap: 2, anchor: [0.5, 0.5] });
    expect(col.children![0]).toMatchObject({ kind: 'button', text: 'New Game', image: 'ui/new.png', hover: 'ui/new_on.png', actions: [{ do: 'start' }] });
    expect(col.children![2]!.cond).toBeTruthy();
    const about = r.story!.screens!.about!.items[0]!;
    expect(about.children![0]).toMatchObject({ text: 'Made with care.', spans: [{ text: 'Made with ' }, { text: 'care', i: true }, { text: '.' }] });
    expect(about.children![1]).toMatchObject({ kind: 'row', gap: Math.round((12 / 1080) * 100 * 1000) / 1000 });
    const ids = r.strings.filter((s) => s.kind === 'screen').map((s) => s.text);
    expect(ids).toEqual(['The Pier', 'New Game', 'Continue', 'Epilogue', 'Settings', 'About', 'Quit', 'Version 1.0', 'Made with *care*.', 'Trust', 'Back']);
  });

  it('explain mistakes', () => {
    const at = (screen: string, header = '') => compile(`${header}var x = 0\nscreen s:\n  ${screen}\nlabel start:\n  "x"\n`).diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
    expect(at('button -> start')).toEqual(['bad-screen']);
    expect(at('button "Go" -> fly')).toEqual(['bad-screen']);
    expect(at('text "Hi" -> start')).toEqual(['bad-screen']);
    expect(at('column at 50% 50%')).toEqual(['bad-screen']);
    expect(at('image "a.png" at 50%')).toEqual(['bad-screen']);
    expect(at('image "a.png" at 100px 20px')).toEqual(['no-canvas']);
    expect(at('image "a.png" at 100px 20px', '---\ncanvas: 1280x720\n---\n')).toEqual([]);
    expect(at('button "Go" -> jump nowhere')).toEqual(['unknown-label']);
    expect(at('button "Go" -> open nowhere')).toEqual(['unknown-screen']);
    expect(at('button "Go" -> set y = 1')).toEqual(['unknown-variable']);
    expect(at('button "Go" -> start if y > 1')).toEqual(['unknown-variable']);
    expect(at('image missing')).toEqual(['unknown-image']);
    expect(at('button "Go" -> close if x > 1')).toEqual([]);
    expect(compile('screen load:\n  text "x"\nlabel start:\n  "x"\n').diagnostics.map((d) => d.code)).toContain('reserved-screen');
  });
});

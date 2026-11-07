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
    expect(compile('screen history:\n  text "x"\nlabel start:\n  "x"\n').diagnostics.map((d) => d.code)).toContain('reserved-screen');
  });
});

const DATA = `---
save_slots: 24
---

image cg_beach = "cg/beach.png" gallery

ending good "Good End"

screen load:
  slots 6 columns 3 gap 2% -> load:
    thumbnail
    text "{slot_number}. {slot_date}" if not slot_empty
    text "Empty" if slot_empty
  row:
    button "Previous" -> page previous
    text "{page} / {pages}"
    button "Next" -> page next
  button "Back" -> close

screen save:
  slots 6 columns 3 -> save

screen settings:
  slider "Music" music_volume
  toggle "Skip unread text" skip_unread
  choice "Font" font
  button "Done" -> close

screen extras:
  gallery 8 columns 4
  endings
  achievements
  button "Page 2" -> page 2

label start:
  "x"
  end good
`;

describe('data screens', () => {
  it('parse, print back and compile', () => {
    const p = parse(DATA);
    expect(p.diagnostics).toEqual([]);
    expect(print(p.program)).toBe(DATA.slice(DATA.indexOf('---')));
    const r = compile(DATA);
    expect(r.diagnostics).toEqual([]);
    const s = r.story!.screens!;
    expect(s.load!.items[0]).toMatchObject({ kind: 'slots', count: 6, columns: 3, gap: 2, actions: [{ do: 'load' }] });
    expect(s.load!.items[0]!.children!.map((c) => c.kind)).toEqual(['thumbnail', 'text', 'text']);
    expect(s.save!.items[0]).toMatchObject({ kind: 'slots', count: 6, actions: [{ do: 'save' }] });
    expect(s.settings!.items.slice(0, 3).map((c) => [c.kind, c.setting, c.text])).toEqual([
      ['slider', 'music_volume', 'Music'], ['toggle', 'skip_unread', 'Skip unread text'], ['choice', 'font', 'Font'],
    ]);
    expect(s.extras!.items.map((c) => c.kind)).toEqual(['gallery', 'endings', 'achievements', 'button']);
    expect(s.extras!.items[3]!.actions).toEqual([{ do: 'page', to: 2 }]);
  });

  it('explain mistakes', () => {
    const at = (screen: string) => compile(`screen s:\n  ${screen.split('\n').join('\n  ')}\nlabel start:\n  "x"\n`).diagnostics.map((d) => d.code);
    expect(at('slots 6')).toEqual(['bad-screen']);                      // what does clicking do?
    expect(at('slots 6 -> start')).toEqual(['bad-screen']);
    expect(at('slots 0 -> load')).toEqual(['bad-screen']);
    expect(at('slots 6 columns 8 -> load')).toEqual(['bad-screen']);
    expect(at('slots 3 -> load')).toEqual([]);
    expect(at('slots 6 -> load')).toEqual(['few-slots']);                // 3 save slots by default
    expect(at('button "Go" -> load')).toEqual(['bad-screen']);
    expect(at('thumbnail')).toEqual(['bad-screen']);                     // only in slots
    expect(at('slots 3 -> load:\n  button "x" -> close')).toEqual(['bad-screen']);
    expect(at('text "{slot_date}"')).toEqual(['unknown-variable']);      // only in slots
    expect(at('text "{page} of {pages}"')).toEqual([]);
    expect(at('slider "Music" loudness')).toEqual(['bad-screen']);
    expect(at('toggle skip_unread')).toEqual(['bad-screen']);
    expect(at('button "Go" -> page sideways')).toEqual(['bad-screen']);
    expect(at('gallery 8 columns 4')).toEqual([]);
  });
});

describe('screens and the story', () => {
  it('count labels their buttons start or jump to as reachable', () => {
    const src = 'screen title:\n  button "Epilogue" -> start epilogue\n\nlabel start:\n  "x"\n\nlabel epilogue:\n  "y"\n';
    expect(compile(src).diagnostics.map((d) => d.code)).not.toContain('unreachable-label');
  });
});

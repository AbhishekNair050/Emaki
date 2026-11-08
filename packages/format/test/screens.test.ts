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
    expect(compile('screen history:\n  text "x"\nlabel start:\n  "x"\n').diagnostics.map((d) => d.code)).not.toContain('reserved-screen'); // history can be replaced now
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

const BOX = `---
canvas: 1920x1080
---

screen textbox:
  image "ui/mw.png" at 0px 829px
  image "ui/name.png" at 57px 786px if speaker
  speaker at 215px 756px
  dialogue at 220px 855px size 1522px 200px
  side at 0px 600px
  button "Auto" image "ui/auto.png" hover "ui/auto_on.png" pressed "ui/auto_down.png" selected "ui/auto_sel.png" -> auto
  button "Save" image "ui/save.png" disabled "ui/save_off.png" -> open save
  button "Quick save" -> quicksave
  button "Hide" -> hide

screen settings with fade 0.3:
  slider "Music" music_volume image "ui/track.png" knob "ui/knob.png" at 919px 214px size 400px 18px
  button "Skip all" image "ui/check.png" selected "ui/checked.png" -> setting skip_unread on
  button "English" -> setting language en
  button "Sound" -> switch sound

screen sound:
  button "Back" -> close

label start:
  "x"
`;

describe('text box and polish', () => {
  it('parse, print back and compile', () => {
    const p = parse(BOX);
    expect(p.diagnostics).toEqual([]);
    expect(print(p.program)).toBe(BOX.slice(BOX.indexOf('---')));
    const r = compile(BOX);
    expect(r.diagnostics).toEqual([]);
    const tb = r.story!.screens!.textbox!;
    expect(tb.items.map((i) => i.kind)).toEqual(['image', 'image', 'speaker', 'dialogue', 'side', 'button', 'button', 'button', 'button']);
    expect(tb.items[3]).toMatchObject({ kind: 'dialogue', x: 11.458, w: 79.271 });
    expect(tb.items[5]).toMatchObject({ pressed: 'ui/auto_down.png', selected: 'ui/auto_sel.png', actions: [{ do: 'auto' }] });
    const st = r.story!.screens!.settings!;
    expect(st).toMatchObject({ transition: 'fade', duration: 0.3 });
    expect(st.items[0]).toMatchObject({ kind: 'slider', image: 'ui/track.png', knob: 'ui/knob.png' });
    expect(st.items.slice(1).map((i) => i.actions)).toEqual([
      [{ do: 'setting', name: 'skip_unread', value: true }], [{ do: 'setting', name: 'language', value: 'en' }], [{ do: 'switch', screen: 'sound' }],
    ]);
  });

  it('explain mistakes', () => {
    const at = (screen: string, name = 's') => compile(`screen ${name}:\n  ${screen.split('\n').join('\n  ')}\nlabel start:\n  "x"\n`).diagnostics.map((d) => d.code);
    expect(at('dialogue')).toEqual(['bad-screen']);                          // only in the text box
    expect(at('speaker', 'textbox')).toEqual(['bad-screen']);                // a text box needs a dialogue
    expect(at('dialogue\ndialogue', 'textbox')).toEqual(['bad-screen']);
    expect(at('text "{speaker}"')).toEqual(['unknown-variable']);
    expect(at('dialogue\ntext "{speaker}"', 'textbox')).toEqual([]);
    expect(at('button "x" -> setting skip_unread 3')).toEqual(['bad-screen']);
    expect(at('button "x" -> setting font comic')).toEqual(['bad-screen']);
    expect(at('button "x" -> setting loudness 3')).toEqual(['bad-screen']);
    expect(at('button "x" -> switch nowhere')).toEqual(['unknown-screen']);
    expect(at('button "x" hover "a.png" -> close')).toEqual(['bad-screen']);  // hover needs image
    expect(at('slider "Music" music_volume knob "k.png"')).toEqual(['bad-screen']);
    expect(at('text "x" knob "k.png"')).toEqual(['bad-screen']);
    expect(compile('screen s with spin:\n  text "x"\nlabel start:\n  "x"\n').diagnostics.map((d) => d.code)).toEqual(['bad-screen']);
  });
});

const M7 = `define rin "Rin"

screen history:
  log 3 at 136px 181px size 1600px 310px:
    text "{log_name}" at 94px 0px
    text "{log_text}" at 94px 50px size 1500px auto
    button "Replay" -> voice if log_voice
    button "Go back" -> rewind
  button "Up" -> scroll up
  button "Down" -> scroll down

screen confirm:
  image "ui/dialog_{confirm}.png"
  text "{message}"
  button "Yes" -> yes
  button "No" -> no

screen settings:
  slider "Master" master_volume
  slider "Rin" voice_volume rin
  toggle "Mute Rin" voice_mute rin image "ui/box.png" selected "ui/ticked.png"
  toggle "Ask before quitting" confirm_quit
  button "Test" -> sample voice "voice/rin_test.ogg" rin
  button "Reset" -> reset
  button "Next choice" -> next_choice
  button "Previous choice" -> previous_choice

label start:
  "x"
`;

describe('history, questions and per-character settings', () => {
  it('parse, print back and compile', () => {
    const p = parse(M7);
    expect(p.diagnostics).toEqual([]);
    expect(print(p.program)).toBe(M7);
    const s = compile('---\ncanvas: 1920x1080\n---\n\n' + M7);
    expect(s.diagnostics).toEqual([]);
    const log = s.story!.screens!.history!.items[0]!;
    expect(log).toMatchObject({ kind: 'log', count: 3 });
    expect(log.children!.map((c) => c.actions?.[0]?.do)).toEqual([undefined, undefined, 'voice', 'rewind']);
    const st = s.story!.screens!.settings!.items;
    expect(st[1]).toMatchObject({ setting: 'voice_volume', character: 'rin' });
    expect(st[2]).toMatchObject({ kind: 'toggle', character: 'rin', image: 'ui/box.png' });
    expect(st[4]!.actions).toEqual([{ do: 'sample', channel: 'voice', path: 'voice/rin_test.ogg', character: 'rin' }]);
  });

  it('explain mistakes', () => {
    const at = (screen: string, name = 's') =>
      compile(`define rin "Rin"\nscreen ${name}:\n  ${screen.split('\n').join('\n  ')}\nlabel start:\n  "x"\n`).diagnostics.map((d) => d.code);
    expect(at('button "x" -> rewind')).toEqual(['bad-screen']);                 // only in a log
    expect(at('text "{log_text}"')).toEqual(['unknown-variable']);
    expect(at('text "{message}"')).toEqual(['unknown-variable']);
    expect(at('text "{message}"\nbutton "OK" -> yes', 'confirm')).toEqual([]);
    expect(at('slider "Kei" voice_volume kei')).toEqual(['unknown-character']);
    expect(at('log 3')).toEqual(['bad-screen']);                                // needs entries
    expect(at('button "x" -> sample music "a.ogg"')).toEqual(['bad-screen']);
    expect(at('button "x" -> scroll left')).toEqual(['bad-screen']);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@emaki/format';
import { Analysis, format } from '../src/index.ts';

const demoSrc = readFileSync(fileURLToPath(new URL('../../../games/gullwing/story.vn', import.meta.url)), 'utf8');

const src = [
  '---',
  'title: Test',
  'start: intro',
  '---',
  '',
  'define mira "Mira" color=#e8b04b',
  '',
  'image kitchen = "bg/kitchen.png"',
  'image mira smile = "sprites/mira_smile.png"',
  'image mira sad = "sprites/mira_sad.png"',
  '',
  'audio rain = "audio/rain.ogg"',
  '',
  'var trust = 0',
  '',
  'label intro:',
  '  scene kitchen with fade',
  '  show mira smile at left',
  '  mira sad: Hello.',
  '  play sound rain',
  '  if trust > 1:',
  '    jump outro',
  '  "Trust is {trust}."',
  '  jump outro',
  '',
  'label outro:',
  '  "Bye."',
  '  # a note',
  '',
].join('\n');

/** Find `needle` on the given 0-based line and return a column inside it. */
function at(text: string, line: number, needle: string): [number, number] {
  const col = text.split('\n')[line]!.indexOf(needle);
  if (col < 0) throw new Error(`'${needle}' not on line ${line}`);
  return [line, col + 1];
}

describe('problems', () => {
  it('has none for the demo story', () => {
    expect(new Analysis(demoSrc).problems().filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('underlines the unknown name, not the whole line', () => {
    const broken = src.replace('    jump outro', '    jump outr');
    const [p] = new Analysis(broken).problems();
    expect(p).toMatchObject({ severity: 'error', range: { line: 21, start: 9, end: 13 } });
    expect(p!.message).toContain("Did you mean 'outro'?");
  });

  it('underlines just the bad value', () => {
    const broken = src.replace('  show mira smile at left', '  show mira smile at nowhere');
    const p = new Analysis(broken).problems().find((x) => x.range.line === 17)!;
    expect(p.range).toEqual({ line: 17, start: 21, end: 28 });
  });

  it('falls back to the line text, without its indentation', () => {
    const p = new Analysis('label a:\n  menu:\n  "x"\n').problems()[0]!;
    expect(p.range).toEqual({ line: 1, start: 2, end: 7 });
  });
});

describe('symbols', () => {
  it('lists every definition, with label bodies ending at their last line', () => {
    const syms = new Analysis(src).symbols();
    const intro = syms.find((s) => s.name === 'intro')!;
    expect(intro).toMatchObject({ kind: 'label', line: 15, endLine: 23, detail: '2 lines of dialogue' });
    expect(syms.find((s) => s.name === 'outro')).toMatchObject({ line: 25, endLine: 27 });
    expect(syms.find((s) => s.name === 'mira')).toMatchObject({ kind: 'character', detail: 'Mira #e8b04b' });
    expect(syms.find((s) => s.name === 'trust')).toMatchObject({ kind: 'variable', detail: '= 0' });
    expect(syms.filter((s) => s.kind === 'image').map((s) => s.name)).toEqual(['kitchen', 'mira smile', 'mira sad']);
  });
});

describe('go to definition', () => {
  const a = new Analysis(src);
  const def = (line: number, needle: string) => a.definitionAt(...at(src, line, needle));

  it('finds labels from jumps and the header', () => {
    expect(def(21, 'outro')).toMatchObject({ kind: 'label', line: 25 });
    expect(def(2, 'intro')).toMatchObject({ kind: 'label', line: 15 });
  });

  it('finds images by their full name, and characters from dialogue', () => {
    expect(def(16, 'kitchen')).toMatchObject({ kind: 'image', line: 7 });
    expect(def(17, 'smile')).toMatchObject({ kind: 'image', name: 'mira smile' });
    expect(def(17, 'mira')).toMatchObject({ kind: 'image', name: 'mira smile' });
    expect(def(18, 'mira')).toMatchObject({ kind: 'character', line: 5 });
    expect(def(18, 'sad')).toMatchObject({ kind: 'image', name: 'mira sad' });
  });

  it('finds variables and audio', () => {
    expect(def(20, 'trust')).toMatchObject({ kind: 'variable', line: 13 });
    expect(def(22, 'trust')).toMatchObject({ kind: 'variable' });
    expect(def(19, 'rain')).toMatchObject({ kind: 'audio', line: 11 });
  });

  it('ignores keywords and plain words', () => {
    expect(def(16, 'fade')).toBeUndefined();
    expect(def(26, 'Bye')).toBeUndefined();
  });

  it('finds every use of a definition', () => {
    const lines = (s: ReturnType<typeof def>, decl = false) => a.referencesTo(s!, decl).map((r) => r.line);
    expect(lines(def(21, 'outro'))).toEqual([21, 23]);
    expect(lines(def(21, 'outro'), true)).toEqual([21, 23, 25]);
    expect(lines(def(20, 'trust'))).toEqual([20, 22]);
    expect(lines(def(17, 'smile'))).toEqual([17]); // once per line, though "mira" and "smile" both name it
  });

  it('describes names on hover', () => {
    expect(a.hoverAt(...at(src, 18, 'mira'))).toBe('**mira** — character, shown as *Mira #e8b04b*');
    expect(a.hoverAt(...at(src, 21, 'outro'))).toContain('label, 1 line of dialogue (line 26)');
  });
});

describe('completion', () => {
  const labels = (lines: string, line: number, col?: number) => {
    const a = new Analysis(lines);
    return a.completionsAt(line, col ?? lines.split('\n')[line]!.length).map((c) => c.label);
  };
  const edit = (line: string) => src.replace('  # a note', line);

  it('offers labels after jump and call', () => {
    expect(labels(edit('  jump '), 27)).toEqual(['intro', 'outro']);
    expect(labels(edit('  call ou'), 27)).toEqual(['intro', 'outro']);
  });

  it('offers backgrounds after scene, sprite tags and attributes after show', () => {
    expect(labels(edit('  scene '), 27)).toEqual(['kitchen', 'black']);
    expect(labels(edit('  show '), 27)).toEqual(['kitchen', 'mira']);
    expect(labels(edit('  show mira '), 27)).toEqual(['smile', 'sad']);
    expect(labels(edit('  mira '), 27)).toEqual(['smile', 'sad']);
  });

  it('offers the game\'s screens after show screen and call screen', () => {
    const withScreens = (line: string) => edit(line) + '\nscreen map:\n  button "Go" -> return\n\nscreen settings:\n  button "Done" -> close\n';
    expect(labels(withScreens('  show '), 27)).toEqual(['kitchen', 'mira', 'screen']);
    expect(labels(withScreens('  call screen '), 27)).toEqual(['map']);
    expect(labels(withScreens('  hide screen m'), 27)).toEqual(['map']);
  });

  it('offers transitions, positions, variables and channels', () => {
    expect(labels(edit('  scene kitchen with '), 27)).toEqual(['fade', 'dissolve', 'move', 'none']);
    expect(labels(edit('  show mira smile at '), 27)).toEqual(['left', 'center', 'right']);
    expect(labels(edit('  set '), 27)).toEqual(['trust']);
    expect(labels(edit('  "You have {'), 27)).toEqual(['trust']);
    expect(labels(edit('  play '), 27)).toEqual(['music', 'ambience', 'sound', 'voice']);
    expect(labels(edit('  play music '), 27)).toEqual(['rain']);
  });

  it('offers characters and statements at the start of a story line, declarations at top level', () => {
    const start = labels(edit('  '), 27);
    expect(start[0]).toBe('mira');
    expect(start).toContain('menu');
    expect(labels(edit('lab'), 27)).toEqual(['define', 'image', 'audio', 'layered', 'screen', 'var', 'global var', 'achievement', 'ending', 'replay', 'label']);
    expect(labels(src, 1, 0)).toEqual([]); // inside the header
  });
});

describe('format', () => {
  it('formats valid scripts and refuses broken ones', () => {
    expect(format(demoSrc)).toBe(demoSrc);
    expect(format('label a:\n      "x"\n')).toBe('label a:\n  "x"\n');
    expect(format('label a:\n  jump\n')).toBeNull();
  });
});

describe('preview links', () => {
  it('turns a 0-based editor line into the dev server address', async () => {
    const { previewUrl } = await import('../src/index.ts');
    expect(previewUrl('http://localhost:5173/', 51)).toBe('http://localhost:5173/?line=52');
    expect(previewUrl('http://localhost:5173/game/?trust=2', 0)).toBe('http://localhost:5173/game/?trust=2&line=1');
    expect(() => previewUrl('not a url', 0)).toThrow();
  });
});

describe('plugins', () => {
  const plugins = {
    weather: parseManifest({
      description: 'Snow, rain and petals',
      commands: {
        start: { args: { kind: ['snow', 'rain'], amount: 'number?', loud: 'boolean?' }, lasting: 'sky', description: 'Start falling' },
        stop: { lasting: 'sky', ends: true },
      },
    }, 'weather').manifest!,
    dice: parseManifest({ functions: { roll: { args: { sides: 'number', times: 'number?' }, returns: 'number', description: 'Roll dice' } } }, 'dice').manifest!,
    clock: parseManifest({ elements: { face: { args: { style: ['digital', 'hands'] } } } }, 'clock').manifest!,
  };
  const story = [
    'var n = 0',
    '',
    'screen hud:',
    '  @clock face style="digital" at 1% 1%',
    '',
    'label start:',
    '  @weather start kind="snow"',
    '  set n = @dice.roll(6)',
    '  "x"',
    '',
  ].join('\n');
  const analysis = (text: string) => new Analysis(text, { file: 'story.vn', files: [], plugins });
  const complete = (text: string, line: number, col?: number) => {
    const t = text.split('\n');
    return analysis(text).completionsAt(line, col ?? t[line]!.length).map((c) => c.label);
  };
  const withLine = (line: string) => story.replace('  "x"', `${line}\n  "x"`);
  const at = 8; // the line inserted before "x"

  it('check @ lines and functions against the manifests the editor gives', () => {
    expect(analysis(story).problems()).toEqual([]);
    expect(analysis(withLine('  @weather begin')).problems().map((p) => p.code)).toEqual(['unknown-plugin-command']);
    expect(analysis(withLine('  set n = @dice.roll()')).problems().map((p) => p.code)).toEqual(['bad-plugin-arg']);
    // A lone script with no game around it: nothing to check against.
    expect(new Analysis(withLine('  @weather begin')).problems()).toEqual([]);
  });

  it('complete plugins, commands, elements, arguments, values and functions', () => {
    expect(complete(withLine('  @'), at)).toEqual(['weather']);
    expect(complete(withLine('  @weather '), at)).toEqual(['start', 'stop']);
    expect(complete(withLine('  @weather start '), at)).toEqual(['kind=', 'amount=', 'loud=']);
    expect(complete(withLine('  @weather start kind="snow" '), at)).toEqual(['amount=', 'loud=']);
    expect(complete(withLine('  @weather start kind='), at)).toEqual(['"snow"', '"rain"']);
    expect(complete(withLine('  @weather start kind="r'), at)).toEqual(['snow', 'rain']);
    expect(complete(withLine('  @weather start loud='), at)).toEqual(['true', 'false']);
    expect(complete(withLine('  @weather start amount='), at)).toEqual(['n']);
    expect(complete(withLine('  set n = @'), at)).toEqual(['dice']);
    expect(complete(withLine('  if @dice.'), at)).toEqual(['roll']);
    // In a screen, `@` lines are elements.
    const screen = story.replace('  @clock face style="digital" at 1% 1%', '  @');
    expect(complete(screen, 3)).toEqual(['clock']);
    expect(complete(story.replace('  @clock face style="digital" at 1% 1%', '  @clock '), 3)).toEqual(['face']);
  });

  it('describe them on hover', () => {
    const a = analysis(story);
    expect(a.hoverAt(6, 4)).toBe('**@weather** — plugin: Snow, rain and petals');
    expect(a.hoverAt(6, 12)).toBe('**@weather start** — plugin command, lasting (sky)\n\n`kind`: "snow" | "rain" · `amount`: number (optional) · `loud`: boolean (optional)\n\nStart falling');
    expect(a.hoverAt(7, 17)).toBe('**@dice.roll**(sides, times?) → number — plugin function\n\nRoll dice');
    expect(a.hoverAt(3, 10)).toContain('**@clock face** — plugin element');
  });
});

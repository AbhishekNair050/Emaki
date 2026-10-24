import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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

  it('offers transitions, positions, variables and channels', () => {
    expect(labels(edit('  scene kitchen with '), 27)).toEqual(['fade', 'dissolve', 'none']);
    expect(labels(edit('  show mira smile at '), 27)).toEqual(['left', 'center', 'right']);
    expect(labels(edit('  set '), 27)).toEqual(['trust']);
    expect(labels(edit('  "You have {'), 27)).toEqual(['trust']);
    expect(labels(edit('  play '), 27)).toEqual(['music', 'sound', 'voice']);
    expect(labels(edit('  play music '), 27)).toEqual(['rain']);
  });

  it('offers characters and statements at the start of a story line, declarations at top level', () => {
    const start = labels(edit('  '), 27);
    expect(start[0]).toBe('mira');
    expect(start).toContain('menu');
    expect(labels(edit('lab'), 27)).toEqual(['define', 'image', 'audio', 'var', 'achievement', 'label']);
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

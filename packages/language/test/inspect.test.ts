import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editLine, inspectLine, looksOf } from '../src/index.ts';

const demo = readFileSync(new URL('../../../games/gullwing/story.vn', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ok = (r: ReturnType<typeof editLine>) => {
  if (!r.ok) throw new Error(r.error);
  return r.text;
};

describe('inspectLine', () => {
  it('reads the statements the inspector shows', () => {
    expect(inspectLine('  show mira neutral at center with dissolve')?.stmt).toMatchObject({ type: 'show', tag: 'mira', attrs: ['neutral'], at: 'center', transition: 'dissolve' });
    expect(inspectLine('    scene kitchen with fade 2')?.stmt).toMatchObject({ type: 'scene', image: 'kitchen', transition: 'fade', duration: 2 });
    expect(inspectLine('  hide mira with dissolve')?.stmt).toMatchObject({ type: 'hide', tag: 'mira' });
    expect(inspectLine('  mira smile: You poured me one.')?.stmt).toMatchObject({ type: 'say', who: 'mira', attrs: ['smile'] });
    expect(inspectLine('  "Narration."')?.stmt).toMatchObject({ type: 'say', who: null });
    expect(inspectLine('    show mira sad')?.indent).toBe('    ');
  });

  it('ignores what it does not show', () => {
    for (const line of ['', '  # a comment', 'label a:', '  menu:', '    "Read the letter.":', '    "Ask." if trust >= 1:', '  if trust > 1:', '  jump a', '  set trust += 1', '  show mira at']) {
      expect(inspectLine(line), line).toBeNull();
    }
  });

  it('understands every show, scene, hide and dialogue line of the demo', () => {
    const lines = demo.split('\n').filter((l) => /^\s+(show|scene|hide) /.test(l) || /^\s+[a-z]\w*( \w+)*: \S/.test(l));
    expect(lines.length).toBeGreaterThan(20);
    for (const l of lines) expect(inspectLine(l), l).not.toBeNull();
  });
});

describe('editLine', () => {
  it('changes a character’s look, place and transition', () => {
    const line = '  show mira neutral at center with dissolve';
    expect(ok(editLine(line, { look: ['smile'] }))).toBe('  show mira smile at center with dissolve');
    expect(ok(editLine(line, { at: 'right' }))).toBe('  show mira neutral at right with dissolve');
    expect(ok(editLine(line, { at: '30%' }))).toBe('  show mira neutral at 30% with dissolve');
    expect(ok(editLine(line, { at: null }))).toBe('  show mira neutral with dissolve');
    expect(ok(editLine(line, { transition: 'fade', duration: 1.5 }))).toBe('  show mira neutral at center with fade 1.5');
    expect(ok(editLine(line, { transition: 'none' }))).toBe('  show mira neutral at center');
  });

  it('changes a speaker’s look and a background', () => {
    expect(ok(editLine('  mira: Drink it fast.', { look: ['stern'] }))).toBe('  mira stern: Drink it fast.');
    expect(ok(editLine('  mira stern: Drink it fast.', { look: [] }))).toBe('  mira: Drink it fast.');
    expect(ok(editLine('  scene kitchen with dissolve', { image: 'lamp_room' }))).toBe('  scene lamp_room with dissolve');
  });

  it('keeps the end-of-line comment and the indentation', () => {
    expect(ok(editLine('      show mira sad  # she heard', { look: ['smile'] }))).toBe('      show mira smile  # she heard');
  });

  it('keeps everything the inspector does not change', () => {
    expect(ok(editLine('  show mira neutral as twin at left with move 0.4', { look: ['sad'] }))).toBe('  show mira sad as twin at left with move 0.4');
  });

  it('refuses changes that do not apply, with a reason', () => {
    expect(editLine('  "Narration."', { look: ['smile'] }).ok).toBe(false);
    expect(editLine('  hide mira', { at: 'left' }).ok).toBe(false);
    expect(editLine('  show mira', { look: ['bad name'] }).ok).toBe(false);
    expect(editLine('  show mira', { at: 'over there' }).ok).toBe(false);
    expect(editLine('  jump a', { look: [] }).ok).toBe(false);
  });
});

describe('looksOf', () => {
  it('lists a character’s declared looks', () => {
    expect(looksOf('mira', ['mira neutral', 'mira smile', 'kitchen', 'mirage x'])).toEqual([['neutral'], ['smile']]);
  });
});

import { describe, expect, it } from 'vitest';
import { compile, compileTranslation, parse, print, updateCatalog } from '@emaki/format';
import { Runner } from '../src/index.ts';

const SRC = `var x = 0

achievement first_light "First Light"
achievement keeper "Keeper of the Point"

label a:
  "The lamp catches."
  achieve first_light
  "It turns."
`;

describe('achievements', () => {
  it('parse, print back unchanged, and compile into the story', () => {
    const p = parse(SRC);
    expect(p.diagnostics).toEqual([]);
    expect(p.program.achievements.map((a) => [a.id, a.name])).toEqual([['first_light', 'First Light'], ['keeper', 'Keeper of the Point']]);
    expect(print(p.program)).toBe(SRC);
    const r = compile(SRC);
    expect(r.story!.achievements).toEqual({ first_light: { name: 'First Light' }, keeper: { name: 'Keeper of the Point' } });
    expect(r.strings.filter((s) => s.kind === 'achievement').map((s) => s.id)).toEqual(['achievement.first_light', 'achievement.keeper']);
  });

  it('catch typos and bad declarations', () => {
    const typo = compile(SRC.replace('achieve first_light', 'achieve frist_light'));
    expect(typo.diagnostics.map((d) => d.message)).toEqual(["Unknown name 'frist_light'. Did you mean 'first_light'?"]);
    expect(compile('achievement x\nlabel a:\n  "Hi."\n').diagnostics[0]!.code).toBe('bad-achievement');
    expect(compile('label a:\n  achieve\n').diagnostics[0]!.code).toBe('bad-achieve');
  });

  it('unlock as an effect, with the name in the current language', () => {
    const r = compile(SRC);
    const run = new Runner(r.story!);
    run.start();
    expect(run.advance().effects).toEqual([{ type: 'achieve', id: 'first_light', name: 'First Light' }]);

    const cat = updateCatalog(r.strings, null, 'fr');
    cat.entries.find((e) => e.id === 'achievement.first_light')!.translation = 'Première lumière';
    const fr = new Runner(r.story!);
    fr.setTranslation(compileTranslation(cat, r.strings).translation);
    fr.start();
    expect(fr.advance().effects[0]).toMatchObject({ name: 'Première lumière' });
  });

  it('stories without achievements compile exactly as before', () => {
    expect('achievements' in compile('label a:\n  "Hi."\n').story!).toBe(false);
  });
});

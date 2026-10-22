import { describe, expect, it } from 'vitest';
import { compile, compileTranslation, updateCatalog } from '@emaki/format';
import { Runner, type SayBlock } from '../src/index.ts';

const SRC = `define mira "Mira"

var name = "Ren"

label a:
  "The pier creaks."
  mira: Hello, {name}. *Careful.*
  set name = "Sam"
  menu:
    "Walk on.":
      mira: Brave.
    "Untranslated choice.":
      mira: Already?
`;

function setup() {
  const r = compile(SRC);
  const cat = updateCatalog(r.strings, null, 'fr');
  const t = (src: string, text: string) => { cat.entries.find((e) => e.source === src)!.translation = text; };
  t('Mira', 'Myra');
  t('The pier creaks.', 'Le ponton grince.');
  t('Hello, {name}. *Careful.*', 'Bonjour, {name}. **Attention.**');
  t('Walk on.', 'Avancer.');
  return { story: r.story!, fr: compileTranslation(cat, r.strings).translation };
}

const say = (b: unknown) => b as SayBlock;

describe('translations', () => {
  it('shows translated lines, names and choices; untranslated text falls back to the original', () => {
    const { story, fr } = setup();
    const r = new Runner(story);
    r.setTranslation(fr);
    expect(say(r.start().block).text).toBe('Le ponton grince.');
    const hello = say(r.advance().block);
    expect(hello.who?.name).toBe('Myra');
    expect(hello.text).toBe('Bonjour, Ren. Attention.');
    expect(hello.spans).toEqual([{ text: 'Bonjour, Ren. ' }, { text: 'Attention.', b: true }]);
    const menu = r.advance().block;
    expect(menu.type === 'menu' && menu.choices.map((c) => c.text)).toEqual(['Avancer.', 'Untranslated choice.']);
  });

  it('switching language redoes the line on screen, and rollback and the log follow it', () => {
    const { story, fr } = setup();
    const r = new Runner(story);
    r.start();
    r.advance();
    expect(say(r.block).text).toBe('Hello, Ren. Careful.');
    expect(say(r.setTranslation(fr)).text).toBe('Bonjour, Ren. Attention.');
    expect(r.language).toBe('fr');
    r.advance(); // the menu; `name` is now Sam
    expect(r.log.map((b) => b.text)).toEqual(['Le ponton grince.', 'Bonjour, Ren. Attention.']);
    r.setTranslation(null);
    const back = r.back()!;
    expect(say(back.block).text).toBe('Hello, Ren. Careful.');
    r.setTranslation(fr);
    expect(say(r.back()!.block).text).toBe('Le ponton grince.');
  });

  it('saves load in the language being played', () => {
    const { story, fr } = setup();
    const a = new Runner(story);
    a.start();
    const save = a.save();
    const b = new Runner(story);
    b.setTranslation(fr);
    b.load(save);
    expect(say(b.block).text).toBe('Le ponton grince.');
  });
});

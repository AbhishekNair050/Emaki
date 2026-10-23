import { describe, expect, it } from 'vitest';
import { compile, compileTranslation, updateCatalog } from '@emaki/format';
import { fill, isRtl, languageName, matchLanguage, uiSourceStrings, UI_STRINGS } from '../src/ui-strings.ts';
import { sanitizeSettings } from '../src/settings.ts';

describe('interface strings', () => {
  it('are offered to translators with the story', () => {
    const ui = uiSourceStrings();
    expect(ui.length).toBe(Object.keys(UI_STRINGS).length);
    expect(ui.every((s) => s.id.startsWith('ui.') && s.kind === 'ui')).toBe(true);
    const story = compile('label a:\n  "Hi."\n');
    const cat = updateCatalog([...story.strings, ...ui], null, 'fr');
    cat.entries.find((e) => e.id === 'ui.slot')!.translation = 'Emplacement {n} : {label}';
    const t = compileTranslation(cat, [...story.strings, ...ui]);
    expect(t.diagnostics).toEqual([]);
    expect(fill(t.translation.strings['ui.slot']!.text, { n: 2, label: 'Vide' })).toBe('Emplacement 2 : Vide');
  });

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(fill('{n} letters/s', { n: 45 })).toBe('45 letters/s');
    expect(fill('{n} and {x}', { n: 1 })).toBe('1 and {x}');
  });
});

describe('languages', () => {
  it('match exactly first, then by base language', () => {
    expect(matchLanguage(['pt-BR', 'en'], ['en', 'pt-BR', 'pt'])).toBe('pt-BR');
    expect(matchLanguage(['fr-CA', 'en'], ['en', 'fr'])).toBe('en');
    expect(matchLanguage(['fr-CA'], ['en', 'fr'])).toBe('fr');
    expect(matchLanguage(['ja'], ['en', 'fr'])).toBeNull();
  });

  it('are named in their own language, and right-to-left ones are recognised', () => {
    expect(languageName('fr')).toBe('Français');
    expect(languageName('de')).toBe('Deutsch');
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('he-IL')).toBe(true);
    expect(isRtl('fr')).toBe(false);
  });

  it('the language setting accepts codes and auto, nothing else', () => {
    expect(sanitizeSettings({}).language).toBe('auto');
    expect(sanitizeSettings({ language: 'pt-BR' }).language).toBe('pt-BR');
    expect(sanitizeSettings({ language: '<script>' }).language).toBe('auto');
    expect(sanitizeSettings({ language: 42 }).language).toBe('auto');
  });
});

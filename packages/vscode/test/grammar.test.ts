/**
 * Tokenizes snippets with the same TextMate engine VS Code uses, and checks
 * the scopes (which decide the colours) of the interesting pieces.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const require = createRequire(import.meta.url);
let grammar: textmate.IGrammar;

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (s) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async () => textmate.parseRawGrammar(readFileSync(here('../syntaxes/emaki.tmLanguage.json'), 'utf8'), 'emaki.tmLanguage.json'),
  });
  grammar = (await registry.loadGrammar('source.emaki'))!;
});

/** Tokenize a document; returns, per line, [text, innermost-ish scopes] for each token. */
function tokens(src: string): Array<Array<[string, string]>> {
  let state = textmate.INITIAL;
  return src.split('\n').map((line) => {
    const r = grammar.tokenizeLine(line, state);
    state = r.ruleStack;
    return r.tokens.map((t) => [line.slice(t.startIndex, t.endIndex), t.scopes.slice(1).join(' ')] as [string, string]);
  });
}

/** The scopes of the first token with exactly this text on the line. */
function scopeOf(line: Array<[string, string]>, text: string): string {
  const hit = line.find(([t]) => t === text);
  if (!hit) throw new Error(`no token '${text}' in ${JSON.stringify(line)}`);
  return hit[1];
}

describe('grammar', () => {
  it('colours the header, declarations and labels', () => {
    const [, title, start, , def, img, v, lbl, comment] = tokens([
      '---', 'title: The Keeper', 'start: arrival', '---',
      'define mira "Mira" color=#e8b04b',
      'image mira smile = "sprites/mira_smile.svg"',
      'var trust = 0',
      'label arrival:',
      '# a note',
    ].join('\n'));
    expect(scopeOf(title!, 'title')).toContain('entity.name.tag');
    expect(scopeOf(title!, 'The Keeper')).toContain('string.unquoted');
    expect(scopeOf(start!, 'arrival')).toContain('entity.name.function.label');
    expect(scopeOf(def!, 'define')).toContain('keyword.other.define');
    expect(scopeOf(def!, 'mira')).toContain('entity.name.type.character');
    expect(scopeOf(def!, '#e8b04b')).toContain('constant.other.color');
    expect(scopeOf(img!, 'mira smile')).toContain('entity.name.type.asset');
    expect(scopeOf(img!, '"sprites/mira_smile.svg"')).toContain('string.quoted.double.path');
    expect(scopeOf(v!, 'trust')).toContain('variable.other.declaration');
    expect(scopeOf(v!, '0')).toContain('constant.numeric');
    expect(scopeOf(lbl!, 'arrival')).toContain('entity.name.function.label');
    expect(scopeOf(comment!, ' a note')).toContain('comment.line');
  });

  it('colours story statements', () => {
    const [, scene, show, jump, set, iff, play] = tokens([
      'label a:',
      '  scene cliff_road with fade',
      '  show mira smile at left with dissolve',
      '  jump kitchen_talk',
      '  set trust += 1',
      '  if trust >= 2 and not read_letter:',
      '  play music "audio/theme.ogg" fade 1.5',
    ].join('\n'));
    expect(scopeOf(scene!, 'scene')).toContain('keyword.other.scene');
    expect(scopeOf(scene!, 'cliff_road')).toContain('entity.name.type.asset');
    expect(scopeOf(scene!, 'fade')).toContain('constant.language.transition');
    expect(scopeOf(show!, 'mira smile')).toContain('entity.name.type.asset');
    expect(scopeOf(show!, 'left')).toContain('constant.language.position');
    expect(scopeOf(jump!, 'jump')).toContain('keyword.control.flow');
    expect(scopeOf(jump!, 'kitchen_talk')).toContain('entity.name.function.label');
    expect(scopeOf(set!, 'trust')).toContain('variable.other');
    expect(scopeOf(set!, '+=')).toContain('keyword.operator.assignment');
    expect(scopeOf(iff!, 'if')).toContain('keyword.control.conditional');
    expect(scopeOf(iff!, 'and')).toContain('keyword.operator.logical');
    expect(scopeOf(iff!, 'read_letter')).toContain('variable.other');
    expect(scopeOf(play!, 'music')).toContain('support.type.channel');
    expect(scopeOf(play!, '1.5')).toContain('constant.numeric');
  });

  it('colours dialogue, narration, choices and text styling', () => {
    const [, say, narr, , choice, cond] = tokens([
      'label a:',
      '  mira smile: You are *early*, {name}. [color=gold]Gold[/color] \\* star',
      '  "The **bus** left."',
      '  menu:',
      '    "Stay.":',
      '    "Ask her." if trust >= 2:',
    ].join('\n'));
    expect(scopeOf(say!, 'mira')).toContain('entity.name.type.character');
    expect(scopeOf(say!, ' smile')).toContain('entity.other.attribute-name');
    expect(scopeOf(say!, 'You are ')).toContain('string.unquoted.dialogue');
    expect(scopeOf(say!, 'early')).toContain('markup.italic');
    expect(scopeOf(say!, 'name')).toContain('variable.other');
    expect(scopeOf(say!, 'color')).toContain('entity.name.tag');
    expect(scopeOf(say!, 'gold')).toContain('constant.other.color');
    expect(scopeOf(say!, '\\*')).toContain('constant.character.escape');
    expect(scopeOf(narr!, 'bus')).toContain('markup.bold');
    expect(scopeOf(narr!, 'The ')).toContain('string.quoted.double.dialogue');
    expect(scopeOf(choice!, 'Stay.')).toContain('string.quoted.double.dialogue');
    expect(scopeOf(cond!, 'if')).toContain('keyword.control.conditional');
    expect(scopeOf(cond!, 'trust')).toContain('variable.other');
  });

  it('colours end-of-line comments without breaking the line', () => {
    const [, title, , , label, scene, say, hash, quoted, cond] = tokens([
      '---', 'title: The Keeper  # working title', 'start: arrival', '---',
      'label arrival:  # the opening',
      '  scene kitchen with fade  # morning',
      '  mira: Hello.  # first words',
      '  mira: Room #4.',
      '  mira: "Quoted # text"',
      '  if trust >= 2:  # trusted',
    ].join('\n'));
    expect(scopeOf(title!, '#')).toContain('comment.line');
    expect(scopeOf(title!, 'The Keeper')).toContain('string.unquoted');
    expect(scopeOf(label!, 'arrival')).toContain('entity.name.function.label');
    expect(scopeOf(label!, '#')).toContain('comment.line');
    expect(scopeOf(scene!, 'kitchen')).toContain('entity.name.type.asset');
    expect(scopeOf(scene!, '#')).toContain('comment.line');
    expect(scopeOf(say!, '#')).toContain('comment.line');
    expect(hash!.every(([, sc]) => !sc.includes('comment'))).toBe(true);
    expect(quoted!.every(([, sc]) => !sc.includes('comment'))).toBe(true);
    expect(scopeOf(cond!, 'trust')).toContain('variable.other');
    expect(scopeOf(cond!, '#')).toContain('comment.line');
  });

  it('tokenizes the whole demo without leaving a line uncoloured', () => {
    const src = readFileSync(here('../../../games/gullwing/story.vn'), 'utf8');
    const lines = tokens(src);
    const bare = lines
      .map((toks, i) => [i + 1, toks] as const)
      .filter(([, toks]) => toks.some(([t, s]) => t.trim() && s === ''));
    expect(bare.map(([n]) => n)).toEqual([]);
  });
});

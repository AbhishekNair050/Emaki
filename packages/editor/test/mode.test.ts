import { readFileSync } from 'node:fs';
import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { emakiLanguage } from '../src/script/mode.ts';

const names = tagHighlighter([
  { tag: t.comment, class: 'comment' },
  { tag: t.meta, class: 'meta' },
  { tag: t.keyword, class: 'keyword' },
  { tag: t.definition(t.labelName), class: 'labelDef' },
  { tag: t.labelName, class: 'label' },
  { tag: t.className, class: 'speaker' },
  { tag: t.typeName, class: 'asset' },
  { tag: t.definition(t.variableName), class: 'varDef' },
  { tag: t.special(t.variableName), class: 'interp' },
  { tag: t.variableName, class: 'var' },
  { tag: t.propertyName, class: 'prop' },
  { tag: t.string, class: 'string' },
  { tag: t.content, class: 'prose' },
  { tag: t.processingInstruction, class: 'markup' },
  { tag: t.color, class: 'color' },
  { tag: t.number, class: 'number' },
  { tag: t.atom, class: 'atom' },
  { tag: t.operator, class: 'op' },
]);

/** Each line as "class:text" tokens (unstyled text omitted). */
function tokens(src: string): string[][] {
  const tree = emakiLanguage.parser.parse(src);
  const lines: string[][] = [[]];
  highlightCode(src, tree, names,
    (text, cls) => { if (cls && text.trim()) lines[lines.length - 1]!.push(`${cls}:${text.trim()}`); },
    () => lines.push([]));
  return lines;
}

describe('script highlighting', () => {
  it('colours front matter, declarations and comments', () => {
    const l = tokens([
      '---', 'title: A', 'start: a', '---',
      '# cast',
      'define mira "Mira" color=#e8b04b',
      'image mira smile = "sprites/mira_smile.svg"',
      'audio rain = "audio/rain.mp3"',
      'var trust = 0',
      'label a:',
    ].join('\n'));
    expect(l[0]).toEqual(['meta:---']);
    expect(l[1]).toEqual(['prop:title', 'string:A']);
    expect(l[3]).toEqual(['meta:---']);
    expect(l[4]).toEqual(['comment:# cast']);
    expect(l[5]).toEqual(['keyword:define', 'speaker:mira', 'string:"Mira"', 'var:color', 'op:=', 'color:#e8b04b']);
    expect(l[6]).toEqual(['keyword:image', 'asset:mira', 'asset:smile', 'op:=', 'string:"sprites/mira_smile.svg"']);
    expect(l[7]).toEqual(['keyword:audio', 'asset:rain', 'op:=', 'string:"audio/rain.mp3"']);
    expect(l[8]).toEqual(['keyword:var', 'varDef:trust', 'op:=', 'number:0']);
    expect(l[9]).toEqual(['keyword:label', 'labelDef:a']);
  });

  it('colours end-of-line comments', () => {
    const l = tokens([
      '---', 'title: A  # for now', '---',
      'label a:  # opening',
      '  scene kitchen  # morning',
      '  mira: Hello.  # first words',
      '  mira: Room #4.',
    ].join('\n'));
    expect(l[1]).toEqual(['prop:title', 'string:A', 'comment:# for now']);
    expect(l[3]).toEqual(['keyword:label', 'labelDef:a', 'comment:# opening']);
    expect(l[4]).toEqual(['keyword:scene', 'asset:kitchen', 'comment:# morning']);
    expect(l[5]).toEqual(['speaker:mira', 'prose:Hello.', 'comment:# first words']);
    expect(l[6]!.some((x) => x.startsWith('comment'))).toBe(false);
  });

  it('colours statements, speakers and prose', () => {
    const l = tokens([
      'label a:',
      '  scene kitchen with fade',
      '  play music storm fade 2',
      '  mira smile: Hello, *you*. {trust} points.',
      '  "Narration with a {name}."',
      '  jump b',
      '  if trust >= 2 and not lamp_fixed:',
      '    set boat_safe = true',
    ].join('\n'));
    expect(l[1]).toEqual(['keyword:scene', 'asset:kitchen', 'keyword:with', 'keyword:fade']);
    expect(l[2]).toEqual(['keyword:play', 'atom:music', 'asset:storm', 'keyword:fade', 'number:2']);
    expect(l[3]).toEqual(['speaker:mira', 'var:smile', 'prose:Hello,', 'markup:*', 'prose:you', 'markup:*', 'prose:.', 'interp:{trust}', 'prose:points.']);
    expect(l[4]).toEqual(['prose:"Narration with a', 'interp:{name}', 'prose:."']);
    expect(l[5]).toEqual(['keyword:jump', 'label:b']);
    expect(l[6]).toEqual(['keyword:if', 'var:trust', 'op:>=', 'number:2', 'keyword:and', 'keyword:not', 'var:lamp_fixed']);
    expect(l[7]).toEqual(['keyword:set', 'var:boat_safe', 'op:=', 'atom:true']);
  });

  it('treats a menu choice as prose, and its condition as code', () => {
    const l = tokens('label a:\n  menu:\n    "Stay." if trust > 1:\n      jump b');
    expect(l[1]).toEqual(['keyword:menu']);
    expect(l[2]).toEqual(['prose:"Stay."', 'keyword:if', 'var:trust', 'op:>', 'number:1']);
  });

  it('tokenizes the whole demo without leaving dialogue unstyled', () => {
    const src = readFileSync(new URL('../../../games/gullwing/story.vn', import.meta.url), 'utf8');
    const lines = tokens(src);
    const sayLines = src.split('\n').map((text, i) => [text, lines[i]!] as const).filter(([text]) => /^\s+\w+( \w+)*: \S/.test(text));
    expect(sayLines.length).toBeGreaterThan(20);
    for (const [text, toks] of sayLines) {
      expect(toks[0], text).toMatch(/^speaker:/);
      expect(toks.some((x) => x.startsWith('prose:')), text).toBe(true);
    }
  });
});

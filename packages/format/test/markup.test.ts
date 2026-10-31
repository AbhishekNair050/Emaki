import { describe, expect, it } from 'vitest';
import { parseMarkup } from '../src/markup.ts';

const spans = (s: string) => parseMarkup(s).spans;

describe('text styling markup', () => {
  it('leaves plain text alone', () => {
    const r = parseMarkup('Just words [in brackets], 3 < 4.');
    expect(r).toEqual({ spans: [{ text: 'Just words [in brackets], 3 < 4.' }], plain: 'Just words [in brackets], 3 < 4.', styled: false, error: null });
  });

  it('parses italic, bold and both', () => {
    expect(spans('I *never* said that.')).toEqual([{ text: 'I ' }, { text: 'never', i: true }, { text: ' said that.' }]);
    expect(spans('**Now.**')).toEqual([{ text: 'Now.', b: true }]);
    expect(spans('***Run!***')).toEqual([{ text: 'Run!', b: true, i: true }]);
    expect(spans('**bold *and italic* bold**')).toEqual([
      { text: 'bold ', b: true }, { text: 'and italic', b: true, i: true }, { text: ' bold', b: true },
    ]);
  });

  it('parses colours, nested and with other styles', () => {
    expect(spans('The [color=#e8b04b]lamp[/color] dies.')).toEqual([
      { text: 'The ' }, { text: 'lamp', color: '#e8b04b' }, { text: ' dies.' },
    ]);
    expect(spans('[color=gold]a [color=red]b[/color] *c*[/color]')).toEqual([
      { text: 'a ', color: 'gold' }, { text: 'b', color: 'red' }, { text: ' ', color: 'gold' }, { text: 'c', color: 'gold', i: true },
    ]);
  });

  it('supports escapes for literal characters', () => {
    const r = parseMarkup('5 \\* 3 \\[color=red] \\\\');
    expect(r.plain).toBe('5 * 3 [color=red] \\');
    expect(r.styled).toBe(false);
    expect(r.error).toBeNull();
  });

  it('keeps variables inside styles intact', () => {
    expect(spans('Hello, *{name}*!')).toEqual([{ text: 'Hello, ' }, { text: '{name}', i: true }, { text: '!' }]);
  });

  it('reports friendly errors', () => {
    expect(parseMarkup('a *lone star').error).toMatch(/Unclosed '\*'.*write \\\*/);
    expect(parseMarkup('**half').error).toMatch(/Unclosed '\*\*'/);
    expect(parseMarkup('[color=gold]open').error).toMatch(/Unclosed '\[color=gold\]'/);
    expect(parseMarkup('close[/color]').error).toMatch(/no matching/);
    expect(parseMarkup('[color=#zz]x[/color]').error).toMatch(/isn't a colour/);
  });

  it('merges adjacent spans with the same style', () => {
    expect(spans('*a **b***')).toEqual([{ text: 'a ', i: true }, { text: 'b', b: true, i: true }]);
    expect(spans('*a*\\**b*')).toEqual([{ text: 'a', i: true }, { text: '*' }, { text: 'b', i: true }]);
  });
});

describe('styled text in scripts', () => {
  const header = 'define a "Alice"\nvar n = 3\n';

  it('compiles styled dialogue and choices into plain text + spans', async () => {
    const { compile } = await import('../src/index.ts');
    const r = compile(`${header}label start:\n  a: I *never* said {n}.\n  "Plain line."\n  menu:\n    "**Run**":\n      end\n    "Stay":\n      end\n`);
    expect(r.diagnostics).toEqual([]);
    const [say, plain, menu] = r.story!.code;
    expect(say).toMatchObject({ op: 'say', text: 'I never said {n}.', spans: [{ text: 'I ' }, { text: 'never', i: true }, { text: ' said {n}.' }] });
    expect(plain).not.toHaveProperty('spans');
    if (menu.op !== 'menu') throw new Error('expected menu');
    expect(menu.choices[0]).toMatchObject({ text: 'Run', spans: [{ text: 'Run', b: true }] });
    expect(menu.choices[1]).not.toHaveProperty('spans');
  });

  it('reports markup mistakes with line numbers', async () => {
    const { compile } = await import('../src/index.ts');
    const r = compile(`${header}label start:\n  a: A *lone star.\n`);
    expect(r.story).toBeNull();
    expect(r.diagnostics).toEqual([expect.objectContaining({ line: 4, code: 'bad-markup' })]);
  });

  it('keeps escapes inside quoted text, and round-trips through the printer', async () => {
    const { compile, parse, print } = await import('../src/index.ts');
    // String.raw so the backslashes reach the parser exactly as a writer types them.
    const src = header + String.raw`
label start:
  a: "Room 5 \* 3, say \"hi\"."
  "A \*literal\* star."
`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.story!.code[0]).toMatchObject({ text: 'Room 5 * 3, say "hi".' });
    expect(r.story!.code[1]).toMatchObject({ text: 'A *literal* star.' });
    const printed = print(parse(src).program);
    const noSrc = (code: NonNullable<typeof r.story>["code"]) => code.slice(0, 2).map(({ src: _src, ...rest }) => rest);
    expect(noSrc(compile(printed).story!.code)).toEqual(noSrc(r.story!.code));
  });
});

describe('pauses inside a line', () => {
  it('parse [w], [w=seconds] and [nw] into empty pause spans', () => {
    const r = parseMarkup('Well...[w] *fine*.[w=1.5] Go[nw]');
    expect(r.error).toBeNull();
    expect(r.plain).toBe('Well... fine. Go');
    expect(r.styled).toBe(true);
    expect(r.spans).toEqual([
      { text: 'Well...' }, { text: '', pause: 'click' }, { text: ' ' }, { text: 'fine', i: true }, { text: '.' },
      { text: '', pause: 1.5 }, { text: ' Go' }, { text: '', pause: 'next' },
    ]);
  });

  it('keep plain-text-only lines unstyled and escaped brackets literal', () => {
    expect(parseMarkup('No pause \\[w] here').spans).toEqual([{ text: 'No pause [w] here' }]);
    expect(parseMarkup('[wink]').spans).toEqual([{ text: '[wink]' }]);
  });

  it('reject misplaced or malformed pauses', () => {
    expect(parseMarkup('Go[nw] on').error).toMatch(/very end/);
    expect(parseMarkup('Hm[w=soon]').error).toMatch(/seconds/);
    expect(parseMarkup('Hm[w=99]').error).toMatch(/seconds/);
  });

  it('are not allowed in choices', async () => {
    const { compile } = await import('../src/index.ts');
    const r = compile('label start:\n  menu:\n    "Wait[w] for it":\n      end\n');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['bad-markup']);
  });
});

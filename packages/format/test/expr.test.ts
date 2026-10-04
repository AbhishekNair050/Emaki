import { describe, expect, it } from 'vitest';
import { evaluate, ExprError, EvalError, freeVars, parseExpr, printExpr } from '../src/expr.ts';

const ev = (src: string, vars: Record<string, number | string | boolean> = {}) => evaluate(parseExpr(src), vars);

describe('expressions', () => {
  it('does arithmetic with precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('10 - 4 - 3')).toBe(3);
    expect(ev('-2 * 3')).toBe(-6);
    expect(ev('7 % 3')).toBe(1);
  });

  it('compares and combines', () => {
    expect(ev('trust >= 2 and not read', { trust: 2, read: false })).toBe(true);
    expect(ev('a or b', { a: false, b: true })).toBe(true);
    expect(ev('name == "Mira"', { name: 'Mira' })).toBe(true);
  });

  it('concatenates strings', () => {
    expect(ev('"Hello, " + name', { name: 'Ren' })).toBe('Hello, Ren');
    expect(ev('"x" + 1')).toBe('x1');
  });

  it('gives friendly errors for other-language habits', () => {
    expect(() => parseExpr('a && b')).toThrow(/Use 'and'/);
    expect(() => parseExpr('!a')).toThrow(/Use 'not'/);
    expect(() => parseExpr('a = 1')).toThrow(/use '=='/);
    expect(() => parseExpr('1 +')).toThrow(ExprError);
    expect(() => parseExpr('(1')).toThrow(/Expected '\)'/);
  });

  it('reports runtime errors', () => {
    expect(() => ev('x + 1')).toThrow(EvalError);
    expect(() => ev('1 / 0')).toThrow(/Division by zero/);
    expect(() => ev('"a" < 1')).toThrow(/Cannot compare/);
  });

  it('lists free variables', () => {
    expect([...freeVars(parseExpr('a + b * a > c'))].sort()).toEqual(['a', 'b', 'c']);
  });

  it('prints expressions that re-parse identically', () => {
    for (const src of ['a - (b - c)', 'not (a and b)', '-(x + 1) * 2', 'a or b and c', '"q\\"uote"', 'not a == b']) {
      const e = parseExpr(src);
      expect(parseExpr(printExpr(e))).toEqual(e);
    }
  });
});

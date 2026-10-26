import { describe, expect, it } from 'vitest';
import { compile, parse, print } from '@emaki/format';
import { Runner } from '../src/index.ts';

const SRC = `global var endings = 0
var trust = 0

label start:
  if endings >= 1:
    "Welcome back."
  "A new day."
  set trust += 1
  set endings += 1
  "The end."
`;

function runner() {
  const r = compile(SRC);
  expect(r.diagnostics).toEqual([]);
  return new Runner(r.story!);
}

describe('global var', () => {
  it('parses, prints back and compiles into the story', () => {
    const p = parse(SRC);
    expect(p.program.vars.map((v) => [v.name, !!v.global])).toEqual([['endings', true], ['trust', false]]);
    expect(print(p.program)).toContain('global var endings = 0');
    expect(compile(SRC).story!.globals).toEqual(['endings']);
    expect(compile('var x = 0\nlabel start:\n  "Hi."\n').story!.globals).toBeUndefined();
  });

  it('reports changes so the host can keep them, and carries them into the next playthrough', () => {
    const run = runner();
    expect(run.start().block).toMatchObject({ text: 'A new day.' });
    const step = run.advance();
    expect(step.effects).toEqual([{ type: 'globals', values: { endings: 1 } }]);

    const next = runner();
    next.setGlobals({ endings: 1, trust: 5, junk: 3 });
    expect(next.start().block).toMatchObject({ text: 'Welcome back.' });
    expect(next.vars.trust).toBe(0);
  });

  it('wins over saves and rollback', () => {
    const run = runner();
    run.start();
    const save = run.save();
    run.advance();
    run.back();
    expect(run.vars.endings).toBe(1);
    expect(run.load(save).ok).toBe(true);
    expect(run.vars.endings).toBe(1);
  });
});

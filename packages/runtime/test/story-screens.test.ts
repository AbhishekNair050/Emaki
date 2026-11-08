import { describe, expect, it } from 'vitest';
import { compile, parse, print } from '@emaki/format';
import { Runner } from '../src/index.ts';

const SRC = `var day = 1
var place = ""

screen hud:
  text "Day {day}" at 2% 2%

screen map:
  button "Beach" -> return "beach"
  button "Town" -> return "town"
  button "Never mind" -> return

label start:
  show screen hud
  "Morning."
  call screen map -> place
  "Off to the {place}."
  hide screen hud
  "Evening."
  call screen map
  "Done."
`;

const story = () => {
  const r = compile(SRC);
  expect(r.diagnostics).toEqual([]);
  return r.story!;
};

describe('screens during the story', () => {
  it('parse and print back', () => {
    const p = parse(SRC);
    expect(p.diagnostics).toEqual([]);
    expect(print(p.program)).toBe(SRC);
  });

  it('show and hide screens as part of the state, and wait on a called one', () => {
    const run = new Runner(story());
    const first = run.start();
    expect(first.effects).toContainEqual({ type: 'screens', screens: ['hud'] });
    expect(run.screens).toEqual(['hud']);
    const call = run.advance();
    expect(call.block).toMatchObject({ type: 'screen', name: 'map' });
    expect(() => run.advance()).toThrow(/must return/);
    expect(run.returnFromScreen('beach').block).toMatchObject({ type: 'say', text: 'Off to the beach.' });
    expect(run.vars.place).toBe('beach');
    // Rollback returns to the waiting screen, with the variable as it was.
    expect(run.back()!.block).toMatchObject({ type: 'screen', name: 'map' });
    expect(run.vars.place).toBe('');
    run.returnFromScreen('town');
    const evening = run.advance();
    expect(evening.effects).toContainEqual({ type: 'screens', screens: [] });
    expect(run.screens).toEqual([]);
    run.advance();
    // A call without a variable, and a return without a value.
    expect(run.returnFromScreen().block).toMatchObject({ text: 'Done.' });
    expect(run.vars.place).toBe('town');
  });

  it('keep shown screens in saves, and close one from its own button', () => {
    const run = new Runner(story());
    run.start();
    const save = run.save();
    const other = new Runner(story());
    other.load(save);
    expect(other.screens).toEqual(['hud']);
    other.hideScreen('hud');
    expect(other.screens).toEqual([]);
  });

  it('rebuild shown screens when previewing from a line', () => {
    const run = new Runner(story());
    run.startAtLine(SRC.split('\n').indexOf('  "Off to the {place}."') + 1);
    expect(run.screens).toEqual(['hud']);
  });

  it('explain mistakes', () => {
    const codes = (body: string, screens = 'screen map:\n  button "Go" -> return 1\n') =>
      compile(`var x = 0\n${screens}label start:\n  ${body}\n  "x"\n`).diagnostics.map((d) => d.code);
    expect(codes('call screen map -> x')).toEqual([]);
    expect(codes('call screen nowhere')).toEqual(['unknown-screen']);
    expect(codes('call screen map -> y')).toEqual(['unknown-variable']);
    expect(codes('show screen map -> x')).toEqual(['bad-show']);
    expect(codes('show screen settings')).toEqual(['bad-screen']);
    expect(codes('call screen map', 'screen map:\n  text "Stuck"\n')).toEqual(['no-return']);
    expect(codes('call screen map', 'screen map:\n  button "Go" -> return y\n')).toEqual(['unknown-variable']);
    expect(codes('hide screen')).toEqual(['bad-hide']);
  });
});

describe('going back to a line or a choice', () => {
  const SRC2 = `label start:
  "One."
  menu:
    "Left":
      "Two."
    "Right":
      "Two."
  "Three."
  menu:
    "Up":
      "Four."
  "Five."
`;
  it('rewind to a line of the log, and back to the last choice', () => {
    const run = new Runner(compile(SRC2).story!);
    run.start();
    run.advance();          // the first menu
    run.choose(0);          // Two.
    run.advance();          // Three.
    expect(run.log.map((b) => b.text)).toEqual(['One.', 'Two.', 'Three.']);
    expect(run.rewindTo(0)!.block).toMatchObject({ text: 'One.' });
    expect(run.log.map((b) => b.text)).toEqual(['One.']);
    expect(run.rewindTo(0)).toBeNull(); // already there
    run.advance();
    run.choose(1);
    run.advance();
    run.advance();          // the second menu
    expect(run.canGoBackToChoice).toBe(true);
    expect(run.backToChoice()!.block).toMatchObject({ type: 'menu', choices: [{ text: 'Left' }, { text: 'Right' }] });
    expect(run.canGoBackToChoice).toBe(false);
  });
});

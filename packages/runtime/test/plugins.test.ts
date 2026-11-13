import { describe, expect, it } from 'vitest';
import { compile, parse, parseManifest, print, type PluginManifest } from '@emaki/format';
import { Runner } from '../src/index.ts';

const weather = parseManifest({
  commands: {
    start: { args: { kind: ['snow', 'rain'], amount: 'number?' }, lasting: 'sky' },
    stop: { lasting: 'sky', ends: true },
  },
}, 'weather').manifest!;
const cards = parseManifest({ commands: { play: { args: { pairs: 'number?' }, waits: true } }, elements: { score: { args: { value: 'number' } } } }, 'cards').manifest!;
const plugins: Record<string, PluginManifest> = { weather, cards };

const SRC = `var turns = 0
var heavy = 300

screen hud:
  @cards score value=turns at 3% 3%

label start:
  @weather start kind="snow" amount=40
  "Snow."
  @cards play pairs=4 -> turns
  "{turns} turns."
  @weather start kind="rain" amount=heavy
  "Rain."
  @weather stop
  "Clear."
`;

describe('plugin manifests', () => {
  it('read a plugin.json, and explain what is wrong with one', () => {
    expect(weather.commands!.start).toEqual({ args: { kind: ['snow', 'rain'], amount: 'number?' }, lasting: 'sky' });
    expect(parseManifest({ commands: { x: { args: { n: 'int' } } } }, 'p').errors[0]).toMatch(/should be "number"/);
    expect(parseManifest({ commands: { x: { ends: true } } }, 'p').errors[0]).toMatch(/needs the "lasting"/);
    expect(parseManifest({ commands: { x: { waits: true, lasting: 'a' } } }, 'p').errors[0]).toMatch(/can't also last/);
    expect(parseManifest({}, 'p').errors[0]).toMatch(/no "commands", "elements" or "functions"/);
    expect(parseManifest({ commands: {} }, 'Bad-Name').errors[0]).toMatch(/lowercase/);
  });
});

describe('plugin commands in scripts', () => {
  it('parse, print back and compile against the manifests', () => {
    const p = parse(SRC);
    expect(p.diagnostics).toEqual([]);
    expect(print(p.program)).toBe(SRC);
    const r = compile(SRC, { plugins });
    expect(r.diagnostics).toEqual([]);
    expect(r.story!.code.filter((i) => i.op === 'plugin').map((i) => i.op === 'plugin' && [i.command, i.waits ?? false, i.lasting ?? null, i.ends ?? false]))
      .toEqual([['start', false, 'sky', false], ['play', true, null, false], ['start', false, 'sky', false], ['stop', false, 'sky', true]]);
    expect(r.story!.screens!.hud!.items[0]).toMatchObject({ kind: 'plugin', plugin: 'cards', element: 'score' });
  });

  it('explain mistakes', () => {
    const codes = (line: string) => compile(`var n = 0\nlabel start:\n  ${line}\n  "x"\n`, { plugins }).diagnostics.map((d) => d.code);
    expect(codes('@snow start')).toEqual(['unknown-plugin']);
    expect(codes('@weather begin')).toEqual(['unknown-plugin-command']);
    expect(codes('@weather start kind="hail"')).toEqual(['bad-plugin-arg']);
    expect(codes('@weather start')).toEqual(['bad-plugin-arg']);                    // kind is required
    expect(codes('@weather start kind="snow" speed=2')).toEqual(['bad-plugin-arg']);
    expect(codes('@weather start kind="snow" amount="lots"')).toEqual(['bad-plugin-arg']);
    expect(codes('@weather start kind="snow" amount=lots')).toEqual(['unknown-variable']);
    expect(codes('@weather stop -> n')).toEqual(['bad-plugin']);                    // nothing to wait for
    expect(codes('@cards play -> m')).toEqual(['unknown-variable']);
    expect(codes('@cards')).toEqual(['bad-plugin']);
    expect(codes('@weather start kind="snow" and more')).toEqual(['bad-plugin']);
    // Without the manifests (an editor showing one file), plugin lines aren't checked.
    expect(compile('label start:\n  @anything goes x=1\n  "x"\n').diagnostics).toEqual([]);
  });
});

describe('running plugin commands', () => {
  const story = () => compile(SRC, { plugins }).story!;

  it('pass effects on, keep lasting ones, and wait on the others', () => {
    const run = new Runner(story());
    const first = run.start();
    expect(first.effects).toContainEqual({ type: 'plugin', plugin: 'weather', command: 'start', args: { kind: 'snow', amount: 40 } });
    expect(run.pluginState).toEqual([{ plugin: 'weather', command: 'start', args: { kind: 'snow', amount: 40 } }]);
    const wait = run.advance();
    expect(wait.block).toMatchObject({ type: 'plugin', plugin: 'cards', command: 'play', args: { pairs: 4 } });
    expect(() => run.advance()).toThrow(/must finish/);
    expect(run.resumeFromPlugin(7).block).toMatchObject({ text: '7 turns.' });
    const rain = run.advance();
    expect(rain.effects).toContainEqual({ type: 'plugin', plugin: 'weather', command: 'start', args: { kind: 'rain', amount: 300 } });
    expect(run.pluginState.map((c) => c.args.kind)).toEqual(['rain']);       // the same slot: rain replaced snow
    run.advance();
    expect(run.pluginState).toEqual([]);                                       // stop ended it
    // Going back restores what was lasting then.
    run.back();
    expect(run.pluginState.map((c) => c.args.kind)).toEqual(['rain']);
  });

  it('keep lasting commands in saves and rebuild them for line previews', () => {
    const run = new Runner(story());
    run.start();
    const other = new Runner(story());
    other.load(run.save());
    expect(other.pluginState.map((c) => c.args.kind)).toEqual(['snow']);
    const preview = new Runner(story());
    preview.startAtLine(SRC.split('\n').indexOf('  "Rain."') + 1);
    expect(preview.pluginState.map((c) => c.args.kind)).toEqual(['rain']);
  });
});

describe('plugin functions in expressions', () => {
  const dice = parseManifest({
    functions: {
      roll: { args: { sides: 'number', times: 'number?' }, returns: 'number', description: 'Roll dice' },
      name: { returns: 'string' },
      mood: { args: { of: ['calm', 'storm'] } },
    },
  }, 'dice').manifest!;
  const fns = { ...plugins, dice };
  const SRC2 = `var total = 0

screen hud:
  text "Lucky" at 3% 3% if @dice.roll(6) > 3
  button "Reroll" at 3% 9% -> set total = @dice.roll(6, 2)

label start:
  set total = @dice.roll(6) + @dice.roll(6, 2)
  if @dice.name() == "d6" and total > 2:
    "Rolled {total}."
  else:
    "Low."
  @weather start kind="snow" amount=@dice.roll(10)
  "Snow."
`;

  it('read from plugin.json, with arguments in order', () => {
    expect(dice.functions!.roll).toEqual({ args: { sides: 'number', times: 'number?' }, returns: 'number', description: 'Roll dice' });
    expect(parseManifest({ functions: { f: { args: { a: 'number?', b: 'number' } } } }, 'p').errors[0]).toMatch(/go last/);
    expect(parseManifest({ functions: { f: { returns: 'list' } } }, 'p').errors[0]).toMatch(/"returns"/);
  });

  it('parse, print back and compile against the manifests', () => {
    const p = parse(SRC2);
    expect(p.diagnostics).toEqual([]);
    expect(print(p.program)).toBe(SRC2);
    expect(compile(SRC2, { plugins: fns }).diagnostics).toEqual([]);
  });

  it('explain mistakes', () => {
    const codes = (line: string) => compile(`var n = 0\nlabel start:\n  ${line}\n  "x"\n`, { plugins: fns }).diagnostics.map((d) => d.code);
    expect(codes('set n = @dice.toss(6)')).toEqual(['unknown-plugin-function']);
    expect(codes('set n = @coin.toss()')).toEqual(['unknown-plugin']);
    expect(codes('set n = @dice.roll()')).toEqual(['bad-plugin-arg']);
    expect(codes('set n = @dice.roll(1, 2, 3)')).toEqual(['bad-plugin-arg']);
    expect(codes('set n = @dice.roll("six")')).toEqual(['bad-plugin-arg']);
    expect(codes('if @dice.mood("rain") == 1:\n    "y"')).toEqual(['bad-plugin-arg']);
    expect(codes('set n = @dice.roll(m)')).toEqual(['unknown-variable']);
    expect(codes('set n = @dice')).toEqual(['bad-expression']);
    expect(compile('var n = @dice.roll(6)\nlabel start:\n  "x"\n', { plugins: fns }).diagnostics[0]!.message).toMatch(/can't call a plugin/);
    // Without the manifests (an editor showing one file), calls aren't checked.
    expect(compile('var n = 0\nlabel start:\n  set n = @any.thing(1)\n  "x"\n').diagnostics).toEqual([]);
  });

  it('are answered by whoever runs the plugins', () => {
    const story = compile(SRC2, { plugins: fns }).story!;
    const calls: string[] = [];
    const run = new Runner(story);
    run.callPlugin = (plugin, fn, args) => {
      calls.push(`${plugin}.${fn}(${args.join(',')})`);
      return fn === 'name' ? 'd6' : fn === 'roll' ? (args[1] === 2 ? 7 : 3) : 0;
    };
    expect(run.start().block).toMatchObject({ text: 'Rolled 10.' });
    expect(calls).toEqual(['dice.roll(6)', 'dice.roll(6,2)', 'dice.name()']);
    expect(run.advance().effects).toContainEqual({ type: 'plugin', plugin: 'weather', command: 'start', args: { kind: 'snow', amount: 3 } });
  });

  it('stop the story with a clear message when nobody answers or the answer is wrong', () => {
    const story = compile(SRC2, { plugins: fns }).story!;
    expect(() => new Runner(story).start()).toThrow(/@dice.roll\(\.\.\.\) can't be used here/);
    const bad = new Runner(story);
    bad.callPlugin = () => ({}) as never;
    expect(() => bad.start()).toThrow(/should give a number, text or true\/false/);
    const broken = new Runner(story);
    broken.callPlugin = () => { throw new Error('no dice'); };
    expect(() => broken.start()).toThrow(/@dice.roll failed: no dice/);
  });
});

describe('a game folder with plugins', () => {
  it('reads plugins/*/plugin.json and checks the script against them', async () => {
    const { compileGame } = await import('@emaki/format/files');
    const { fileURLToPath } = await import('node:url');
    const r = compileGame(fileURLToPath(new URL('../../../games/plugin-demo', import.meta.url)));
    expect(r.diagnostics).toEqual([]);
    expect(Object.keys(r.plugins).sort()).toEqual(['memory', 'meter', 'weather']);
  });
});

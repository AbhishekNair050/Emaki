/**
 * Routes to the endings (D-065): plays the story with the real runner, trying
 * every choice, and keeps the first way it finds to each ending, with the
 * choices made and the variables as each scene began.
 *
 * Choice points already reached in the same state (same place, variables and
 * call stack) aren't explored twice, so the search covers what a player can
 * actually do rather than every order of doing it. It stops after a time
 * budget; `complete` says whether every possibility was tried. Editors run it
 * in a worker so a long story never holds up typing.
 */
import type { CompiledStory, Value } from '@emaki/format';
import { Runner, type Block, type Step } from './runner.ts';

export interface RouteChoice {
  /** The scene the choice is in, and the line of its `menu:`. */
  label: string;
  line: number;
  file?: string;
  text: string;
}

export interface RouteScene {
  label: string;
  /** The scene's first line that shows something (dialogue or a choice). */
  line: number;
  file?: string;
  /** The story's variables when that line showed. */
  vars: Record<string, Value>;
  /** How many of the route's choices had been made when the scene began (its own come after). */
  choicesBefore: number;
}

export interface Route {
  /** The ending's id (`end light_holds`), or else the scene the story ended in. */
  ending: string;
  /** Its name when it is a declared ending. */
  name?: string;
  choices: RouteChoice[];
  scenes: RouteScene[];
}

export interface RouteSearch {
  routes: Route[];
  /** Every possibility was tried (the budget didn't run out). */
  complete: boolean;
  /** Choice points explored. */
  states: number;
  ms: number;
}

export interface RouteOptions {
  /** Stop after this long (default 3 s). */
  budgetMs?: number;
  /** Values for `global var`s (what earlier playthroughs unlocked). */
  globals?: Record<string, Value>;
  now?: () => number;
}

/** Lines one path may show without reaching a choice or an ending before it counts as stuck in a loop. */
const MAX_BLOCKS = 200_000;

export function findRoutes(story: CompiledStory, opts: RouteOptions = {}): RouteSearch {
  const now = opts.now ?? (() => Date.now());
  const budget = opts.budgetMs ?? 3000;
  const t0 = now();
  const runner = new Runner(story);
  if (opts.globals) runner.setGlobals(opts.globals);
  const routes = new Map<string, Route>();
  const seen = new Set<string>();
  const choices: RouteChoice[] = [];
  const scenes: RouteScene[] = [];
  let outOfTime = false;

  const enter = (b: Block) => {
    if (b.type === 'end' || !('label' in b)) return;
    if (scenes.at(-1)?.label === b.label) return;
    scenes.push({ label: b.label, line: b.line, ...(b.file ? { file: b.file } : {}), vars: { ...runner.vars }, choicesBefore: choices.length });
  };

  const explore = (first: Step): void => {
    let step = first;
    for (let n = 0; ; n++) {
      const b = step.block;
      if (b.type === 'end') {
        const declared = step.effects.find((e) => e.type === 'ending');
        const ending = declared?.type === 'ending' ? declared.id : scenes.at(-1)?.label ?? '(start)';
        if (!routes.has(ending)) {
          routes.set(ending, {
            ending,
            ...(declared?.type === 'ending' && declared.name ? { name: declared.name } : {}),
            choices: choices.map((c) => ({ ...c })),
            scenes: scenes.map((s) => ({ ...s, vars: { ...s.vars } })),
          });
        }
        return;
      }
      enter(b);
      if (b.type === 'menu') break;
      // A screen or a plugin decides what happens next: the search can't play it.
      if (b.type === 'screen' || b.type === 'plugin' || n > MAX_BLOCKS) return;
      if ((n & 1023) === 1023 && now() - t0 > budget) { outOfTime = true; return; }
      step = runner.advance();
    }
    const menu = step.block as Extract<Block, { type: 'menu' }>;
    const saved = runner.save();
    const key = JSON.stringify([saved.state.pc, saved.state.vars, saved.state.stack]);
    if (seen.has(key)) return;
    seen.add(key);
    if (now() - t0 > budget) { outOfTime = true; return; }
    const depth = scenes.length;
    for (const c of menu.choices) {
      runner.load(saved);
      scenes.length = depth;
      choices.push({ label: menu.label, line: menu.line, ...(menu.file ? { file: menu.file } : {}), text: c.text });
      try {
        explore(runner.choose(c.index));
      } catch {
        // A condition that needs a plugin, or a story error on this path: try the other choices.
      }
      choices.pop();
      if (outOfTime) return;
    }
  };

  try {
    explore(runner.start());
  } catch {
    // The story can't start (or fails before its first choice): no routes.
  }
  return { routes: [...routes.values()], complete: !outOfTime, states: seen.size, ms: Math.round(now() - t0) };
}

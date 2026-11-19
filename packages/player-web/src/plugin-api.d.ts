/**
 * Emaki plugin API: what a game's plugin (plugins/<name>/index.js) gets from
 * the player and gives back. See docs/plugins.md.
 *
 * This file stands alone (no imports), so `emaki plugin` can copy it into a
 * game as plugins/emaki-plugin.d.ts. In a plugin written in JavaScript:
 *
 *   /** @type {import('../emaki-plugin').PluginSetup} *\/
 *   export default function petals(ctx) { ... }
 *
 * or in TypeScript (index.ts, with "main": "index.ts" in plugin.json):
 *
 *   import type { PluginSetup } from '../emaki-plugin';
 *   const petals: PluginSetup = (ctx) => ({ ... });
 *   export default petals;
 */

/** A story value: what variables hold and arguments are. */
export type Value = number | string | boolean;

/**
 * A command's or element's arguments, by name, worked out from the story.
 * Each is a number, text or true/false, of the type plugin.json gives it: the
 * compiler has checked every use, so a TypeScript plugin can name its own
 * argument types (`play(args: { pairs?: number })`). Left out: undefined.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PluginArgs = Readonly<Record<string, any>>;

/** Data kept as JSON: what `ctx.storage` holds. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * The plugin's own data on this device, kept across playthroughs and saves:
 * best scores, unlocked levels, options. Not part of a saved game and not
 * undone by going back (use story variables, through `ctx.set`, for that).
 */
export interface PluginStorage {
  /** The value kept under `key`, or `undefined`. */
  get<T extends Json = Json>(key: string): T | undefined;
  /** Keep `value` under `key` (a copy: change it later and set it again). */
  set(key: string, value: Json): void;
  remove(key: string): void;
  /** Every key kept. */
  keys(): string[];
}

/** What a plugin can use. */
export interface PluginContext {
  /** The plugin's name (its folder). */
  readonly name: string;
  /** The plugin's own layer: over the characters, under the text box; clicks go through it. */
  readonly layer: HTMLElement;
  /** The whole stage (for its size: `stage.clientWidth`). */
  readonly stage: HTMLElement;
  /** URL of a file in the game's assets/ (the player's language's version, when there is one). */
  asset(path: string): string;
  /** The story's variables, read-only. */
  vars(): Readonly<Record<string, Value>>;
  /**
   * Change a story variable that plugin.json lists in "sets" (to a value of
   * the type it started with). The change is part of the story from here on:
   * saves keep it, and going back before this point undoes it. Screens
   * showing the variable redraw. Throws for a variable not in "sets" or a
   * value of the wrong type; ignored (with a warning) while a lasting command
   * is redone (`run.restoring`), in a function and while drawing an element,
   * since those must not change the story.
   */
  set(name: string, value: Value): void;
  /** The plugin's own data on this device (see PluginStorage). */
  readonly storage: PluginStorage;
  /** True when the player asked for less motion: keep effects still or subtle. */
  readonly reducedMotion: boolean;
  /** The volume a channel plays at now (master volume and mutes included), 0..1. */
  volume(channel: 'music' | 'sound' | 'voice'): number;
  /** Play a sound from assets/ at the sound effects volume. */
  playSound(path: string): void;
  /** The language the game is shown in (null: the one it's written in). */
  readonly language: string | null;
  /**
   * A full-screen area over the story that takes clicks, for a command the
   * story waits on (a minigame). Close it when done; the player also closes
   * it if the player goes back or loads.
   */
  modal(): { root: HTMLElement; close(): void };
}

/** How a command is being run. */
export interface CommandRun {
  /** Draw the end state straight away: skipping, or redoing a lasting command. */
  instant: boolean;
  /** Redoing a lasting command after a load, going back or a line preview. */
  restoring: boolean;
}

export interface Plugin {
  /**
   * The plugin's commands by name. A command the story waits on returns a
   * promise; what it resolves to goes into the `-> variable`.
   */
  commands?: Record<string, (args: PluginArgs, run: CommandRun) => void | Value | Promise<Value | void>>;
  /** Elements for screens (`@clock face` in a screen): return what to place. */
  elements?: Record<string, (args: PluginArgs) => HTMLElement>;
  /**
   * Functions for expressions (`if @dice.roll(6) > 4`): given the arguments in
   * order, return a number, text or true/false straight away.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- checked against plugin.json by the compiler, like PluginArgs
  functions?: Record<string, (...args: any[]) => Value>;
  /** Things happening in the game. */
  on?: {
    start?(): void;
    title?(): void;
    line?(line: { id: string; speaker: string | null; text: string; label: string }): void;
    choice?(choice: { id: string; text: string }): void;
    ending?(ending: { id: string; name: string }): void;
    achievement?(achievement: { id: string; name: string }): void;
    save?(): void;
    load?(): void;
  };
  /** Forget every lasting effect (a new game, a load, going back); lasting commands are then run again. */
  reset?(): void;
  /** The player is going away. */
  destroy?(): void;
}

/** A plugin's code: its default export. */
export type PluginSetup = (ctx: PluginContext) => Plugin;

/**
 * The plugin API: what a game's plugin code (plugins/<name>/index.js) gets
 * from the player and gives back. See docs/plugins.md.
 *
 *   export default function petals(ctx) {
 *     return {
 *       commands: {
 *         on(args, how) { ... draw into ctx.layer ... },
 *         off() { ctx.layer.replaceChildren(); },
 *       },
 *       reset() { ctx.layer.replaceChildren(); },
 *     };
 *   }
 *
 * The manager below is the player's side: it gives each plugin its layer and
 * context, runs commands, draws elements, passes events on, and keeps a broken
 * plugin from breaking the story (errors are logged, and a command the story
 * waits on that fails lets the story go on).
 */
import type { Value } from '@emaki/format';
import type { PluginCommand } from '@emaki/runtime';

export type PluginArgs = Readonly<Record<string, Value>>;

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

/** What the player gives the manager. */
export interface PluginEnvironment {
  stage: HTMLElement;
  /** Where plugin layers go (before this element: over the characters, under the text box). */
  before: HTMLElement;
  /** Where modals go (over everything but the quick menu and menus). */
  modalParent: HTMLElement;
  asset(path: string): string;
  vars(): Readonly<Record<string, Value>>;
  reducedMotion(): boolean;
  volume(channel: 'music' | 'sound' | 'voice'): number;
  playSound(path: string): void;
  language(): string | null;
}

type EventName = keyof NonNullable<Plugin['on']>;

export class PluginManager {
  private readonly loaded = new Map<string, Plugin>();
  private readonly modals = new Set<HTMLElement>();

  constructor(setups: Readonly<Record<string, PluginSetup>>, env: PluginEnvironment) {
    for (const [name, setup] of Object.entries(setups)) {
      const layer = document.createElement('div');
      layer.className = `layer plugin-layer plugin-${name}`;
      env.stage.insertBefore(layer, env.before);
      const modals = this.modals;
      const ctx: PluginContext = {
        name, layer, stage: env.stage,
        asset: env.asset, vars: env.vars, volume: env.volume, playSound: env.playSound,
        get reducedMotion() { return env.reducedMotion(); },
        get language() { return env.language(); },
        modal() {
          const root = document.createElement('div');
          root.className = `plugin-modal plugin-${name}`;
          env.modalParent.append(root);
          modals.add(root);
          return { root, close: () => { root.remove(); modals.delete(root); } };
        },
      };
      try {
        const plugin = typeof setup === 'function' ? setup(ctx) : null;
        if (plugin && typeof plugin === 'object') this.loaded.set(name, plugin);
        else console.error(`Plugin '${name}': its default export should be a function returning the plugin`);
      } catch (err) {
        console.error(`Plugin '${name}' failed to start`, err);
      }
    }
  }

  get names(): string[] {
    return [...this.loaded.keys()];
  }

  /** Run a command; a promise when the plugin returns one (the story waits on it). */
  run(c: PluginCommand, how: CommandRun): Promise<Value | void> | Value | void {
    const fn = this.loaded.get(c.plugin)?.commands?.[c.command];
    if (!fn) { console.error(`Plugin '${c.plugin}' has no command '${c.command}'`); return; }
    try {
      const r = fn(c.args, how);
      if (r instanceof Promise) return r.catch((err) => { console.error(`@${c.plugin} ${c.command} failed`, err); });
      return r as Value | void;
    } catch (err) {
      console.error(`@${c.plugin} ${c.command} failed`, err);
    }
  }

  /** A screen element from a plugin, or null (logged) when it can't make one. */
  element(plugin: string, element: string, args: PluginArgs): HTMLElement | null {
    const fn = this.loaded.get(plugin)?.elements?.[element];
    if (!fn) { console.error(`Plugin '${plugin}' has no element '${element}'`); return null; }
    try {
      const node = fn(args);
      return node instanceof HTMLElement ? node : null;
    } catch (err) {
      console.error(`@${plugin} ${element} failed`, err);
      return null;
    }
  }

  /** Tell every plugin something happened. */
  emit<E extends EventName>(event: E, ...arg: Parameters<NonNullable<NonNullable<Plugin['on']>[E]>>): void {
    for (const [name, p] of this.loaded) {
      const fn = p.on?.[event] as ((...a: unknown[]) => void) | undefined;
      if (!fn) continue;
      try { fn(...arg); } catch (err) { console.error(`Plugin '${name}' (${event})`, err); }
    }
  }

  /**
   * Back to a known state: close modals, let every plugin forget its lasting
   * effects, then redo the ones the story says are on.
   */
  restore(lasting: PluginCommand[]): void {
    for (const m of this.modals) m.remove();
    this.modals.clear();
    for (const [name, p] of this.loaded) {
      try { p.reset?.(); } catch (err) { console.error(`Plugin '${name}' (reset)`, err); }
    }
    for (const c of lasting) void this.run(c, { instant: true, restoring: true });
  }

  destroy(): void {
    for (const [name, p] of this.loaded) {
      try { p.destroy?.(); } catch (err) { console.error(`Plugin '${name}' (destroy)`, err); }
    }
  }
}

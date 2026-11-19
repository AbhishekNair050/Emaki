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
import type { CommandRun, Json, Plugin, PluginArgs, PluginContext, PluginSetup, PluginStorage } from './plugin-api.d.ts';

// The API itself is in plugin-api.d.ts, which stands alone so games can have a copy (`emaki plugin`).
export type { CommandRun, Json, Plugin, PluginArgs, PluginContext, PluginSetup, PluginStorage };

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
  /** Change a story variable (already checked against the plugin's "sets"). */
  set(name: string, value: Value): void;
  /** The variables each plugin may change (the story's `pluginSets`). */
  sets: Readonly<Record<string, readonly string[]>>;
  /** Read and write the device's storage for a key (null: nothing kept). */
  load(key: string): string | null;
  save(key: string, value: string): void;
}

type EventName = keyof NonNullable<Plugin['on']>;

export class PluginManager {
  private readonly loaded = new Map<string, Plugin>();
  private readonly modals = new Set<HTMLElement>();
  /** What's running that mustn't change the story (redoing lasting commands, a function, drawing an element). */
  private quiet: string | null = null;

  constructor(setups: Readonly<Record<string, PluginSetup>>, env: PluginEnvironment) {
    for (const [name, setup] of Object.entries(setups)) {
      const layer = document.createElement('div');
      layer.className = `layer plugin-layer plugin-${name}`;
      env.stage.insertBefore(layer, env.before);
      const modals = this.modals;
      const sets = new Set(env.sets[name] ?? []);
      const ctx: PluginContext = {
        name, layer, stage: env.stage,
        asset: env.asset, vars: env.vars, volume: env.volume, playSound: env.playSound,
        set: (v, value) => {
          if (!sets.has(v)) {
            throw new Error(`Plugin '${name}' can't set '${v}': list it in plugin.json, "sets": [${[...sets, v].map((x) => JSON.stringify(x)).join(', ')}]`);
          }
          const was = env.vars()[v];
          if (typeof value !== typeof was || (typeof value === 'number' && !Number.isFinite(value))) {
            throw new Error(`Plugin '${name}' set '${v}' to ${JSON.stringify(value)}, but it holds ${typeof was === 'string' ? 'text' : `a ${typeof was}`}`);
          }
          if (this.quiet) { console.warn(`Plugin '${name}' set '${v}' ${this.quiet}; ignored, as that mustn't change the story`); return; }
          env.set(v, value);
        },
        storage: pluginStorage(`plugin:${name}`, env),
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
      const node = this.quietly(`while drawing @${plugin} ${element}`, () => fn(args));
      return node instanceof HTMLElement ? node : null;
    } catch (err) {
      console.error(`@${plugin} ${element} failed`, err);
      return null;
    }
  }

  /** Call a plugin function from an expression; throws (with a reason) when it can't answer. */
  call(plugin: string, fn: string, args: Value[]): Value {
    const p = this.loaded.get(plugin);
    if (!p) throw new Error(`plugin '${plugin}' isn't loaded`);
    const f = p.functions?.[fn];
    if (typeof f !== 'function') throw new Error(`plugin '${plugin}' has no function '${fn}'`);
    return this.quietly(`in @${plugin}.${fn}()`, () => f(...args));
  }

  /** Run `fn` with ctx.set turned off, saying why. */
  private quietly<T>(why: string, fn: () => T): T {
    const was = this.quiet;
    this.quiet = was ?? why;
    try { return fn(); } finally { this.quiet = was; }
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
    for (const c of lasting) this.quietly(`while @${c.plugin} ${c.command} was redone`, () => void this.run(c, { instant: true, restoring: true }));
  }

  destroy(): void {
    for (const [name, p] of this.loaded) {
      try { p.destroy?.(); } catch (err) { console.error(`Plugin '${name}' (destroy)`, err); }
    }
  }
}

/**
 * A plugin's own data: one JSON object under `key` in the device's storage,
 * read once and written whenever it changes.
 */
function pluginStorage(key: string, env: Pick<PluginEnvironment, 'load' | 'save'>): PluginStorage {
  let data: Record<string, Json> | null = null;
  const all = (): Record<string, Json> => {
    if (data) return data;
    try {
      const raw = JSON.parse(env.load(key) ?? '{}') as unknown;
      data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, Json> : {};
    } catch { data = {}; }
    return data;
  };
  const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)) as T);
  return {
    get: <T extends Json = Json>(k: string) => copy(Object.prototype.hasOwnProperty.call(all(), k) ? all()[k] as T : undefined),
    set(k, value) {
      const text = JSON.stringify(value);
      if (text === undefined) throw new Error(`storage.set('${k}'): the value can't be kept as JSON`);
      all()[k] = JSON.parse(text) as Json;
      env.save(key, JSON.stringify(all()));
    },
    remove(k) {
      if (!Object.prototype.hasOwnProperty.call(all(), k)) return;
      delete all()[k];
      env.save(key, JSON.stringify(all()));
    },
    keys: () => Object.keys(all()),
  };
}

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Value } from '@emaki/format';
import { PluginManager, type PluginContext, type PluginSetup } from '../src/plugins.ts';

// Just enough of a DOM for the manager: elements that can be added and removed.
class FakeElement {
  className = '';
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  append(...nodes: FakeElement[]) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  insertBefore(n: FakeElement) { this.append(n); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  replaceChildren() { this.children = []; }
}
const g = globalThis as { document?: unknown; HTMLElement?: unknown };
const real = { document: g.document, HTMLElement: g.HTMLElement };
beforeAll(() => { g.document = { createElement: () => new FakeElement() }; g.HTMLElement = FakeElement; });
afterAll(() => { g.document = real.document; g.HTMLElement = real.HTMLElement; });

function setup(plugins: Record<string, PluginSetup>, sets: Record<string, string[]> = {}, store = new Map<string, string>()) {
  const vars: Record<string, Value> = { hp: 10, name: 'Ava', locked: 0 };
  const changes: [string, Value][] = [];
  const stage = new FakeElement() as unknown as HTMLElement;
  const manager = new PluginManager(plugins, {
    stage, before: stage, modalParent: stage,
    asset: (p) => p, vars: () => vars, reducedMotion: () => false, volume: () => 1, playSound: () => {}, language: () => null,
    set: (n, v) => { vars[n] = v; changes.push([n, v]); },
    sets, load: (k) => store.get(k) ?? null, save: (k, v) => { store.set(k, v); },
  });
  return { manager, vars, changes, store };
}

describe('plugins changing story variables (ctx.set)', () => {
  it('change only what plugin.json lists, to values of the same type', () => {
    let ctx!: PluginContext;
    const { manager, changes } = setup({
      battle: (c) => { ctx = c; return { commands: { hit: (a) => ctx.set('hp', (ctx.vars().hp as number) - (a.by as number)) } }; },
    }, { battle: ['hp', 'name'] });
    void manager.run({ plugin: 'battle', command: 'hit', args: { by: 3 } }, { instant: false, restoring: false });
    expect(changes).toEqual([['hp', 7]]);
    expect(() => ctx.set('locked', 1)).toThrow(/"sets": \["hp", "name", "locked"\]/);
    expect(() => ctx.set('hp', 'lots')).toThrow(/holds a number/);
    expect(() => ctx.set('name', 2)).toThrow(/holds text/);
    expect(() => ctx.set('hp', NaN)).toThrow();
    expect(changes).toHaveLength(1);
  });

  it('are ignored while the story is being rebuilt, asked a question, or drawn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let ctx!: PluginContext;
    const { manager, changes } = setup({
      battle: (c) => {
        ctx = c;
        return {
          commands: { poison: () => ctx.set('hp', 1) },
          functions: { peek: () => { ctx.set('hp', 2); return 1; } },
          elements: { bar: () => { ctx.set('hp', 3); return new FakeElement() as unknown as HTMLElement; } },
        };
      },
    }, { battle: ['hp'] });
    manager.restore([{ plugin: 'battle', command: 'poison', args: {} }]);
    expect(manager.call('battle', 'peek', [])).toBe(1);
    manager.element('battle', 'bar', {});
    expect(changes).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringMatching(/while @battle poison was redone/),
      expect.stringMatching(/in @battle\.peek\(\)/),
      expect.stringMatching(/while drawing @battle bar/),
    ]);
    // Afterwards it works again.
    void manager.run({ plugin: 'battle', command: 'poison', args: {} }, { instant: false, restoring: false });
    expect(changes).toEqual([['hp', 1]]);
    warn.mockRestore();
  });
});

describe('a plugin’s own data (ctx.storage)', () => {
  it('keeps JSON on the device, per plugin, across sessions', () => {
    const store = new Map<string, string>();
    let a!: PluginContext;
    let b!: PluginContext;
    setup({ memory: (c) => { a = c; return {}; }, cards: (c) => { b = c; return {}; } }, {}, store);
    expect(a.storage.get('best')).toBeUndefined();
    a.storage.set('best', 12);
    a.storage.set('unlocked', { levels: [1, 2] });
    b.storage.set('best', 99);
    const copy = a.storage.get<{ levels: number[] }>('unlocked')!;
    copy.levels.push(3); // a copy: changing it changes nothing kept
    expect(a.storage.get('unlocked')).toEqual({ levels: [1, 2] });
    expect(() => a.storage.set('f', (() => 1) as unknown as number)).toThrow(/JSON/);
    a.storage.remove('unlocked');
    expect([...store.keys()].sort()).toEqual(['plugin:cards', 'plugin:memory']);
    // The next session reads it back.
    let again!: PluginContext;
    setup({ memory: (c) => { again = c; return {}; } }, {}, store);
    expect(again.storage.get('best')).toBe(12);
    expect(again.storage.keys()).toEqual(['best']);
  });

  it('starts over when what was kept is unreadable', () => {
    let ctx!: PluginContext;
    setup({ memory: (c) => { ctx = c; return {}; } }, {}, new Map([['plugin:memory', '{oops']]));
    expect(ctx.storage.keys()).toEqual([]);
  });
});

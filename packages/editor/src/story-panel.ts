/**
 * The Story workspace's panel (D-065): the scene the cursor is in (how long it
 * is, how much a playtest has read, where it comes from and leads to), and
 * the story's endings with a route to each, found by playing the story in a
 * worker. Picking an ending highlights its route on the flowchart; each scene
 * on it can be played with the variables the route gives it.
 */
import type { CompiledStory, StoryGraph, Value } from '@emaki/format';
import type { Route, RouteSearch } from '@emaki/runtime';

export interface SceneStats {
  /** Lines of dialogue and narration. */
  lines: number;
  /** Menus. */
  choices: number;
  words: number;
  /** The ids of those lines, to see which a playtest has read. */
  ids: string[];
}

/** Words and lines of each scene, from the compiled story. */
export function sceneStats(story: CompiledStory): Map<string, SceneStats> {
  const out = new Map<string, SceneStats>();
  for (const ins of story.code) {
    if (ins.op !== 'say' && ins.op !== 'menu') continue;
    let s = out.get(ins.src.label);
    if (!s) out.set(ins.src.label, s = { lines: 0, choices: 0, words: 0, ids: [] });
    if (ins.op === 'menu') { s.choices++; continue; }
    s.lines++;
    s.words += countWords(ins.text);
    s.ids.push(ins.id);
  }
  return out;
}

function countWords(text: string): number {
  // Markup (`[w]`, `{name}`, `*`) isn't read out; CJK text has no spaces, so count its characters as words.
  const plain = text.replace(/\[[^\]]*\]/g, ' ').replace(/[*_]/g, '');
  const cjk = plain.match(/[぀-ヿ㐀-鿿가-힯]/g)?.length ?? 0;
  const words = plain.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ').split(/\s+/).filter(Boolean).length;
  return words + cjk;
}

export interface StoryPanelHooks {
  reveal(label: string): void;
  /** Play from a line with these variables. */
  play(line: number, vars: Record<string, Value>, file?: string): void;
  /** Highlight a route on the flowchart (its scenes in order), or none. */
  showRoute(scenes: string[] | null): void;
  /** Search for routes again. */
  search(): void;
}

export interface SceneInfo {
  label: string;
  stats: SceneStats | undefined;
  /** Share of its lines read in playtests, 0 to 1. */
  read: number | null;
  choices: number;
  from: string[];
  to: string[];
}

export class StoryPanel {
  private readonly root: HTMLElement;
  private readonly scene: HTMLElement;
  private readonly status: HTMLElement;
  private readonly endings: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly hooks: StoryPanelHooks;
  private result: RouteSearch | null = null;
  private allEndings: string[] = [];
  private names: Record<string, string> = {};
  private initial: Record<string, Value> = {};
  private selected: string | null = null;
  private searching = false;

  constructor(parent: HTMLElement, hooks: StoryPanelHooks) {
    this.hooks = hooks;
    this.root = el('section', 'story-panel');
    this.root.setAttribute('aria-label', 'Scene and routes');
    this.scene = el('div', 'story-scene');
    const head = el('h2', 'pane-head');
    head.append('Endings');
    this.status = el('p', 'story-status');
    this.status.setAttribute('role', 'status');
    const again = button('story-again', () => this.hooks.search(), 'Search again');
    again.title = 'Play the story again, trying every choice';
    head.append(again);
    this.endings = el('div', 'story-endings');
    this.endings.setAttribute('role', 'listbox');
    this.endings.setAttribute('aria-label', 'Endings');
    this.detail = el('div', 'story-route');
    const sceneHead = el('h2', 'pane-head', 'Scene');
    this.root.append(sceneHead, this.scene, head, this.status, this.endings, this.detail);
    parent.append(this.root);
  }

  /** The scene the cursor is in. */
  setScene(info: SceneInfo | null): void {
    if (!info) {
      this.scene.replaceChildren(el('p', 'story-empty', 'Put the cursor in a scene to see it here.'));
      return;
    }
    const name = button('story-name', () => this.hooks.reveal(info.label), info.label);
    name.title = 'Show it in the script';
    const facts = el('div', 'story-facts');
    const s = info.stats;
    const fact = (value: string, label: string) => {
      const f = el('span', 'story-fact');
      f.append(el('b', '', value), ` ${label}`);
      return f;
    };
    facts.append(
      fact(String(s?.lines ?? 0), (s?.lines ?? 0) === 1 ? 'line' : 'lines'),
      fact(String(s?.words ?? 0), 'words'),
      fact(String(info.choices), info.choices === 1 ? 'choice' : 'choices'),
    );
    if (info.read !== null) facts.append(fact(`${Math.round(info.read * 100)}%`, 'read'));
    const links = el('div', 'story-links');
    const list = (title: string, labels: string[]) => {
      const row = el('div', 'story-link-row');
      row.append(el('span', 'story-link-title', title));
      if (!labels.length) row.append(el('span', 'story-none', title === 'From' ? 'the start' : 'the end'));
      for (const l of labels) row.append(button('story-chip', () => this.hooks.reveal(l), l));
      return row;
    };
    links.append(list('From', info.from), list('To', info.to));
    this.scene.replaceChildren(name, facts, links);
  }

  /** A new story was compiled: what its endings are and how variables start. */
  setStory(story: CompiledStory, graph: StoryGraph): void {
    const declared = Object.keys(story.endings ?? {});
    this.names = Object.fromEntries(Object.entries(story.endings ?? {}).map(([id, e]) => [id, e.name]));
    // Declared endings, or else the scenes that end the story.
    this.allEndings = declared.length ? declared : graph.nodes.filter((n) => n.ending).map((n) => n.label);
    this.initial = story.vars;
  }

  setSearching(): void {
    this.searching = true;
    this.status.textContent = 'searching…';
  }

  setRoutes(result: RouteSearch): void {
    this.searching = false;
    this.result = result;
    if (this.selected && !result.routes.some((r) => r.ending === this.selected)) this.select(null);
    this.render();
  }

  private render(): void {
    const r = this.result;
    if (!r) return;
    const found = new Map(r.routes.map((x) => [x.ending, x]));
    const ids = [...new Set([...this.allEndings, ...found.keys()])];
    const reached = ids.filter((id) => found.has(id)).length;
    this.status.textContent = this.searching ? 'searching…'
      : `${reached} of ${ids.length} reached${r.complete ? '' : ' so far (search stopped after its time)'} · ${r.states} choice ${r.states === 1 ? 'point' : 'points'} in ${r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s`}`;
    this.endings.replaceChildren(...ids.map((id) => {
      const route = found.get(id);
      const b = button(`story-ending${route ? '' : ' missing'}`, () => this.select(this.selected === id ? null : id));
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(this.selected === id));
      b.disabled = !route;
      b.append(el('span', 'story-ending-name', this.names[id] ?? id));
      b.append(el('span', 'story-ending-meta', route ? `${route.choices.length} ${route.choices.length === 1 ? 'choice' : 'choices'}` : r.complete ? 'never reached' : 'not found yet'));
      return b;
    }));
    this.renderRoute(this.selected ? found.get(this.selected) ?? null : null);
  }

  private select(id: string | null): void {
    this.selected = id;
    const route = id ? this.result?.routes.find((r) => r.ending === id) ?? null : null;
    this.hooks.showRoute(route ? route.scenes.map((s) => s.label) : null);
    this.render();
  }

  /** The route's scenes in order, the choice made in each, and the variables that differ from their start. */
  private renderRoute(route: Route | null): void {
    if (!route) {
      this.detail.replaceChildren(el('p', 'story-empty', this.result?.routes.length ? 'Pick an ending to see the way there.' : ''));
      return;
    }
    const steps = el('ol', 'story-steps');
    route.scenes.forEach((s, i) => {
      const li = el('li', 'story-step');
      const top = el('div', 'story-step-top');
      top.append(button('story-name', () => this.hooks.reveal(s.label), s.label));
      const play = button('story-play', () => this.hooks.play(s.line, s.vars, s.file), '▶');
      play.title = `Play from here, with the variables this route has (line ${s.line})`;
      play.setAttribute('aria-label', `Play ${s.label} as this route reaches it`);
      top.append(play);
      li.append(top);
      const changed = Object.entries(s.vars).filter(([k, v]) => this.initial[k] !== v);
      if (changed.length) li.append(el('div', 'story-vars', changed.map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(' · ')));
      // The choices made in this scene, before the route moved on.
      const end = route.scenes[i + 1]?.choicesBefore ?? route.choices.length;
      for (const c of route.choices.slice(s.choicesBefore, end)) li.append(el('div', 'story-choice', `“${c.text}”`));
      steps.append(li);
    });
    this.detail.replaceChildren(el('div', 'story-route-title', `The way to ${this.names[route.ending] ?? route.ending}`), steps);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, onClick: () => void, text?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Story map: a dev-only panel beside the game.
 *
 *  - every label as a node in a flowchart, edges for jumps, calls and choices
 *  - the current scene highlighted; scenes not yet visited dimmed
 *  - click (or Enter on) a scene to play from it
 *  - live, editable variables to test other routes ("what if trust were 2?")
 *
 * Only loaded on the dev server; builds never include it.
 */
import type { CompiledStory, StoryGraph, Value } from '@emaki/format';
import type { Block } from '@emaki/runtime';
import { layoutGraph } from './layout.ts';
import './map.css';

export interface StoryMapHooks {
  jumpTo(label: string): void;
  setVar(name: string, value: Value): void;
  getVars(): Readonly<Record<string, Value>>;
}

const SVG = 'http://www.w3.org/2000/svg';
const COLLAPSE_KEY = 'emaki:map-collapsed';
const NAME_MAX = 19;
const EDGE_LABEL_MAX = 30;

export class StoryMap {
  readonly el: HTMLElement;
  private readonly story: CompiledStory;
  private readonly hooks: StoryMapHooks;
  private readonly nodeEls = new Map<string, SVGGElement>();
  private readonly varInputs = new Map<string, HTMLInputElement>();
  private readonly visited = new Set<string>();
  private readonly canvas: HTMLElement;
  private readonly status: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private current: string | null = null;
  private host: HTMLElement | null = null;

  constructor(story: CompiledStory, graph: StoryGraph, hooks: StoryMapHooks) {
    this.story = story;
    this.hooks = hooks;

    this.el = h('aside', 'story-map');
    this.el.setAttribute('aria-label', 'Story map');

    const header = h('header', 'map-header');
    this.toggleBtn = h('button', 'map-toggle') as HTMLButtonElement;
    this.toggleBtn.type = 'button';
    this.toggleBtn.title = 'Show/hide the story map (M)';
    this.toggleBtn.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    header.append(h('h2', '', 'Story map'), this.toggleBtn);

    const body = h('div', 'map-body');
    this.status = h('p', 'map-status', 'On the title screen');
    this.status.setAttribute('aria-live', 'polite');
    this.canvas = h('div', 'map-canvas');
    this.canvas.append(this.renderGraph(graph));
    body.append(
      h('p', 'map-hint', 'Click a scene to play from it. Change variables to test other routes.'),
      this.status,
      this.canvas,
      this.renderLegend(),
      this.renderVars(),
    );
    this.el.append(header, body);

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'm' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.setCollapsed(!this.collapsed);
    });
  }

  /** Attach next to the game. `host` is the element whose layout makes room for the panel. */
  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('with-map');
    host.append(this.el);
    let stored: string | null = null;
    try { stored = localStorage.getItem(COLLAPSE_KEY); } catch { /* storage unavailable */ }
    this.setCollapsed(stored === null ? window.innerWidth < 900 : stored === '1', false);
  }

  /** Called by the player whenever it shows something new. */
  update(block: Block | null): void {
    const label = block && 'label' in block ? block.label : null;
    if (label) this.visited.add(label);
    if (label !== this.current) {
      this.current = label;
      if (label) this.nodeEls.get(label)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    for (const [id, g] of this.nodeEls) {
      g.classList.toggle('current', id === label);
      g.classList.toggle('visited', this.visited.has(id));
    }
    if (!block) this.status.textContent = 'On the title screen';
    else if (block.type === 'end') this.status.textContent = 'The story has ended';
    else this.status.textContent = `In ${label} · story.vn line ${block.line}`;
    this.refreshVars();
  }

  // ------------------------------------------------------------------ rendering

  private renderGraph(graph: StoryGraph): SVGSVGElement {
    const startLabel = Object.entries(this.story.labels).find(([, i]) => i === this.story.start)?.[0] ?? '';
    const layout = layoutGraph(graph.nodes.map((n) => n.label), graph.edges, startLabel, {
      nodeWidth: 150, nodeHeight: 48, colGap: 16, rowGap: 56, margin: 14,
    });
    const info = new Map(graph.nodes.map((n) => [n.label, n]));

    const svg = s('svg', { viewBox: `0 0 ${layout.width} ${layout.height + 14}`, class: 'map-svg', role: 'group' }) as SVGSVGElement;
    svg.style.maxWidth = `${layout.width}px`;
    const defs = s('defs');
    const marker = s('marker', { id: 'map-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    marker.append(s('path', { d: 'M0 0L10 5L0 10z', class: 'map-arrowhead' }));
    defs.append(marker);
    svg.append(defs);

    for (const e of layout.edges) {
      const g = s('g', { class: `map-edge kind-${e.kind}${e.back ? ' back' : ''}` });
      const why = e.via.length ? e.via.join('\n') : e.kind === 'call' ? 'call (returns here)' : 'jump';
      g.append(
        s('title', {}, `${e.from} → ${e.to}\n${why}`),
        s('path', { d: e.path, class: 'hit' }),
        s('path', { d: e.path, class: 'line', 'marker-end': 'url(#map-arrow)' }),
      );
      if (e.via.length) {
        const text = e.via.length > 1 ? `${e.via.length} choices` : truncate(e.via[0], EDGE_LABEL_MAX);
        g.append(s('text', { x: String(e.mid.x), y: String(e.mid.y), class: 'edge-label' }, text));
      }
      svg.append(g);
    }

    for (const n of layout.nodes) {
      const meta = info.get(n.id)!;
      const isStart = n.id === startLabel;
      const cls = ['map-node', meta.ending && 'ending', isStart && 'start', n.unreachable && 'unreachable'].filter(Boolean).join(' ');
      const g = s('g', {
        class: cls,
        transform: `translate(${n.x} ${n.y})`,
        tabindex: '0',
        role: 'button',
        'aria-label': `Play from ${n.id}`,
      }) as SVGGElement;
      const kind = meta.ending ? 'ending' : isStart ? 'start' : 'scene';
      g.append(
        s('title', {}, `${n.id}\n${meta.lines} lines · story.vn line ${meta.line} · ${kind}${n.unreachable ? ' · unreachable' : ''}\nClick to play from here`),
        s('rect', { width: String(n.w), height: String(n.h), rx: meta.ending ? String(n.h / 2) : '8' }),
        s('text', { x: String(n.w / 2), y: '21', class: 'name' }, truncate(n.id, NAME_MAX)),
        s('text', { x: String(n.w / 2), y: '38', class: 'meta' }, `${meta.lines} lines · L${meta.line}`),
      );
      if (isStart) g.append(s('text', { x: String(n.w / 2), y: '-6', class: 'badge' }, 'START'));
      const go = () => {
        // Hand focus back to the game, so the next Enter/Space advances the
        // dialogue instead of re-triggering this node.
        (document.activeElement as HTMLElement | null)?.blur?.();
        this.hooks.jumpTo(n.id);
      };
      g.addEventListener('click', go);
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
      });
      this.nodeEls.set(n.id, g);
      svg.append(g);
    }
    return svg;
  }

  private renderLegend(): HTMLElement {
    const ul = h('ul', 'map-legend');
    const item = (cls: string, text: string) => {
      const li = h('li');
      li.append(h('span', `swatch ${cls}`), document.createTextNode(text));
      ul.append(li);
    };
    item('current', 'You are here');
    item('visited', 'Visited');
    item('unvisited', 'Not visited yet');
    item('ending', 'Ending');
    item('call', 'Call (comes back)');
    return ul;
  }

  private renderVars(): HTMLElement {
    const section = h('section', 'map-vars');
    const head = h('div', 'map-vars-head');
    const reset = h('button', '', 'Reset') as HTMLButtonElement;
    reset.type = 'button';
    reset.title = 'Set every variable back to its starting value';
    reset.addEventListener('click', () => {
      for (const [name, v] of Object.entries(this.story.vars)) this.hooks.setVar(name, v);
    });
    head.append(h('h3', '', 'Variables'), reset);
    section.append(head);

    const names = Object.keys(this.story.vars);
    if (!names.length) {
      section.append(h('p', 'map-empty', 'This story has no variables.'));
      return section;
    }
    const table = h('div', 'map-var-list');
    for (const name of names) {
      const initial = this.story.vars[name];
      const row = h('label', 'map-var');
      const input = h('input') as HTMLInputElement;
      input.name = name;
      if (typeof initial === 'boolean') {
        input.type = 'checkbox';
        input.addEventListener('change', () => this.hooks.setVar(name, input.checked));
      } else if (typeof initial === 'number') {
        input.type = 'number';
        input.step = 'any';
        input.addEventListener('change', () => {
          const n = Number(input.value);
          if (input.value.trim() !== '' && Number.isFinite(n)) this.hooks.setVar(name, n);
          else this.refreshVars(true);
        });
      } else {
        input.type = 'text';
        input.addEventListener('change', () => this.hooks.setVar(name, input.value));
      }
      row.append(h('span', 'var-name', name), input);
      row.title = `Starts as ${JSON.stringify(initial)}`;
      table.append(row);
      this.varInputs.set(name, input);
    }
    section.append(table);
    this.refreshVars(true);
    return section;
  }

  private refreshVars(force = false): void {
    const vars = this.hooks.getVars();
    for (const [name, input] of this.varInputs) {
      const v = vars[name];
      if (!force && document.activeElement === input) continue;
      if (input.type === 'checkbox') input.checked = v === true;
      else input.value = String(v);
      input.closest('.map-var')?.classList.toggle('modified', v !== this.story.vars[name]);
    }
  }

  // ------------------------------------------------------------------ collapse

  private get collapsed(): boolean {
    return this.host?.classList.contains('map-collapsed') ?? false;
  }

  private setCollapsed(collapsed: boolean, remember = true): void {
    this.host?.classList.toggle('map-collapsed', collapsed);
    this.toggleBtn.textContent = collapsed ? '‹' : '›';
    this.toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    this.toggleBtn.setAttribute('aria-label', collapsed ? 'Show story map' : 'Hide story map');
    if (remember) {
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
    }
  }
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function s(tag: string, attrs: Record<string, string> = {}, text?: string): SVGElement {
  const e = document.createElementNS(SVG, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function truncate(t: string, n: number): string {
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

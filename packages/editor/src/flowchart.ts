/**
 * The flowchart pane: every label as a box, arrows for jumps, calls and choices.
 *
 * Click a scene to jump to it in the script; double-click to play from it.
 * The scene the game is in and the scene the cursor is in are highlighted, so
 * the three panes always point at the same place.
 */
import type { CompiledStory, StoryGraph } from '@emaki/format';
import { layoutGraph } from '@emaki/player-web/layout';

export interface FlowchartHooks {
  /** Show this label in the script. */
  reveal(label: string): void;
  /** Play from this label. */
  play(label: string): void;
}

const SVG = 'http://www.w3.org/2000/svg';
const NAME_MAX = 19;
const EDGE_LABEL_MAX = 28;

export class Flowchart {
  readonly el: HTMLElement;
  private readonly hooks: FlowchartHooks;
  private readonly nodes = new Map<string, SVGGElement>();
  private signature = '';
  private current: string | null = null;
  private cursor: string | null = null;
  private readonly visited = new Set<string>();

  constructor(parent: HTMLElement, hooks: FlowchartHooks) {
    this.hooks = hooks;
    this.el = document.createElement('div');
    this.el.className = 'flowchart';
    parent.append(this.el);
  }

  /** Redraw for a new version of the story (only if the shape of the graph changed). */
  update(story: CompiledStory, graph: StoryGraph): void {
    const start = Object.entries(story.labels).find(([, i]) => i === story.start)?.[0] ?? '';
    const signature = JSON.stringify([start, graph]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.render(graph, start);
  }

  /** The scene the game is showing. */
  setCurrent(label: string | null): void {
    if (label) this.visited.add(label);
    if (label === this.current) return;
    this.current = label;
    this.refresh();
    if (label) this.nodes.get(label)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  /** The scene the script cursor is in. */
  setCursor(label: string | null): void {
    if (label === this.cursor) return;
    this.cursor = label;
    this.refresh();
  }

  private refresh(): void {
    for (const [id, g] of this.nodes) {
      g.classList.toggle('current', id === this.current);
      g.classList.toggle('cursor', id === this.cursor);
      g.classList.toggle('visited', this.visited.has(id));
    }
  }

  private render(graph: StoryGraph, start: string): void {
    this.nodes.clear();
    if (!graph.nodes.length) {
      this.el.replaceChildren(text('p', 'flow-empty', 'Add a label to see your story as a flowchart.'));
      return;
    }
    const layout = layoutGraph(graph.nodes.map((n) => n.label), graph.edges, start, {
      nodeWidth: 150, nodeHeight: 48, colGap: 18, rowGap: 58, margin: 16,
    });
    const info = new Map(graph.nodes.map((n) => [n.label, n]));

    const svg = s('svg', { viewBox: `0 0 ${layout.width} ${layout.height + 16}`, class: 'flow-svg', role: 'group', 'aria-label': 'Story flowchart' });
    svg.setAttribute('width', String(layout.width));
    svg.setAttribute('height', String(layout.height + 16));
    const defs = s('defs');
    const marker = s('marker', { id: 'flow-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    marker.append(s('path', { d: 'M0 0L10 5L0 10z', class: 'flow-arrowhead' }));
    defs.append(marker);
    svg.append(defs);

    for (const e of layout.edges) {
      const g = s('g', { class: `flow-edge kind-${e.kind}${e.back ? ' back' : ''}` });
      const why = e.via.length ? e.via.join('\n') : e.kind === 'call' ? 'call (comes back)' : 'jump';
      g.append(s('title', {}, `${e.from} → ${e.to}\n${why}`), s('path', { d: e.path, class: 'line', 'marker-end': 'url(#flow-arrow)' }));
      if (e.via.length) {
        const label = e.via.length > 1 ? `${e.via.length} choices` : truncate(e.via[0]!, EDGE_LABEL_MAX);
        g.append(s('text', { x: String(e.mid.x), y: String(e.mid.y), class: 'edge-label' }, label));
      }
      svg.append(g);
    }

    for (const n of layout.nodes) {
      const meta = info.get(n.id)!;
      const isStart = n.id === start;
      const cls = ['flow-node', meta.ending && 'ending', isStart && 'start', n.unreachable && 'unreachable'].filter(Boolean).join(' ');
      const g = s('g', {
        class: cls,
        transform: `translate(${n.x} ${n.y})`,
        tabindex: '0',
        role: 'button',
        'aria-label': `${n.id}: show in script (double-click or Shift+Enter to play from here)`,
      }) as SVGGElement;
      const kind = meta.ending ? 'ending' : isStart ? 'start' : 'scene';
      g.append(
        s('title', {}, `${n.id}\n${meta.lines} lines · line ${meta.line} · ${kind}${n.unreachable ? ' · never reached' : ''}\nClick: show in script · Double-click: play from here`),
        s('rect', { width: String(n.w), height: String(n.h), rx: meta.ending ? String(n.h / 2) : '8' }),
        s('text', { x: String(n.w / 2), y: '21', class: 'name' }, truncate(n.id, NAME_MAX)),
        s('text', { x: String(n.w / 2), y: '38', class: 'meta' }, `${meta.lines} lines · L${meta.line}`),
      );
      if (isStart) g.append(s('text', { x: String(n.w / 2), y: '-6', class: 'badge' }, 'START'));
      g.addEventListener('click', () => this.hooks.reveal(n.id));
      g.addEventListener('dblclick', () => this.hooks.play(n.id));
      g.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        if (ev.shiftKey) this.hooks.play(n.id);
        else this.hooks.reveal(n.id);
      });
      this.nodes.set(n.id, g);
      svg.append(g);
    }
    this.el.replaceChildren(svg);
    this.refresh();
  }
}

function s(tag: string, attrs: Record<string, string> = {}, content?: string): SVGElement {
  const e = document.createElementNS(SVG, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (content !== undefined) e.textContent = content;
  return e;
}

function text(tag: string, cls: string, content: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = content;
  return e;
}

function truncate(t: string, n: number): string {
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

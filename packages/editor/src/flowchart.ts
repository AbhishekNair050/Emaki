/**
 * The flowchart pane: every label as a box, arrows for jumps, calls and choices.
 *
 *  - click a scene to jump to it in the script; double-click to play from it
 *  - click an arrow to see the line that makes it
 *  - edit the story's shape: add, rename and delete scenes, and drag from one
 *    scene to another (or use "Lead to…") to connect them
 *
 * Edits go through hooks that rewrite the script with the printer, so the
 * script stays the single source of truth and every change can be undone there.
 * The scene the game is in and the scene the cursor is in are highlighted, so
 * the three panes always point at the same place.
 */
import type { CompiledStory, StoryGraph, StoryNode } from '@emaki/format';
import { layoutGraph } from '@emaki/player-web/layout';

/** An edit hook returns an error message, or null when it worked. */
type Edit = string | null;

export interface FlowchartHooks {
  /** Show this label in the script. */
  reveal(label: string): void;
  /** Show this 1-based line in the script. */
  /** Show a line of the script (in `file` when it isn't story.vn). */
  revealLine(line: number, file?: string): void;
  /** Play from this label. */
  play(label: string): void;
  addScene(name: string, after: string | null): Edit;
  renameScene(from: string, to: string): Edit;
  deleteScene(name: string): Edit;
  connect(from: string, to: string): Edit;
  /**
   * Each scene's share of something, to colour the chart by: a level from 0 to 4 and the words shown under its
   * name (`528 words`, `88% of lines seen`, `trust 0 to 2`). Asked only while that colouring is chosen.
   */
  measure?(by: Colouring): Map<string, Measure> | null;
  /** The story's variables, to colour by one of them. */
  variables?(): string[];
}

export interface Measure {
  level: number;
  text: string;
}

/** What the scenes are coloured by: their kind, what a playtest has read, their words, or a variable on entry. */
export type Colouring = 'none' | 'read' | 'words' | `var:${string}`;
const COLOURINGS: [Colouring, string, string][] = [
  ['none', 'Scene type', 'Start, scenes and endings'],
  ['read', 'Playtest coverage', 'How much of each scene the game has shown so far (on this computer)'],
  ['words', 'Word count', 'Darker scenes have more words'],
];

const SVG = 'http://www.w3.org/2000/svg';
const NAME_MAX = 19;
const EDGE_LABEL_MAX = 24;
/** The chart shrinks to fit its pane, but not below this (then it scrolls). */
const MIN_FIT = 0.72;
const DRAG_THRESHOLD = 6;

export class Flowchart {
  readonly el: HTMLElement;
  private readonly hooks: FlowchartHooks;
  private readonly canvas: HTMLElement;
  private readonly message: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly buttons: Record<'add' | 'rename' | 'remove' | 'connect', HTMLButtonElement>;
  private readonly nodes = new Map<string, SVGGElement>();
  private svg: SVGSVGElement | null = null;
  private graph: StoryGraph = { nodes: [], edges: [] };
  private signature = '';
  private current: string | null = null;
  private selected: string | null = null;
  private readonly visited = new Set<string>();
  /** "Lead to…" mode: the next scene clicked becomes the target. */
  private connectFrom: string | null = null;
  private onSubmit: ((value: string) => Edit) | null = null;
  private messageTimer = 0;
  private readonly edges = new Map<string, SVGGElement>();
  /** Each edge's label, drawn above the scenes so it is never hidden under one. */
  private readonly chips = new Map<string, SVGGElement>();
  private layoutWidth = 0;
  private colouring: Colouring = 'none';
  private readonly colourButtons = new Map<Colouring, HTMLButtonElement>();
  private readonly varSelect: HTMLSelectElement;
  private readonly info = new Map<string, StoryNode>();
  /** The scenes of the route shown, in order (null: none). */
  private route: string[] | null = null;

  constructor(parent: HTMLElement, hooks: FlowchartHooks) {
    this.hooks = hooks;
    this.el = el('div', 'flowchart');

    const bar = el('div', 'flow-toolbar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Edit the story');
    this.buttons = {
      add: button('+ Scene', 'Add a new scene after the selected one', () => this.ask('Name of the new scene', '', (name) => this.hooks.addScene(name, this.selected))),
      rename: button('Rename', 'Rename the selected scene (and everything that leads to it)', () => {
        const from = this.selected!;
        this.ask(`Rename '${from}' to`, from, (to) => this.hooks.renameScene(from, to));
      }),
      remove: button('Delete', 'Delete the selected scene (Ctrl+Z in the script undoes it)', () => {
        const name = this.selected!;
        const err = this.hooks.deleteScene(name);
        this.say(err ?? `Deleted '${name}'. Press Ctrl+Z in the script to undo.`, !!err);
      }),
      connect: button('Lead to…', 'Make the selected scene lead to another one: click this, then the other scene (or drag between scenes)', () => this.startConnect()),
    };
    this.input = el('input') as HTMLInputElement;
    this.input.type = 'text';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.form = el('form', 'flow-form') as HTMLFormElement;
    this.form.hidden = true;
    const ok = el('button', '', 'OK') as HTMLButtonElement;
    ok.type = 'submit';
    this.form.append(this.input, ok, button('Cancel', '', () => this.closeForm()));
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = this.input.value.trim();
      if (!value || !this.onSubmit) return this.closeForm();
      const err = this.onSubmit(value);
      if (err) { this.say(err, true); this.input.focus(); return; }
      this.closeForm();
    });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeForm(); });
    this.message = el('span', 'flow-message');
    this.message.setAttribute('role', 'status');
    // Colour by: the scene's kind, playtest coverage, words, or a variable's value on entry.
    const colour = el('div', 'flow-colour-field');
    colour.append(el('span', 'flow-colour-label', 'Colour by'));
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Colour the scenes by');
    for (const [value, label, title] of COLOURINGS) {
      const b = button(label, title, () => this.colourBy(value));
      this.colourButtons.set(value, b);
      seg.append(b);
    }
    this.varSelect = el('select', 'flow-var') as HTMLSelectElement;
    this.varSelect.setAttribute('aria-label', 'Colour by the value of a variable');
    this.varSelect.addEventListener('focus', () => this.fillVariables());
    this.varSelect.addEventListener('pointerdown', () => this.fillVariables());
    this.varSelect.addEventListener('change', () => { if (this.varSelect.value) this.colourBy(`var:${this.varSelect.value}`); });
    seg.append(this.varSelect);
    colour.append(seg);
    const edit = el('div', 'flow-edit');
    edit.append(...Object.values(this.buttons), this.form);
    bar.append(colour, this.message, edit);
    this.fillVariables();
    this.colourBy('none');

    this.canvas = el('div', 'flow-canvas');
    new ResizeObserver(() => this.fit()).observe(this.canvas);
    this.el.append(bar, this.canvas);
    parent.append(this.el);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.connectFrom) this.stopConnect('Cancelled.');
    });
    this.updateButtons();
  }

  /**
   * Redraw for a new version of the story. Only a change to its shape (scenes, links, endings) lays the chart out
   * again; typing usually just moves scenes down the file, and then only their line numbers are rewritten.
   */
  update(story: CompiledStory, graph: StoryGraph): void {
    const start = Object.entries(story.labels).find(([, i]) => i === story.start)?.[0] ?? '';
    const signature = JSON.stringify([start, graph.nodes.map((n) => [n.label, n.ending]), graph.edges.map((e) => [e.from, e.to, e.kind, e.via])]);
    this.graph = graph;
    if (signature === this.signature) {
      this.relabel(graph, start);
      return;
    }
    this.signature = signature;
    this.render(graph, start);
  }

  /** Rewrite the line counts and numbers of scenes whose text changed. */
  private relabel(graph: StoryGraph, start: string): void {
    for (const n of graph.nodes) this.info.set(n.label, n);
    for (const n of graph.nodes) {
      const g = this.nodes.get(n.label);
      const meta = g?.querySelector('.meta');
      if (!g || !meta) continue;
      const text = metaText(n);
      if (this.colouring !== 'none' || meta.textContent === text) continue;
      meta.textContent = text;
      const title = g.querySelector('title');
      if (title) title.textContent = nodeTitle(n, n.label === start, g.classList.contains('unreachable'));
    }
  }

  /** The scene the game is showing. */
  setCurrent(label: string | null): void {
    if (label) this.visited.add(label);
    if (label === this.current) return;
    const before = this.current;
    this.current = label;
    this.refreshNodes(before, label);
    this.scrollTo(label);
  }

  /** The scene the script cursor is in: it is also the one the toolbar acts on. */
  setCursor(label: string | null, scroll = true): void {
    if (label === this.selected) return;
    const before = this.selected;
    this.selected = label;
    this.refreshNodes(before, label);
    this.updateButtons();
    // Scrolling lays the page out: only when the chart is showing.
    if (scroll) this.scrollTo(label);
  }

  /** Bring the cursor's scene into view (the chart has just been shown). */
  showCursor(): void {
    this.scrollTo(this.selected);
  }

  private scrollTo(label: string | null): void {
    if (label) this.nodes.get(label)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  private colourBy(c: Colouring): void {
    this.colouring = c;
    for (const [k, b] of this.colourButtons) b.setAttribute('aria-pressed', String(k === c));
    this.varSelect.classList.toggle('on', c.startsWith('var:'));
    if (!c.startsWith('var:')) this.varSelect.value = '';
    this.recolour(true);
  }

  /** The variables to colour by, read when the list is opened (they change as the script does). */
  /** Shrink the chart to the pane's width when it is only a little wider; otherwise keep its size and scroll. */
  private fit(): void {
    if (!this.svg || !this.layoutWidth) return;
    const room = this.canvas.clientWidth - 48;
    this.svg.style.maxWidth = room > 0 && room / this.layoutWidth >= MIN_FIT ? '100%' : 'none';
    this.svg.style.height = 'auto';
  }

  /** The story changed: the variables to colour by may have too. */
  refreshVariables(): void {
    this.fillVariables();
  }

  private fillVariables(): void {
    const vars = this.hooks.variables?.() ?? [];
    const keep = this.varSelect.value;
    const first = el('option', '', vars.length ? 'Value of…' : 'No variables') as HTMLOptionElement;
    first.value = '';
    this.varSelect.replaceChildren(first, ...vars.map((v) => {
      const o = el('option', '', v) as HTMLOptionElement;
      o.value = v;
      return o;
    }));
    this.varSelect.value = vars.includes(keep) ? keep : '';
  }

  /** Colour the scenes again (the story changed, the game showed more, or the routes were searched). */
  recolour(force = false): void {
    if (!force && this.colouring === 'none') return;
    const values = this.colouring === 'none' ? null : this.hooks.measure?.(this.colouring) ?? null;
    this.el.dataset.colouring = this.colouring.startsWith('var:') ? 'var' : this.colouring;
    for (const [id, g] of this.nodes) {
      const m = values?.get(id);
      if (m === undefined) g.removeAttribute('data-level');
      else g.setAttribute('data-level', String(m.level));
      const meta = g.querySelector('.meta');
      const n = this.info.get(id);
      if (meta) meta.textContent = m ? m.text : n ? metaText(n) : '';
    }
  }

  /** Colouring that depends on the routes (a variable's value) is drawn again when they are searched. */
  recolourIfVariable(): void {
    if (this.colouring.startsWith('var:')) this.recolour();
  }

  /** The game showed more of the story: colour again when colouring by what's been read. */
  recolourIfRead(): void {
    if (this.colouring === 'read') this.recolour();
  }

  /** Highlight a route through the story (its scenes in order), or none. */
  setRoute(scenes: string[] | null): void {
    if ((scenes?.join('>') ?? null) === (this.route?.join('>') ?? null)) return;
    this.route = scenes;
    this.drawRoute();
    if (scenes?.length) this.scrollTo(scenes[0]!);
  }

  private drawRoute(): void {
    const on = new Set(this.route ?? []);
    const steps = new Set<string>();
    for (let i = 1; i < (this.route?.length ?? 0); i++) steps.add(`${this.route![i - 1]}>${this.route![i]}`);
    this.el.classList.toggle('has-route', !!this.route);
    for (const [id, g] of this.nodes) g.classList.toggle('on-route', on.has(id));
    for (const [key, g] of this.edges) g.classList.toggle('on-route', steps.has(key));
    for (const [key, g] of this.chips) g.classList.toggle('on-route', steps.has(key));
  }

  /** Restyle only the scenes that changed (a long story has thousands). */
  private refreshNodes(...ids: (string | null)[]): void {
    for (const id of ids) {
      const g = id === null ? undefined : this.nodes.get(id);
      if (!g || id === null) continue;
      g.classList.toggle('current', id === this.current);
      g.classList.toggle('cursor', id === this.selected);
      g.classList.toggle('visited', this.visited.has(id));
      g.classList.toggle('connect-source', id === this.connectFrom);
    }
  }

  private refresh(): void {
    for (const [id, g] of this.nodes) {
      g.classList.toggle('current', id === this.current);
      g.classList.toggle('cursor', id === this.selected);
      g.classList.toggle('visited', this.visited.has(id));
      g.classList.toggle('connect-source', id === this.connectFrom);
    }
  }

  private updateButtons(): void {
    const none = !this.selected || !this.nodes.has(this.selected);
    this.buttons.rename.disabled = none;
    this.buttons.remove.disabled = none;
    this.buttons.connect.disabled = none;
    this.buttons.connect.setAttribute('aria-pressed', String(!!this.connectFrom));
  }

  // ---------------------------------------------------------------- editing UI

  private ask(prompt: string, initial: string, submit: (value: string) => Edit): void {
    this.stopConnect();
    this.onSubmit = submit;
    this.input.value = initial;
    this.input.placeholder = prompt;
    this.input.setAttribute('aria-label', prompt);
    this.form.hidden = false;
    this.say(prompt + ':');
    this.input.focus();
    this.input.select();
  }

  private closeForm(): void {
    this.form.hidden = true;
    this.onSubmit = null;
    this.say('');
  }

  private startConnect(): void {
    if (!this.selected) return;
    this.closeForm();
    this.connectFrom = this.selected;
    this.el.classList.add('connecting');
    this.say(`Now click the scene '${this.connectFrom}' should lead to (Esc to cancel).`);
    this.refresh();
    this.updateButtons();
  }

  private stopConnect(message?: string): void {
    if (!this.connectFrom) return;
    this.connectFrom = null;
    this.el.classList.remove('connecting');
    if (message !== undefined) this.say(message);
    this.refresh();
    this.updateButtons();
  }

  private connect(from: string, to: string): void {
    const err = this.hooks.connect(from, to);
    this.say(err ?? `'${from}' now leads to '${to}'.`, !!err);
  }

  private say(text: string, isError = false): void {
    this.message.textContent = text;
    this.message.classList.toggle('error', isError);
    window.clearTimeout(this.messageTimer);
    if (text && !this.onSubmit && !this.connectFrom) {
      this.messageTimer = window.setTimeout(() => { if (this.message.textContent === text) this.message.textContent = ''; }, 7000);
    }
  }

  // ---------------------------------------------------------------- drawing

  private render(graph: StoryGraph, start: string): void {
    const before = new Set(this.nodes.keys());
    this.nodes.clear();
    this.edges.clear();
    this.chips.clear();
    if (!graph.nodes.length) {
      this.svg = null;
      this.canvas.replaceChildren(el('p', 'flow-empty', 'Add a scene to see your story as a flowchart.'));
      this.updateButtons();
      return;
    }
    const layout = layoutGraph(graph.nodes.map((n) => n.label), graph.edges, start, {
      nodeWidth: 160, nodeHeight: 64, colGap: 26, rowGap: 84, margin: 24, direction: 'right',
    });
    const info = new Map(graph.nodes.map((n) => [n.label, n]));
    this.info.clear();
    for (const n of graph.nodes) this.info.set(n.label, n);

    const svg = s('svg', { viewBox: `0 0 ${layout.width} ${layout.height + 16}`, class: 'flow-svg', role: 'group', 'aria-label': 'Story flowchart' }) as SVGSVGElement;
    svg.setAttribute('width', String(layout.width));
    svg.setAttribute('height', String(layout.height + 16));
    const defs = s('defs');
    const marker = s('marker', { id: 'flow-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    marker.append(s('path', { d: 'M0 0L10 5L0 10z', class: 'flow-arrowhead' }));
    defs.append(marker);
    svg.append(defs);

    for (const e of layout.edges) {
      const g = s('g', { class: `flow-edge kind-${e.kind}${e.back ? ' back' : ''}` }) as SVGGElement;
      this.edges.set(`${e.from}>${e.to}`, g);
      const why = e.via.length ? e.via.join('\n') : e.kind === 'call' ? 'call (comes back)' : 'jump';
      g.append(
        s('title', {}, `${e.from} → ${e.to}\n${why}\nClick to see it in the script`),
        s('path', { d: e.path, class: 'hit' }),
        s('path', { d: e.path, class: 'line', 'marker-end': 'url(#flow-arrow)' }),
      );
      if (e.via.length) {
        const label = e.via.length > 1 ? `${e.via.length} choices` : truncate(e.via[0]!, EDGE_LABEL_MAX);
        // A chip: the label on a pill, so it reads over the lines.
        const w = Math.round(label.length * 6.1 + 14);
        const chip = s('g', { class: 'flow-edge flow-chip' }) as SVGGElement;
        chip.append(
          s('title', {}, `${e.from} → ${e.to}
${why}`),
          s('rect', { x: String(e.mid.x - w / 2), y: String(e.mid.y - 9), width: String(w), height: '18', rx: '9', class: 'edge-chip' }),
          s('text', { x: String(e.mid.x), y: String(e.mid.y + 0.5), class: 'edge-label' }, label),
        );
        this.chips.set(`${e.from}>${e.to}`, chip);
      }
      // Looked up when clicked: the line moves as the script is edited (see relabel).
      g.addEventListener('click', () => {
        const edge = this.graph.edges.find((x) => x.from === e.from && x.to === e.to);
        if (edge?.line) this.hooks.revealLine(edge.line, edge.file);
      });
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
        'data-label': n.id,
        'aria-label': `${n.id}: show in script (double-click or Shift+Enter to play from here)`,
      }) as SVGGElement;
      g.append(
        s('title', {}, nodeTitle(meta, isStart, !!n.unreachable)),
        s('rect', { width: String(n.w), height: String(n.h), rx: '8', class: 'box' }),
        meta.ending
          ? s('circle', { cx: '18', cy: '24', r: '4', class: 'dot' })
          : s('rect', { x: '14', y: '20', width: '8', height: '8', rx: '2', class: 'dot' }),
        s('text', { x: '30', y: '28', class: 'name' }, truncate(n.id, NAME_MAX)),
        s('text', { x: '14', y: '48', class: 'meta' }, metaText(meta)),
      );
      if (isStart) g.append(s('text', { x: String(n.w / 2), y: '-6', class: 'badge' }, 'START'));
      this.wireNode(g, n.id, { x: n.x + n.w / 2, y: n.y + n.h });
      this.nodes.set(n.id, g);
      svg.append(g);
    }
    svg.append(...this.chips.values());
    this.svg = svg;
    this.layoutWidth = layout.width;
    this.canvas.replaceChildren(svg);
    this.fit();
    this.recolour();
    this.drawRoute();
    if (this.connectFrom && !this.nodes.has(this.connectFrom)) this.stopConnect('');
    this.refresh();
    this.updateButtons();
    // A scene just added (or renamed) by the writer: bring it into view.
    if (this.selected && !before.has(this.selected)) this.scrollTo(this.selected);
  }

  /** Click, double-click, keyboard, and drag-to-connect for one scene. */
  private wireNode(g: SVGGElement, id: string, anchor: { x: number; y: number }): void {
    const activate = () => {
      if (this.connectFrom) {
        const from = this.connectFrom;
        this.stopConnect();
        this.connect(from, id);
      } else {
        this.hooks.reveal(id);
      }
    };
    g.addEventListener('dblclick', () => { if (!this.connectFrom) this.hooks.play(id); });
    g.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      if (ev.shiftKey && !this.connectFrom) this.hooks.play(id);
      else activate();
    });

    // Don't start a text selection in the SVG: it would land in the script once it takes focus.
    g.addEventListener('mousedown', (ev) => ev.preventDefault());
    // A press that moves becomes a drag that draws a connection; one that doesn't is a click.
    g.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      const svg = this.svg!;
      let line: SVGElement | null = null;
      const move = (ev: PointerEvent) => {
        if (!line && Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) < DRAG_THRESHOLD) return;
        const p = toSvg(svg, ev);
        if (!line) {
          line = s('line', { class: 'flow-drag', x1: String(anchor.x), y1: String(anchor.y), 'marker-end': 'url(#flow-arrow)' });
          svg.append(line);
          this.el.classList.add('dragging');
        }
        line.setAttribute('x2', String(p.x));
        line.setAttribute('y2', String(p.y));
        for (const [other, node] of this.nodes) node.classList.toggle('drop-target', other !== id && node.contains(target(ev)));
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.el.classList.remove('dragging');
        for (const node of this.nodes.values()) node.classList.remove('drop-target');
        if (!line) { activate(); return; }
        line.remove();
        const to = (target(ev)?.closest('.flow-node') as SVGGElement | null)?.dataset.label;
        if (to && to !== id) this.connect(id, to);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
}

function target(ev: PointerEvent): Element | null {
  return document.elementFromPoint(ev.clientX, ev.clientY);
}

function toSvg(svg: SVGSVGElement, ev: PointerEvent): { x: number; y: number } {
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

function s(tag: string, attrs: Record<string, string> = {}, content?: string): SVGElement {
  const e = document.createElementNS(SVG, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (content !== undefined) e.textContent = content;
  return e;
}

function el(tag: string, cls = '', content?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content !== undefined) e.textContent = content;
  return e;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', '', label) as HTMLButtonElement;
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function truncate(t: string, n: number): string {
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function metaText(n: StoryNode): string {
  return `${n.lines} lines · L${n.line}`;
}

function nodeTitle(n: StoryNode, isStart: boolean, unreachable: boolean): string {
  const kind = n.ending ? 'ending' : isStart ? 'start' : 'scene';
  return `${n.label}\n${n.lines} lines · line ${n.line} · ${kind}${unreachable ? ' · never reached' : ''}\nClick: show in script · Double-click: play from here\nDrag to another scene: lead there`;
}

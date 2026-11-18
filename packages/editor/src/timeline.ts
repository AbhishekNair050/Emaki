/**
 * The scene's lines as a timeline (D-065): one column for each line of
 * dialogue or choice, with what happens to the picture, the sound and the
 * story's flow on the way to it. Clicking a column goes to that line.
 *
 * Built from the program the editor already compiled (no parsing of its
 * own), only when the scene or the story changes; only the columns in view
 * are drawn, so a scene with thousands of lines costs the same as a short one.
 */
import { printExpr, printStatement, type LabelDef, type Stmt } from '@emaki/format';

export interface Beat {
  /** 1-based line of the dialogue (or `menu:`, or the last statement for a scene's ending). */
  line: number;
  kind: 'say' | 'menu' | 'end';
  /** Speaker id (null for narration). */
  who: string | null;
  text: string;
  /** How many choices or conditions this line is inside. */
  depth: number;
  /** What happens just before this line, by track. */
  picture: string[];
  sound: string[];
  flow: string[];
}

export interface TimelineHooks {
  /** A column was clicked. */
  go(line: number, file?: string): void;
  /** Colour of a speaker's name, if the story gives one. */
  colorOf(who: string): string | null;
}

const PICTURE = new Set(['scene', 'show', 'hide', 'animate', 'with', 'motion', 'still', 'shake', 'flash', 'camera', 'tone', 'textbox', 'nvl', 'movie', 'screen', 'plugin']);
const SOUND = new Set(['play', 'stop']);

/** The lines of one scene, in the order they're written, each with what leads up to it. */
export function beatsOf(label: LabelDef): Beat[] {
  const out: Beat[] = [];
  let pending = { picture: [] as string[], sound: [] as string[], flow: [] as string[] };
  let last = label.loc.line;
  const take = () => { const p = pending; pending = { picture: [], sound: [], flow: [] }; return p; };
  const short = (s: Stmt) => printStatement({ ...s, comment: undefined } as Stmt)[0]!.trim();
  const walk = (stmts: Stmt[], depth: number) => {
    for (const s of stmts) {
      last = s.loc.line;
      if (s.type === 'say') out.push({ line: s.loc.line, kind: 'say', who: s.who, text: clip(s.text), depth, ...take() });
      else if (s.type === 'menu') {
        out.push({ line: s.loc.line, kind: 'menu', who: null, text: s.choices.map((c) => c.text).join(' / '), depth, ...take() });
        for (const c of s.choices) {
          pending.flow.push(`choice: ${clip(c.text, 40)}`);
          walk(c.body, depth + 1);
        }
      } else if (s.type === 'if') {
        for (const b of s.branches) {
          pending.flow.push(b.cond === null ? 'else' : `if ${printExpr(b.cond)}`);
          walk(b.body, depth + 1);
        }
      } else if (PICTURE.has(s.type)) pending.picture.push(short(s));
      else if (SOUND.has(s.type)) pending.sound.push(short(s));
      else pending.flow.push(short(s));
    }
  };
  walk(label.body, 0);
  if (pending.picture.length || pending.sound.length || pending.flow.length) out.push({ line: last, kind: 'end', who: null, text: '', depth: 0, ...take() });
  return out;
}

function clip(text: string, n = 70): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const COL = 150;
const SPARE = 4;

export class Timeline {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly lane: HTMLElement;
  private readonly hooks: TimelineHooks;
  private beats: Beat[] = [];
  private file: string | undefined;
  private label: string | null = null;
  private current = -1;
  private drawn = '';
  private frame = 0;

  constructor(parent: HTMLElement, hooks: TimelineHooks) {
    this.hooks = hooks;
    this.root = document.createElement('section');
    this.root.className = 'timeline';
    this.root.setAttribute('aria-label', 'Lines of the scene');
    const head = document.createElement('h2');
    head.className = 'pane-head';
    this.title = document.createElement('span');
    this.title.className = 'hint';
    head.append('Lines ', this.title);
    const body = document.createElement('div');
    body.className = 'timeline-body';
    const tracks = document.createElement('div');
    tracks.className = 'timeline-tracks';
    tracks.setAttribute('aria-hidden', 'true');
    for (const t of ['Line', 'Dialogue', 'Picture', 'Sound', 'Flow']) {
      const d = document.createElement('div');
      d.textContent = t;
      tracks.append(d);
    }
    this.scroller = document.createElement('div');
    this.scroller.className = 'timeline-scroll';
    this.lane = document.createElement('div');
    this.lane.className = 'timeline-lane';
    this.lane.setAttribute('role', 'list');
    this.scroller.append(this.lane);
    body.append(tracks, this.scroller);
    this.root.append(head, body);
    parent.append(this.root);
    this.scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => this.schedule()).observe(this.scroller);
    this.lane.addEventListener('click', (e) => {
      const col = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
      if (col) this.hooks.go(Number(col.dataset.line), this.file);
    });
  }

  /** Show a scene (null: the cursor isn't in one). */
  setScene(label: LabelDef | null, file?: string): void {
    this.label = label?.name ?? null;
    this.file = file;
    this.beats = label ? beatsOf(label) : [];
    this.title.textContent = label ? `${label.name} · ${this.beats.length} ${this.beats.length === 1 ? 'line' : 'lines'}` : 'put the cursor in a scene';
    this.lane.style.width = `${this.beats.length * COL}px`;
    this.current = -1;
    this.drawn = '';
    this.schedule();
  }

  get scene(): string | null {
    return this.label;
  }

  /** The cursor is on `line`: mark the column it belongs to, and keep it in view. */
  setCursor(line: number): void {
    // What a line does leads up to the next line of dialogue: the first beat at or after the line (in line order).
    let lo = 0, hi = this.beats.length - 1, at = this.beats.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.beats[mid]!.line >= line) { at = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (at === this.current) return;
    this.current = at;
    if (at >= 0) {
      const left = at * COL, right = left + COL;
      const view = this.scroller;
      if (left < view.scrollLeft || right > view.scrollLeft + view.clientWidth) view.scrollLeft = Math.max(0, left - view.clientWidth / 2 + COL / 2);
    }
    this.drawn = '';
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  /** Draw the columns in view (and a few either side). */
  private draw(): void {
    const first = Math.max(0, Math.floor(this.scroller.scrollLeft / COL) - SPARE);
    const last = Math.min(this.beats.length, Math.ceil((this.scroller.scrollLeft + this.scroller.clientWidth) / COL) + SPARE);
    const key = `${first}:${last}:${this.current}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const cols: HTMLElement[] = [];
    for (let i = first; i < last; i++) cols.push(this.column(this.beats[i]!, i));
    this.lane.replaceChildren(...cols);
  }

  private column(b: Beat, i: number): HTMLElement {
    const col = document.createElement('div');
    col.className = `timeline-col kind-${b.kind}${i === this.current ? ' current' : ''}`;
    col.style.left = `${i * COL}px`;
    col.dataset.line = String(b.line);
    col.setAttribute('role', 'listitem');
    const num = document.createElement('button');
    num.type = 'button';
    num.className = 'timeline-num';
    num.dataset.line = String(b.line);
    num.title = `Go to line ${b.line}`;
    const index = document.createElement('b');
    index.textContent = String(i + 1);
    num.append(index, ` line ${b.line}`);
    const say = document.createElement('div');
    say.className = 'timeline-cell timeline-say';
    if (b.depth) say.style.setProperty('--depth', String(b.depth));
    if (b.kind === 'menu') say.append(tag('timeline-who', 'Choice'), b.text);
    else if (b.kind === 'end') say.append(tag('timeline-who', 'End of scene'));
    else {
      if (b.who) {
        const who = tag('timeline-who', b.who);
        const c = this.hooks.colorOf(b.who);
        if (c) who.style.color = c;
        say.append(who);
      }
      say.append(b.text);
    }
    say.title = say.textContent ?? '';
    col.append(num, say, chips('timeline-picture', b.picture), chips('timeline-sound', b.sound), chips('timeline-flow', b.flow));
    return col;
  }
}

function tag(cls: string, text: string): HTMLElement {
  const t = document.createElement('span');
  t.className = cls;
  t.textContent = text;
  return t;
}

/** A track's cell: its first event as a chip, and how many more there are. */
function chips(cls: string, events: string[]): HTMLElement {
  const d = document.createElement('div');
  d.className = `timeline-cell timeline-track ${cls}`;
  if (!events.length) return d;
  d.title = events.join('\n');
  d.append(tag('timeline-chip', events[0]!));
  if (events.length > 1) d.append(tag('timeline-more', `+${events.length - 1}`));
  return d;
}

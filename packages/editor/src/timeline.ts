/**
 * The scene's lines as a timeline (D-065), along the bottom of every
 * workspace: one column for each line of dialogue or choice, with a track for
 * each character on stage (their look and place), the background, the music
 * and where the story branches. Clicking a column goes to that line, and the
 * script, the game and the inspector follow.
 *
 * Built from the program the editor already compiled (no parsing of its
 * own), only when the scene or the story changes; only the columns in view
 * are drawn, so a scene with thousands of lines costs the same as a short one.
 */
import { printExpr, type LabelDef, type Stmt } from '@emaki/format';

/** How a character stands at a line: their look and place. */
export interface Pose {
  look: string;
  at: string;
}

export interface Beat {
  /** 1-based line of the dialogue (or `menu:`, or the last statement for a scene's ending). */
  line: number;
  kind: 'say' | 'menu' | 'end';
  /** Speaker id (null for narration). */
  who: string | null;
  text: string;
  /** How many choices or conditions this line is inside. */
  depth: number;
  /** Who is on stage at this line, by tag. */
  cast: Record<string, Pose>;
  /** The background at this line, and whether it changed just before it. */
  bg: string | null;
  bgChanged: boolean;
  /** The music at this line, and whether it started just before it. */
  music: string | null;
  musicChanged: boolean;
  /** Where the story branches or jumps on the way to this line, or at it. */
  branch: string[];
}

export interface TimelineHooks {
  /** A column was clicked. */
  go(line: number, file?: string): void;
  /** Colour of a speaker's name, if the story gives one. */
  colorOf(who: string): string | null;
  /** A character's name, for their track (`Mira` for `mira`). */
  nameOf?(tag: string): string;
}

/** The lines of one scene, in the order they're written, with the state of the stage at each. */
export function beatsOf(label: LabelDef): Beat[] {
  const out: Beat[] = [];
  const cast = new Map<string, Pose>();
  let bg: string | null = null;
  let bgChanged = false;
  let music: string | null = null;
  let musicChanged = false;
  let branch: string[] = [];
  let last = label.loc.line;
  const push = (b: Pick<Beat, 'line' | 'kind' | 'who' | 'text' | 'depth'>) => {
    out.push({ ...b, cast: Object.fromEntries(cast), bg, bgChanged, music, musicChanged, branch });
    bgChanged = musicChanged = false;
    branch = [];
  };
  const walk = (stmts: Stmt[], depth: number) => {
    for (const s of stmts) {
      last = s.loc.line;
      switch (s.type) {
        case 'say':
          // `mira smile: ...` changes the look of a character on stage.
          if (s.who && s.attrs.length && cast.has(s.who)) cast.set(s.who, { ...cast.get(s.who)!, look: s.attrs.join(' ') });
          push({ line: s.loc.line, kind: 'say', who: s.who, text: clip(s.text), depth });
          break;
        case 'menu':
          branch.push(`${s.choices.length} ${s.choices.length === 1 ? 'choice' : 'choices'}`);
          push({ line: s.loc.line, kind: 'menu', who: null, text: s.choices.map((c) => c.text).join(' / '), depth });
          for (const c of s.choices) {
            branch.push(`“${clip(c.text, 30)}”`);
            walk(c.body, depth + 1);
          }
          break;
        case 'if':
          for (const b of s.branches) {
            branch.push(b.cond === null ? 'else' : `if ${printExpr(b.cond)}`);
            walk(b.body, depth + 1);
          }
          break;
        case 'scene':
          bg = s.image;
          bgChanged = true;
          cast.clear();
          break;
        case 'show': {
          const tag = s.as ?? s.tag;
          const before = cast.get(tag);
          cast.set(tag, { look: s.attrs.length ? s.attrs.join(' ') : before?.look ?? '', at: s.at ?? before?.at ?? 'center' });
          break;
        }
        case 'hide':
          cast.delete(s.tag);
          break;
        case 'play':
          if (s.channel === 'music') {
            music = s.asset.kind === 'name' ? s.asset.name : s.asset.path.split('/').pop()!;
            musicChanged = true;
          }
          break;
        case 'stop':
          if (s.channel === 'music') { music = null; musicChanged = true; }
          break;
        case 'jump': case 'call':
          branch.push(`${s.type} ${s.target}`);
          break;
        case 'end':
          branch.push(s.ending ? `end ${s.ending}` : 'end');
          break;
        case 'return':
          branch.push('return');
          break;
        default:
          break;
      }
    }
  };
  walk(label.body, 0);
  if (branch.length || bgChanged || musicChanged) push({ line: last, kind: 'end', who: null, text: '', depth: 0 });
  return out;
}

function clip(text: string, n = 70): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** The narrowest a column gets; wider when the scene's lines fit the width. */
const MIN_COL = 132;
const SPARE = 4;
/** Characters with a track of their own; the rest are counted in the last one. */
const MAX_CAST = 4;

export class Timeline {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly count: HTMLElement;
  private readonly tracks: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly lane: HTMLElement;
  private readonly hooks: TimelineHooks;
  private beats: Beat[] = [];
  private cast: string[] = [];
  private hasBg = false;
  private file: string | undefined;
  private label: string | null = null;
  private current = -1;
  /** The column of the line the game is showing (-1: the game is elsewhere). */
  private playing = -1;
  private col = MIN_COL;
  private drawn = '';
  private frame = 0;
  /** The view's width and scroll, kept from its own events: reading them on a cursor move would lay the page out. */
  private viewWidth = 0;
  private scrollX = 0;

  constructor(parent: HTMLElement, hooks: TimelineHooks) {
    this.hooks = hooks;
    this.root = document.createElement('section');
    this.root.className = 'timeline';
    this.root.setAttribute('aria-label', 'Lines of the scene');
    const head = document.createElement('div');
    head.className = 'timeline-head';
    this.title = document.createElement('b');
    const hint = document.createElement('span');
    hint.className = 'timeline-hint';
    hint.textContent = 'click a column: the script, stage and inspector all jump to it';
    this.count = document.createElement('span');
    this.count.className = 'timeline-count';
    head.append(this.title, hint, this.count);
    const body = document.createElement('div');
    body.className = 'timeline-body';
    this.tracks = document.createElement('div');
    this.tracks.className = 'timeline-tracks';
    this.tracks.setAttribute('aria-hidden', 'true');
    this.scroller = document.createElement('div');
    this.scroller.className = 'timeline-scroll';
    this.lane = document.createElement('div');
    this.lane.className = 'timeline-lane';
    this.lane.setAttribute('role', 'list');
    this.scroller.append(this.lane);
    body.append(this.tracks, this.scroller);
    this.root.append(head, body);
    parent.append(this.root);
    this.scroller.addEventListener('scroll', () => { this.scrollX = this.scroller.scrollLeft; this.schedule(); }, { passive: true });
    new ResizeObserver((entries) => {
      this.viewWidth = entries[0]?.contentRect.width ?? this.viewWidth;
      this.drawn = '';
      this.schedule();
    }).observe(this.scroller);
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
    // A track for each character who comes on stage, in order of appearance.
    const seen: string[] = [];
    for (const b of this.beats) for (const tag of Object.keys(b.cast)) if (!seen.includes(tag)) seen.push(tag);
    this.cast = seen;
    this.hasBg = this.beats.some((b) => b.bg);
    this.title.textContent = label ? `Lines in ${label.name}` : 'Lines';
    this.tracks.replaceChildren(...this.trackNames().map((t) => {
      const d = document.createElement('div');
      d.className = `track-name track-${t.kind}`;
      const dot = document.createElement('i');
      d.append(dot, t.name);
      return d;
    }));
    this.current = -1;
    this.playing = -1;
    this.drawn = '';
    this.updateCount();
    this.schedule();
  }

  get scene(): string | null {
    return this.label;
  }

  /** The file the scene shown is in (undefined: story.vn). */
  get sceneFile(): string | undefined {
    return this.file;
  }

  /** The column the arrows and the stage tools go by: the cursor's, else the game's. */
  private get here(): number {
    return this.current >= 0 ? this.current : this.playing;
  }

  /** How a character stands at the cursor's line, or the game's (null: not on stage there). */
  pose(tag: string): Pose | null {
    return this.beats[this.playing >= 0 ? this.playing : this.current]?.cast[tag] ?? null;
  }

  /** The line of the column before or after the cursor's (for the top bar's arrows), or null at an end. */
  neighbour(step: -1 | 1): number | null {
    const i = this.here < 0 && step < 0 ? -1 : this.here + step;
    return i >= 0 && i < this.beats.length ? this.beats[i]!.line : null;
  }

  /** The column a line belongs to: what a line does leads up to the next line of dialogue, so the first beat at or after it. */
  private columnOf(line: number | null): number {
    if (line === null || !this.beats.length) return -1;
    let lo = 0, hi = this.beats.length - 1, at = this.beats.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.beats[mid]!.line >= line) { at = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return at;
  }

  /** The cursor is on `line` (null: it's in another scene): mark the column it belongs to, and keep it in view. */
  setCursor(line: number | null): void {
    const at = this.columnOf(line);
    if (at === this.current) return;
    const before = this.current;
    this.current = at;
    this.updateCount();
    this.mark('current', before, at);
    this.reveal(at);
  }

  /** The game is showing `line` of this scene (null: it's elsewhere): mark its column, as the script marks the line. */
  setPlaying(line: number | null, scroll: boolean): void {
    const at = this.columnOf(line);
    if (at === this.playing) return;
    const before = this.playing;
    this.playing = at;
    this.mark('playing', before, at);
    if (this.current < 0) this.updateCount();
    if (scroll) this.reveal(at);
  }

  /** Only the marked columns change; the rest stay as drawn. */
  private mark(cls: string, before: number, at: number): void {
    for (const i of [before, at]) this.lane.querySelector(`[data-index="${i}"]`)?.classList.toggle(cls, i === at);
  }

  private reveal(at: number): void {
    if (at < 0) return;
    const left = at * this.col, right = left + this.col;
    if (left < this.scrollX || right > this.scrollX + this.viewWidth) {
      this.scrollX = Math.max(0, left - this.viewWidth / 2 + this.col / 2);
      this.scroller.scrollLeft = this.scrollX;
      this.schedule();
    }
  }

  private trackNames(): { name: string; kind: string }[] {
    if (!this.label) return [];
    const shown = this.cast.slice(0, MAX_CAST).map((tag, i) => ({
      name: i === MAX_CAST - 1 && this.cast.length > MAX_CAST ? `${this.hooks.nameOf?.(tag) ?? tag} +${this.cast.length - MAX_CAST}` : this.hooks.nameOf?.(tag) ?? tag,
      kind: 'cast',
    }));
    return [
      { name: 'Line', kind: 'line' },
      { name: 'Dialogue', kind: 'say' },
      ...shown,
      ...(this.hasBg ? [{ name: 'Background', kind: 'bg' }] : []),
      { name: 'Music', kind: 'music' },
      { name: 'Branches', kind: 'branch' },
    ];
  }

  private updateCount(): void {
    this.count.textContent = this.beats.length ? `${Math.max(0, this.here) + 1} / ${this.beats.length}` : '';
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  /** Draw the columns in view (and a few either side). */
  private draw(): void {
    const width = this.viewWidth;
    // Few lines fill the width; many get the narrowest column and scroll.
    this.col = Math.max(MIN_COL, this.beats.length ? Math.floor(width / this.beats.length) : MIN_COL);
    this.lane.style.width = `${this.beats.length * this.col}px`;
    const first = Math.max(0, Math.floor(this.scrollX / this.col) - SPARE);
    const last = Math.min(this.beats.length, Math.ceil((this.scrollX + width) / this.col) + SPARE);
    const key = `${first}:${last}:${this.col}`;
    if (key === this.drawn) return;
    this.drawn = key;
    if (!this.beats.length) {
      const empty = document.createElement('p');
      empty.className = 'timeline-empty';
      empty.textContent = this.label ? 'This scene has no lines yet.' : 'Put the cursor in a scene to see its lines here.';
      this.lane.replaceChildren(empty);
      return;
    }
    const cols: HTMLElement[] = [];
    for (let i = first; i < last; i++) cols.push(this.column(this.beats[i]!, i));
    this.lane.replaceChildren(...cols);
  }

  private column(b: Beat, i: number): HTMLElement {
    const col = document.createElement('div');
    col.className = `timeline-col kind-${b.kind}${i === this.current ? ' current' : ''}${i === this.playing ? ' playing' : ''}`;
    col.style.left = `${i * this.col}px`;
    col.style.width = `${this.col}px`;
    col.dataset.line = String(b.line);
    col.dataset.index = String(i);
    col.setAttribute('role', 'listitem');

    const num = document.createElement('button');
    num.type = 'button';
    num.className = 'timeline-num';
    num.dataset.line = String(b.line);
    num.title = `Go to line ${b.line}`;
    num.textContent = `${i + 1} · L${b.line}`;
    col.append(num);

    // Dialogue: a clip in the speaker's colour.
    const say = cell('say');
    const clipEl = document.createElement('span');
    clipEl.className = 'tl-clip';
    if (b.kind === 'menu') { clipEl.classList.add('is-menu'); clipEl.textContent = 'menu'; }
    else if (b.kind === 'end') { clipEl.classList.add('is-end'); clipEl.textContent = 'end of scene'; }
    else if (b.who) {
      clipEl.textContent = b.who;
      const c = this.hooks.colorOf(b.who);
      if (c) clipEl.style.background = c;
    } else { clipEl.classList.add('is-narration'); clipEl.textContent = 'narration'; }
    if (b.depth) say.style.setProperty('--depth', String(b.depth));
    say.title = b.kind === 'menu' ? `Choice: ${b.text}` : b.who ? `${b.who}: ${b.text}` : b.text;
    say.append(clipEl);
    col.append(say);

    // Each character: a bar while they're on stage, with their look and place.
    this.cast.slice(0, MAX_CAST).forEach((tag, n) => {
      const c = cell('cast');
      const tags = n === MAX_CAST - 1 ? this.cast.slice(n) : [tag];
      const on = tags.map((t) => [t, b.cast[t]] as const).filter(([, p]) => p);
      if (on.length) {
        const bar = document.createElement('span');
        bar.className = 'tl-bar';
        bar.textContent = on.map(([t, p]) => `${tags.length > 1 ? `${t} ` : ''}${[p!.look, p!.at].filter(Boolean).join(' · ')}`).join(', ');
        c.title = bar.textContent;
        c.append(bar);
      }
      col.append(c);
    });

    if (this.hasBg) {
      const c = cell('bg');
      if (b.bg) {
        const bar = document.createElement('span');
        bar.className = `tl-bar${b.bgChanged ? ' starts' : ''}`;
        bar.textContent = b.bgChanged || i === 0 ? b.bg : '';
        c.title = b.bg;
        c.append(bar);
      }
      col.append(c);
    }

    const music = cell('music');
    if (b.music) {
      const bar = document.createElement('span');
      bar.className = `tl-bar${b.musicChanged ? ' starts' : ''}`;
      bar.textContent = b.musicChanged || i === 0 ? b.music : '';
      music.title = b.music;
      music.append(bar);
    }
    col.append(music);

    const branch = cell('branch');
    if (b.branch.length) {
      const chip = document.createElement('span');
      chip.className = 'tl-chip';
      chip.textContent = b.branch[0]!;
      branch.title = b.branch.join('\n');
      branch.append(chip);
      if (b.branch.length > 1) {
        const more = document.createElement('span');
        more.className = 'tl-more';
        more.textContent = `+${b.branch.length - 1}`;
        branch.append(more);
      }
    }
    col.append(branch);
    return col;
  }
}

function cell(kind: string): HTMLElement {
  const d = document.createElement('div');
  d.className = `timeline-cell cell-${kind}`;
  return d;
}

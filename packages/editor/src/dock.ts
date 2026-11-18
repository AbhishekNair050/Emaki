/**
 * The left dock (D-065): every scene of the story, and the route the editor
 * plays by. Picking an ending's route sets the variables every "play from
 * here" uses, in every workspace, highlights it on the flowchart and dims the
 * scenes it doesn't pass through. A second tab holds the asset browser.
 */

/** The height of a scene's row in the list. */
const ROW = 29;
const ROUTES_KEY = 'emaki-editor:routes';

export interface DockScene {
  label: string;
  kind: 'start' | 'scene' | 'ending';
}

export interface DockEnding {
  id: string;
  title: string;
  /** What leads there (the conditions on the way in), or a count of choices. */
  detail: string;
  found: boolean;
  /** Why it isn't found (never reached, or the search ran out of time). */
  missing?: string;
}

export interface DockHooks {
  reveal(label: string): void;
  /** An ending's route was picked (null: none). */
  pickRoute(id: string | null): void;
  searchAgain(): void;
}

export class Dock {
  readonly assetsHost: HTMLElement;
  private readonly hooks: DockHooks;
  private readonly list: HTMLElement;
  private readonly endings: HTMLElement;
  private readonly status: HTMLElement;
  private readonly inner: HTMLElement;
  private scenes: DockScene[] = [];
  private index = new Map<string, number>();
  private signature = '';
  private frame = 0;
  private drawn = '';
  /** The list's height and scroll, kept from its own events (reading them on a cursor move would lay the page out). */
  private viewHeight = 0;
  private scrollY = 0;
  private cursor: string | null = null;
  private route: Set<string> | null = null;
  private selected: string | null = null;

  constructor(parent: HTMLElement, hooks: DockHooks) {
    this.hooks = hooks;
    const root = el('aside', 'dock');
    root.setAttribute('aria-label', 'Story');

    const tabs = el('div', 'dock-tabs');
    tabs.setAttribute('role', 'tablist');
    const story = el('div', 'dock-panel');
    this.assetsHost = el('div', 'dock-panel assets-host');
    this.assetsHost.hidden = true;
    const tab = (name: string, panel: HTMLElement, on: boolean) => {
      const b = button('dock-tab', () => {
        for (const t of tabs.children) t.setAttribute('aria-selected', String(t === b));
        story.hidden = panel !== story;
        this.assetsHost.hidden = panel !== this.assetsHost;
      }, name);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(on));
      return b;
    };
    tabs.append(tab('Scenes', story, true), tab('Assets', this.assetsHost, false));

    // Only the rows in view are drawn: a long game has thousands of scenes.
    this.list = el('div', 'dock-scenes');
    this.list.setAttribute('role', 'list');
    this.inner = el('div', 'dock-scenes-inner');
    this.list.append(this.inner);
    this.list.addEventListener('scroll', () => { this.scrollY = this.list.scrollTop; this.schedule(); }, { passive: true });
    new ResizeObserver((e) => { this.viewHeight = e[0]?.contentRect.height ?? 0; this.drawn = ''; this.schedule(); }).observe(this.list);
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-label]');
      if (b) this.hooks.reveal(b.dataset.label!);
    });
    // "Route to" folds away, giving the scene list the whole height.
    const routeHead = el('div', 'dock-head');
    const fold = button('dock-fold', () => setFolded(fold.getAttribute('aria-expanded') === 'true'));
    fold.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    fold.append('Route to');
    const again = button('dock-again', () => this.hooks.searchAgain(), 'Search again');
    again.title = 'Play the story again, trying every choice';
    routeHead.append(fold, again);
    const setFolded = (folded: boolean) => {
      story.classList.toggle('routes-folded', folded);
      fold.setAttribute('aria-expanded', String(!folded));
      fold.title = folded ? 'Show the endings and their routes' : 'Hide the endings and their routes';
      try { localStorage.setItem(ROUTES_KEY, folded ? 'folded' : 'open'); } catch { /* storage unavailable */ }
    };
    this.endings = el('div', 'dock-endings');
    this.endings.setAttribute('role', 'listbox');
    this.endings.setAttribute('aria-label', 'Endings');
    this.status = el('p', 'dock-status');
    this.status.setAttribute('role', 'status');
    const note = el('p', 'dock-note', 'The route sets the variables used when you play from any line, and in the stage view.');
    story.append(this.list, routeHead, this.endings, this.status, note);
    let folded = false;
    try { folded = localStorage.getItem(ROUTES_KEY) === 'folded'; } catch { /* storage unavailable */ }
    setFolded(folded);
    root.append(tabs, story, this.assetsHost);
    parent.append(root);
  }

  /** The story's scenes (drawn again only when the list changes). */
  setScenes(scenes: DockScene[]): void {
    const signature = scenes.map((s) => `${s.label}:${s.kind}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.scenes = scenes;
    this.index = new Map(scenes.map((s, i) => [s.label, i]));
    this.inner.style.height = `${scenes.length * ROW}px`;
    this.drawn = '';
    this.schedule();
  }

  /** The scene the cursor is in: marked, and scrolled into view. */
  setCursor(label: string | null): void {
    if (label === this.cursor) return;
    this.cursor = label;
    const i = this.index.get(label ?? '');
    if (i !== undefined && this.viewHeight) {
      const top = i * ROW;
      if (top < this.scrollY || top + ROW > this.scrollY + this.viewHeight) {
        this.scrollY = Math.max(0, top - this.viewHeight / 2);
        this.list.scrollTop = this.scrollY;
      }
    }
    this.drawn = '';
    this.schedule();
  }

  /** The scenes on the chosen route (null: none chosen). */
  setRoute(scenes: string[] | null): void {
    const same = scenes ? !!this.route && this.route.size === new Set(scenes).size && scenes.every((s) => this.route!.has(s)) : !this.route;
    if (same) return;
    this.route = scenes ? new Set(scenes) : null;
    this.list.classList.toggle('has-route', !!this.route);
    this.drawn = '';
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw(): void {
    const first = Math.max(0, Math.floor(this.scrollY / ROW) - 6);
    const last = Math.min(this.scenes.length, Math.ceil((this.scrollY + (this.viewHeight || 600)) / ROW) + 6);
    const key = `${first}:${last}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const rows: HTMLElement[] = [];
    for (let i = first; i < last; i++) {
      const s = this.scenes[i]!;
      const b = button(`dock-scene kind-${s.kind}${s.label === this.cursor ? ' current' : ''}${this.route?.has(s.label) ? ' on-route' : ''}`, () => {}, '');
      b.dataset.label = s.label;
      b.style.top = `${i * ROW}px`;
      b.setAttribute('role', 'listitem');
      b.title = `${s.label}: show it in the script`;
      b.append(el('i', 'dot'), el('span', 'name', s.label), el('i', 'route-dot'));
      rows.push(b);
    }
    this.inner.replaceChildren(...rows);
  }

  setSearching(): void {
    this.status.textContent = 'Searching for routes…';
  }

  setEndings(endings: DockEnding[], selected: string | null, status: string): void {
    this.selected = selected;
    this.status.textContent = status;
    this.endings.replaceChildren(...endings.map((e) => {
      const b = button(`dock-ending${e.found ? '' : ' missing'}`, () => this.hooks.pickRoute(this.selected === e.id ? null : e.id));
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(e.id === selected));
      b.disabled = !e.found;
      b.append(el('span', 'ending-title', e.title), el('span', 'ending-detail', e.found ? e.detail : e.missing ?? 'not found'));
      return b;
    }));
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

/**
 * Staging in the game (Stage workspace, D-065): pick a character, then move,
 * scale or turn them by dragging; the line that showed them is rewritten
 * (`at`, `zoom`, `rotate`). The picked character gets a frame with handles
 * and a label; the guides draw the thirds and the safe area over the stage.
 *
 * A press on a character picks it (and doesn't reach the game); a press
 * anywhere else still plays the game on. The frame follows the character
 * for a moment after each change (characters glide into place), then stays
 * still, so an idle stage costs nothing.
 */

export type Tool = 'move' | 'scale' | 'rotate';
export type StageChange = { at: string } | { zoom: number } | { rotate: number };

export interface StageToolsHooks {
  /** Staging is on (the Stage workspace is showing). */
  enabled(): boolean;
  /** How a character stands now, for the frame's label (`stern · right`), and their zoom and turn. */
  pose(tag: string): { text: string; zoom: number; rotate: number } | null;
  /** A drag ended: rewrite the line that showed the character; returns what happened, for a note. */
  changed(tag: string, change: StageChange): string;
  /** A character was picked (or none). */
  picked?(tag: string | null): void;
}

/** How far the pointer moves before a press becomes a drag. */
const DRAG_PX = 4;
/** How close (in percent of the stage) a drop must be to a named place to snap to it. */
const SNAP = 3;
/** How long the frame follows a character after a change (their move is animated). */
const FOLLOW_MS = 700;

const HINTS: Record<Tool, (who: string) => string> = {
  move: (who) => `Drag ${who} to move them. The show line is rewritten.`,
  scale: (who) => `Drag ${who} up or down to size them (zoom).`,
  rotate: (who) => `Drag ${who} sideways to turn them (rotate).`,
};

export class StageTools {
  private readonly host: HTMLElement;
  private readonly hooks: StageToolsHooks;
  private readonly frame: HTMLElement;
  private readonly frameLabel: HTMLElement;
  private readonly guides: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly guideButton: HTMLButtonElement;
  private tool: Tool = 'move';
  private showGuides = false;
  private selected: string | null = null;
  private followUntil = 0;
  private raf = 0;

  constructor(host: HTMLElement, toolbar: HTMLElement, hooks: StageToolsHooks) {
    this.host = host;
    this.hooks = hooks;
    this.frame = div('stage-frame');
    for (const h of ['tl', 'tr', 'bl', 'br']) this.frame.append(div(`handle ${h}`));
    this.frame.append(div('pivot'));
    this.frameLabel = div('stage-frame-label');
    this.frame.append(this.frameLabel);
    this.guides = div('stage-guides');
    for (const g of ['v1', 'v2', 'h1', 'h2', 'safe']) this.guides.append(div(g));
    this.badge = div('stage-drag-badge');
    this.badge.setAttribute('role', 'status');

    // The toolbar: the tools, the guides, and what a drag will do.
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Tool');
    const icons: Record<Tool, string> = {
      move: 'M7 1v12M1 7h12M7 1 5 3M7 1l2 2M13 7l-2-2M13 7l-2 2',
      scale: 'M2 12 12 2M12 2H7M12 2v5M2 12h5M2 12V7',
      rotate: 'M12 7a5 5 0 1 1-2-4M12 1v3H9',
    };
    for (const t of ['move', 'scale', 'rotate'] as Tool[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="${icons[t]}" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      b.append(t[0]!.toUpperCase() + t.slice(1));
      b.addEventListener('click', () => this.setTool(t));
      this.toolButtons.set(t, b);
      seg.append(b);
    }
    this.guideButton = document.createElement('button');
    this.guideButton.type = 'button';
    this.guideButton.className = 'toggle';
    this.guideButton.textContent = 'Thirds and safe area';
    this.guideButton.addEventListener('click', () => {
      this.showGuides = !this.showGuides;
      this.update();
    });
    this.hint = document.createElement('span');
    this.hint.className = 'stage-hint';
    toolbar.append(seg, this.guideButton, this.hint);
    this.setTool('move');

    // Capture: the game must not see a press on a character.
    host.addEventListener('pointerdown', (e) => this.down(e), true);
    host.addEventListener('click', (e) => { if (this.swallowClick) { e.stopPropagation(); e.preventDefault(); this.swallowClick = false; } }, true);
    new ResizeObserver(() => this.update()).observe(host);
  }

  private swallowClick = false;

  setTool(t: Tool): void {
    this.tool = t;
    for (const [k, b] of this.toolButtons) b.setAttribute('aria-pressed', String(k === t));
    this.updateHint();
  }

  /** Pick a character (from the inspector's line, or a press on the stage). */
  select(tag: string | null): void {
    if (tag === this.selected) return;
    this.selected = tag;
    this.updateHint();
    this.follow();
  }

  /** The game changed: the frame follows the character into place. */
  follow(): void {
    this.followUntil = performance.now() + FOLLOW_MS;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    this.raf = 0;
    this.update();
    if (performance.now() < this.followUntil) this.raf = requestAnimationFrame(() => this.tick());
  }

  /** Place the frame and the guides over the stage. */
  update(): void {
    const on = this.hooks.enabled();
    this.guideButton.setAttribute('aria-pressed', String(this.showGuides));
    const stage = this.host.querySelector<HTMLElement>('.stage');
    // The player empties its host when it (re)starts, so the overlays go back in when needed.
    for (const o of [this.guides, this.frame]) if (!o.isConnected) this.host.append(o);
    const hostRect = this.host.getBoundingClientRect();
    if (on && this.showGuides && stage) {
      place(this.guides, stage.getBoundingClientRect(), hostRect);
      this.guides.hidden = false;
    } else this.guides.hidden = true;
    const sprite = on && stage && this.selected ? this.spriteOf(stage, this.selected) : null;
    if (!sprite) { this.frame.hidden = true; return; }
    // Only the part on the stage: a character zoomed past its edge is framed where it is seen.
    const r = sprite.getBoundingClientRect();
    const st = stage!.getBoundingClientRect();
    const left = Math.max(r.left, st.left), top = Math.max(r.top, st.top);
    place(this.frame, new DOMRect(left, top, Math.max(0, Math.min(r.right, st.right) - left), Math.max(0, Math.min(r.bottom, st.bottom) - top)), hostRect);
    this.frame.hidden = false;
    const pose = this.hooks.pose(this.selected!);
    this.frameLabel.textContent = `${this.selected}${pose?.text ? ` ${pose.text}` : ''}`;
  }

  private updateHint(): void {
    this.hint.textContent = HINTS[this.tool](this.selected ?? 'a character');
  }

  private spriteOf(stage: HTMLElement, tag: string): HTMLElement | null {
    const s = [...stage.querySelectorAll<HTMLElement>('.sprite:not(.free)')].find((x) => x.dataset.tag === tag);
    return s?.querySelector('img') ?? s ?? null;
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 || !this.hooks.enabled()) return;
    const target = e.target as Element;
    // The text box, menus, buttons and choices are the game's own to click.
    if (target.closest('button, a, input, .textbox, .quickmenu, .overlay.open, .choices, .nvl-page, .screen-layer .called')) return;
    const stage = this.host.querySelector<HTMLElement>('.stage');
    const sprite = stage ? this.spriteAt(stage, e.clientX, e.clientY) : null;
    if (!stage || !sprite) return;
    const tag = sprite.dataset.tag!;
    // A press on a character picks it; the game doesn't see it.
    e.stopPropagation();
    this.swallowClick = true;
    if (tag !== this.selected) { this.select(tag); this.hooks.picked?.(tag); }
    const start = { x: e.clientX, y: e.clientY };
    const pose = this.hooks.pose(tag);
    const zoom0 = pose?.zoom ?? 1;
    const rotate0 = pose?.rotate ?? 0;
    const places = this.places(stage);
    let dragging = false;
    let change: StageChange | null = null;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_PX) return;
      if (!dragging) {
        dragging = true;
        this.host.setPointerCapture(ev.pointerId);
        sprite.classList.add('dragging');
        sprite.style.transformOrigin = '50% 100%';
        if (!this.badge.isConnected) this.host.append(this.badge);
      }
      if (this.tool === 'move') {
        const rect = stage.getBoundingClientRect();
        const pct = Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100));
        const near = Object.entries(places).find(([, x]) => Math.abs(x - pct) <= SNAP);
        change = { at: near ? near[0] : `${Math.round(pct)}%` };
        sprite.style.left = near ? `${near[1]}%` : `${Math.round(pct)}%`;
      } else if (this.tool === 'scale') {
        const z = Math.min(4, Math.max(0.2, Math.round(zoom0 * (1 + (start.y - ev.clientY) / 250) * 20) / 20));
        change = { zoom: z };
        sprite.style.scale = String(z / zoom0);
      } else {
        let deg = Math.round(rotate0 + (ev.clientX - start.x) / 3);
        if (Math.abs(deg) <= 3) deg = 0;
        deg = Math.max(-180, Math.min(180, deg));
        change = { rotate: deg };
        sprite.style.rotate = `${deg - rotate0}deg`;
      }
      this.badge.hidden = false;
      this.badge.textContent = `${tag} · ${'at' in change ? change.at : 'zoom' in change ? `zoom ${change.zoom}` : `rotate ${change.rotate}°`}`;
      const host = this.host.getBoundingClientRect();
      this.badge.style.left = `${ev.clientX - host.left}px`;
      this.badge.style.top = `${ev.clientY - host.top}px`;
      this.update();
    };
    const up = () => {
      this.host.removeEventListener('pointermove', move);
      this.host.removeEventListener('pointerup', up);
      this.host.removeEventListener('pointercancel', up);
      if (!dragging || !change) return;
      sprite.classList.remove('dragging');
      this.badge.textContent = this.hooks.changed(tag, change);
      setTimeout(() => { this.badge.hidden = true; }, 1600);
      this.follow();
    };
    this.host.addEventListener('pointermove', move);
    this.host.addEventListener('pointerup', up);
    this.host.addEventListener('pointercancel', up);
  }

  /** The front-most character under a point (characters ignore the pointer, so this looks at their boxes). */
  private spriteAt(stage: HTMLElement, x: number, y: number): HTMLElement | null {
    const sprites = [...stage.querySelectorAll<HTMLElement>('.sprite:not(.free)')].reverse();
    for (const s of sprites) {
      const r = (s.querySelector('img') ?? s).getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && s.dataset.tag) return s;
    }
    return null;
  }

  /** Where the named places are on this stage, in percent (the game's theme can move them). */
  private places(stage: HTMLElement): Record<string, number> {
    const css = getComputedStyle(stage);
    const out: Record<string, number> = {};
    for (const p of ['left', 'center', 'right']) {
      const v = parseFloat(css.getPropertyValue(`--pos-${p}`));
      if (Number.isFinite(v)) out[p] = v;
    }
    return out;
  }
}

function div(cls: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function place(el: HTMLElement, r: DOMRect, host: DOMRect): void {
  el.style.left = `${r.left - host.left}px`;
  el.style.top = `${r.top - host.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
}

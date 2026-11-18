/**
 * Placing characters by dragging them in the game (Stage workspace, D-065).
 *
 * A drag that starts on a character moves it across the stage as the pointer
 * moves, snapping to the named places; letting go asks the editor to rewrite
 * the `show` line that put it there. A click without a drag still reaches the
 * game, so it plays on as usual.
 */

export interface StageDragHooks {
  /** Dragging is on (the Stage workspace is showing). */
  enabled(): boolean;
  /** A character was dropped at `at` (`left`, `center`, `right` or a percentage); returns what happened, for a note. */
  placed(tag: string, at: string): string;
}

/** How far the pointer moves before a press on a character becomes a drag. */
const DRAG_PX = 5;
/** How close (in percent of the stage) a drop must be to a named place to snap to it. */
const SNAP = 3;

export class StageDrag {
  private readonly host: HTMLElement;
  private readonly hooks: StageDragHooks;
  private readonly badge: HTMLElement;

  constructor(host: HTMLElement, hooks: StageDragHooks) {
    this.host = host;
    this.hooks = hooks;
    this.badge = document.createElement('div');
    this.badge.className = 'stage-drag-badge';
    this.badge.setAttribute('role', 'status');
    this.badge.hidden = true;
    // Capture: the game must not see a press that becomes a drag.
    host.addEventListener('pointerdown', (e) => this.down(e), true);
    host.classList.add('stage-drag');
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
    const startX = e.clientX;
    let dragging = false;
    let at = '';
    const places = this.places(stage);
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) < DRAG_PX) return;
      if (!dragging) {
        dragging = true;
        this.host.setPointerCapture(ev.pointerId);
        sprite.classList.add('dragging');
        // The player empties its host when it (re)starts, so the badge goes in when needed.
        if (!this.badge.isConnected) this.host.append(this.badge);
      }
      const rect = stage.getBoundingClientRect();
      const pct = Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100));
      const near = Object.entries(places).find(([, x]) => Math.abs(x - pct) <= SNAP);
      at = near ? near[0] : `${Math.round(pct)}%`;
      sprite.style.left = near ? `${near[1]}%` : `${Math.round(pct)}%`;
      this.badge.hidden = false;
      this.badge.textContent = `${tag} · ${at}`;
      const host = this.host.getBoundingClientRect();
      this.badge.style.left = `${ev.clientX - host.left}px`;
      this.badge.style.top = `${ev.clientY - host.top}px`;
    };
    const up = () => {
      this.host.removeEventListener('pointermove', move);
      this.host.removeEventListener('pointerup', up);
      this.host.removeEventListener('pointercancel', up);
      if (!dragging) return;
      sprite.classList.remove('dragging');
      // The click that ends a drag isn't a click on the game.
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      this.host.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => this.host.removeEventListener('click', swallow, true), 0);
      this.badge.textContent = this.hooks.placed(tag, at);
      setTimeout(() => { this.badge.hidden = true; }, 1600);
    };
    this.host.addEventListener('pointermove', move);
    this.host.addEventListener('pointerup', up);
    this.host.addEventListener('pointercancel', up);
  }

  /** The front-most character under a point (characters ignore the pointer, so this looks at their boxes). */
  private spriteAt(stage: HTMLElement, x: number, y: number): HTMLElement | null {
    const sprites = [...stage.querySelectorAll<HTMLElement>('.sprite:not(.free)')].reverse();
    for (const s of sprites) {
      const img = s.querySelector('img');
      const r = (img ?? s).getBoundingClientRect();
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

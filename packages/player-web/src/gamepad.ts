/**
 * Gamepad controls (standard mapping): the d-pad or left stick moves between
 * buttons on screen, A presses one (or goes on with the story), B goes back
 * out of a menu, Start opens the menu, LB goes back a line and RB goes on.
 *
 * Polls only while a pad is connected. Moving picks the nearest control in
 * that direction, so any screen layout, the game's own included, works
 * without a focus order.
 */

export interface GamepadActions {
  /** Where the controls are now: the open menu, or the whole stage. */
  scope(): HTMLElement;
  /** A pressed with nothing focused: go on with the story. */
  advance(): void;
  cancel(): void;
  menu(): void;
  back(): void;
}

const A = 0, B = 1, LB = 4, RB = 5, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const REPEAT_FIRST = 400;
const REPEAT_EVERY = 140;
const STICK = 0.5;

type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'button, input, select, [tabindex]:not([tabindex="-1"])';

function usable(e: HTMLElement): boolean {
  if ((e as HTMLButtonElement).disabled || e.closest('[hidden], [inert]')) return false;
  const r = e.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = getComputedStyle(e);
  return s.visibility !== 'hidden' && s.display !== 'none' && s.pointerEvents !== 'none';
}

/** The control nearest to `from` in direction `dir`, among `all`. */
export function nearest(from: DOMRect | null, dir: Dir, all: HTMLElement[]): HTMLElement | null {
  if (!from) return all[0] ?? null;
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  const [dx, dy] = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const e of all) {
    const r = e.getBoundingClientRect();
    const ex = r.left + r.width / 2 - cx, ey = r.top + r.height / 2 - cy;
    const along = ex * dx + ey * dy;
    if (along <= 1) continue;
    const across = Math.abs(ex * dy - ey * dx);
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}

export function watchGamepads(act: GamepadActions): () => void {
  let frame = 0;
  const held = new Map<number, number>(); // button -> time it was first pressed (or last repeated)

  const move = (dir: Dir) => {
    const scope = act.scope();
    const active = document.activeElement instanceof HTMLElement && scope.contains(document.activeElement) ? document.activeElement : null;
    // Sliders take left and right.
    if (active instanceof HTMLInputElement && active.type === 'range' && (dir === 'left' || dir === 'right')) {
      if (dir === 'left') active.stepDown(); else active.stepUp();
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const all = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e !== active && usable(e));
    const next = nearest(active?.getBoundingClientRect() ?? null, dir, all);
    next?.focus();
  };

  const press = (button: number) => {
    switch (button) {
      case A: {
        const f = document.activeElement;
        if (f instanceof HTMLElement && f !== document.body && act.scope().contains(f) && usable(f)) {
          if (f instanceof HTMLInputElement && f.type === 'checkbox') f.click();
          else if (!(f instanceof HTMLInputElement || f instanceof HTMLSelectElement)) f.click();
        } else act.advance();
        break;
      }
      case B: act.cancel(); break;
      case START: act.menu(); break;
      case LB: act.back(); break;
      case RB: act.advance(); break;
      case UP: move('up'); break;
      case DOWN: move('down'); break;
      case LEFT: move('left'); break;
      case RIGHT: move('right'); break;
    }
  };

  const poll = (now: number) => {
    frame = 0;
    const pads = navigator.getGamepads?.() ?? [];
    const down = new Set<number>();
    for (const pad of pads) {
      if (!pad) continue;
      pad.buttons.forEach((b, i) => { if (b.pressed) down.add(i); });
      const [x = 0, y = 0] = pad.axes;
      if (y < -STICK) down.add(UP);
      if (y > STICK) down.add(DOWN);
      if (x < -STICK) down.add(LEFT);
      if (x > STICK) down.add(RIGHT);
    }
    for (const b of [...held.keys()]) if (!down.has(b)) held.delete(b);
    for (const b of down) {
      const since = held.get(b);
      if (since === undefined) { held.set(b, now + REPEAT_FIRST - REPEAT_EVERY); press(b); }
      else if (b >= UP && b <= RIGHT && now - since >= REPEAT_EVERY) { held.set(b, now); press(b); }
    }
    if (pads.some(Boolean)) frame = requestAnimationFrame(poll);
  };

  const start = () => { if (!frame) frame = requestAnimationFrame(poll); };
  window.addEventListener('gamepadconnected', start);
  if ((navigator.getGamepads?.() ?? []).some(Boolean)) start();
  return () => {
    window.removeEventListener('gamepadconnected', start);
    cancelAnimationFrame(frame);
  };
}

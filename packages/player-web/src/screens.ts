/**
 * Draws a game's own screens (`screen title:` in the script) as DOM.
 *
 * Positions and sizes arrive as percentages of the screen and become container
 * query units of the stage (`cqw`, `cqh`), so they stay relative to the whole
 * screen at any depth and scale with the window. Elements without `at` flow in
 * their parent (a centred column at the top level and in a box).
 *
 * The renderer only builds elements; what buttons do, which text a translation
 * gives and what variables hold all come from the host (the Player).
 */
import { evaluate, truthy, type CompiledScreen, type CompiledScreenItem, type ScreenAction, type Span, type Value } from '@emaki/format';

export interface ScreenHost {
  /** Variable values for conditions and {variables} in text. */
  vars(): Readonly<Record<string, Value>>;
  /** The text with id `id` in the chosen language, if translated. */
  translated(id: string): { text: string; spans?: Span[] } | null;
  /** Styled text as nodes (the player's own rendering of spans). */
  nodes(text: string, spans: Span[] | undefined): Node[];
  /** URL of an image path (the chosen language's version if any). */
  url(path: string): string;
  /** The canvas the screens are drawn on (`canvas:` in the header), for an image's natural size. */
  canvas: [number, number] | null;
  /** Whether a button with these actions can do anything now (Continue with no saves can't). */
  enabled(actions: readonly ScreenAction[]): boolean;
  run(actions: readonly ScreenAction[]): void;
}

export function renderScreen(name: string, screen: CompiledScreen, host: ScreenHost): HTMLElement {
  const root = document.createElement('div');
  root.className = `screen-root screen-${name}`;
  root.dataset.screen = name;
  const vars = host.vars();
  for (const it of screen.items) {
    const node = renderItem(it, host, vars);
    if (node) root.append(node);
  }
  return root;
}

function interpolate(text: string, vars: Readonly<Record<string, Value>>): string {
  return text.replace(/\{\{|\}\}|\{([A-Za-z_]\w*)\}/g, (m, name: string | undefined) =>
    m === '{{' ? '{' : m === '}}' ? '}' : String(vars[name!] ?? m));
}

function visible(it: CompiledScreenItem, vars: Readonly<Record<string, Value>>): boolean {
  if (!it.cond) return true;
  try { return truthy(evaluate(it.cond, vars)); } catch { return false; }
}

/** The element's text in the chosen language, with {variables} filled in. */
function textOf(it: CompiledScreenItem, host: ScreenHost, vars: Readonly<Record<string, Value>>): { text: string; spans?: Span[] } {
  const t = (it.id && host.translated(it.id)) || { text: it.text ?? '', ...(it.spans ? { spans: it.spans } : {}) };
  return { text: interpolate(t.text, vars), ...(t.spans ? { spans: t.spans.map((s) => ({ ...s, text: interpolate(s.text, vars) })) } : {}) };
}

function place(node: HTMLElement, it: CompiledScreenItem): void {
  const s = node.style;
  if (it.x !== undefined && it.y !== undefined) {
    s.position = 'absolute';
    s.left = `${it.x}cqw`;
    s.top = `${it.y}cqh`;
    if (it.anchor) s.translate = `${-it.anchor[0] * 100}% ${-it.anchor[1] * 100}%`;
  }
  if (it.w !== undefined) s.width = `${it.w}cqw`;
  if (it.h !== undefined) s.height = `${it.h}cqh`;
  if (it.gap !== undefined) s.gap = `${it.gap}cqh`;
  if (it.className) node.classList.add(...it.className.split(/\s+/));
}

/** A picture at the size it was drawn on the canvas (unless the screen gives one). */
function picture(src: string, it: CompiledScreenItem, host: ScreenHost): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.draggable = false;
  if (it.w === undefined && it.h === undefined) {
    const cw = host.canvas?.[0] ?? 1920;
    img.addEventListener('load', () => { img.style.width = `${(img.naturalWidth / cw) * 100}cqw`; }, { once: true });
  } else {
    img.style.width = it.w !== undefined ? '100%' : 'auto';
    img.style.height = it.h !== undefined ? '100%' : 'auto';
  }
  return img;
}

function renderItem(it: CompiledScreenItem, host: ScreenHost, vars: Readonly<Record<string, Value>>): HTMLElement | null {
  if (!visible(it, vars)) return null;
  switch (it.kind) {
    case 'image': {
      const fill = it.x === undefined && it.w === undefined && it.h === undefined;
      const img = picture(host.url(it.image ?? ''), fill ? { ...it, w: 100, h: 100 } : it, host);
      img.className = fill ? 'screen-image screen-fill' : 'screen-image';
      const alt = it.alt !== undefined ? (it.id && host.translated(`${it.id}.alt`)?.text) || it.alt : '';
      img.alt = alt;
      if (!alt) img.setAttribute('aria-hidden', 'true');
      if (!fill) place(img, it);
      else if (it.className) img.classList.add(it.className);
      return img;
    }
    case 'text': {
      const t = textOf(it, host, vars);
      const div = document.createElement('div');
      div.className = 'screen-text';
      div.append(...host.nodes(t.text, t.spans));
      place(div, it);
      return div;
    }
    case 'button': {
      const t = textOf(it, host, vars);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'screen-button';
      if (it.image) {
        // A picture button: the label is its accessible name, the pictures what's seen.
        b.classList.add('picture');
        b.setAttribute('aria-label', t.text);
        b.title = t.text;
        const idle = picture(host.url(it.image), it, host);
        idle.alt = '';
        idle.className = 'idle';
        b.append(idle);
        if (it.hover) {
          const hover = picture(host.url(it.hover), it, host);
          hover.alt = '';
          hover.className = 'hover';
          b.append(hover);
        }
      } else b.append(...host.nodes(t.text, t.spans));
      const actions = it.actions ?? [];
      b.disabled = !host.enabled(actions);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        host.run(actions);
      });
      place(b, it);
      return b;
    }
    case 'row':
    case 'column':
    case 'box': {
      const div = document.createElement('div');
      div.className = `screen-${it.kind}`;
      for (const c of it.children ?? []) {
        const n = renderItem(c, host, vars);
        if (n) div.append(n);
      }
      place(div, it);
      return div;
    }
  }
}

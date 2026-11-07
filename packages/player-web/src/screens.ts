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
  /** The page of this screen's slots or gallery, from 0. */
  page: number;
  /** Save slots: how many there are, what's in one (null: empty), its picture, and whether saving is possible now. */
  slots: {
    count: number;
    info(i: number): { date: string; text: string } | null;
    thumbnail(i: number): HTMLElement | null;
    canSave(): boolean;
    use(kind: 'load' | 'save', i: number): void;
  };
  /** Extras: every gallery image (seen or not), endings and achievements. */
  gallery(): Array<{ name: string; url: string; seen: boolean }>;
  view(name: string): void;
  endings(): Array<{ name: string; reached: boolean }>;
  achievements(): Array<{ name: string; earned: boolean }>;
  /** Player settings by their script name (music_volume, skip_unread, font, ...). */
  settings: {
    /** A toggle asks for on/off, a slider for a number, a choice for one of its options. */
    get(name: string, as: 'slider' | 'toggle' | 'choice'): number | boolean | string;
    set(name: string, value: number | boolean | string): void;
    range(name: string): { min: number; max: number; step: number };
    options(name: string): ReadonlyArray<readonly [string, string]>;
    show(name: string, value: number): string;
  };
  /** Text of the player's own interface (locked "???", "Empty"), in the chosen language. */
  ui(key: 'locked' | 'empty' | 'slot', vars?: Record<string, string | number>): string;
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

/** A grid of `count` cells, `columns` across. */
function grid(it: CompiledScreenItem, cls: string): HTMLElement {
  const div = document.createElement('div');
  div.className = cls;
  div.style.gridTemplateColumns = `repeat(${it.columns ?? it.count ?? 1}, auto)`;
  place(div, it);
  return div;
}

function control(it: CompiledScreenItem, host: ScreenHost, vars: Readonly<Record<string, Value>>, field: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = `screen-${it.kind}`;
  const t = textOf(it, host, vars);
  const name = document.createElement('span');
  name.className = 'screen-label';
  name.append(...host.nodes(t.text, t.spans));
  wrap.append(name, field);
  place(wrap, it);
  return wrap;
}

let controlIds = 0;

function renderItem(it: CompiledScreenItem, host: ScreenHost, vars: Readonly<Record<string, Value>>, slot?: number): HTMLElement | null {
  if (!visible(it, vars)) return null;
  switch (it.kind) {
    case 'slots': {
      const div = grid(it, 'screen-slots');
      const action = it.actions![0]!.do as 'load' | 'save';
      const first = host.page * it.count!;
      for (let k = 0; k < it.count! && first + k < host.slots.count; k++) {
        const i = first + k;
        const info = host.slots.info(i);
        const cellVars = { ...vars, slot_number: i + 1, slot_empty: !info, slot_date: info?.date ?? '', slot_text: info?.text ?? '' };
        const b = document.createElement('button');
        b.type = 'button';
        b.className = info ? 'screen-slot' : 'screen-slot empty';
        b.setAttribute('aria-label', host.ui('slot', { n: i + 1, label: info ? `${info.date} — ${info.text}` : host.ui('empty') }));
        if (it.children?.length) {
          for (const c of it.children) { const n = renderItem(c, host, cellVars, i); if (n) b.append(n); }
        } else {
          // The default cell: the picture, then when and where.
          const pic = host.slots.thumbnail(i);
          if (pic) b.append(pic);
          const cap = document.createElement('span');
          cap.className = 'screen-slot-caption';
          cap.textContent = info ? `${i + 1}. ${info.date}` : `${i + 1}. ${host.ui('empty')}`;
          b.append(cap);
          if (info) { const line = document.createElement('span'); line.className = 'screen-slot-text'; line.textContent = info.text; b.append(line); }
        }
        b.disabled = action === 'load' ? !info : !host.slots.canSave();
        b.addEventListener('click', (e) => { e.stopPropagation(); host.slots.use(action, i); });
        div.append(b);
      }
      return div;
    }
    case 'thumbnail': {
      const pic = slot !== undefined ? host.slots.thumbnail(slot) : null;
      const box = pic ?? document.createElement('div');
      box.classList.add('screen-thumbnail');
      if (!pic) box.classList.add('empty');
      place(box, it);
      return box;
    }
    case 'gallery': {
      const div = grid(it, 'screen-gallery');
      const all = host.gallery();
      const first = host.page * it.count!;
      for (const g of all.slice(first, first + it.count!)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = g.seen ? 'screen-gallery-item' : 'screen-gallery-item locked';
        if (g.seen) {
          const img = document.createElement('img');
          img.src = g.url;
          img.alt = '';
          b.append(img);
          b.setAttribute('aria-label', g.name);
          b.addEventListener('click', (e) => { e.stopPropagation(); host.view(g.name); });
        } else {
          b.textContent = host.ui('locked');
          b.disabled = true;
        }
        div.append(b);
      }
      return div;
    }
    case 'endings':
    case 'achievements': {
      const ul = document.createElement('ul');
      ul.className = `screen-${it.kind}`;
      const list = it.kind === 'endings' ? host.endings().map((e) => ({ name: e.name, done: e.reached })) : host.achievements().map((a) => ({ name: a.name, done: a.earned }));
      for (const e of list) {
        const li = document.createElement('li');
        li.className = e.done ? 'done' : 'locked';
        li.textContent = e.done ? e.name : host.ui('locked');
        ul.append(li);
      }
      place(ul, it);
      return ul;
    }
    case 'slider': {
      const input = document.createElement('input');
      input.type = 'range';
      const r = host.settings.range(it.setting!);
      input.min = String(r.min);
      input.max = String(r.max);
      input.step = String(r.step);
      input.value = String(host.settings.get(it.setting!, 'slider'));
      const out = document.createElement('output');
      out.textContent = host.settings.show(it.setting!, Number(input.value));
      input.addEventListener('input', () => {
        host.settings.set(it.setting!, Number(input.value));
        out.textContent = host.settings.show(it.setting!, Number(input.value));
      });
      const field = document.createElement('span');
      field.className = 'screen-field';
      field.append(input, out);
      return control(it, host, vars, field);
    }
    case 'toggle': {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.role = 'switch';
      input.checked = host.settings.get(it.setting!, 'toggle') === true;
      input.addEventListener('change', () => host.settings.set(it.setting!, input.checked));
      return control(it, host, vars, input);
    }
    case 'choice': {
      const select = document.createElement('select');
      select.id = `screen-choice-${++controlIds}`;
      const cur = String(host.settings.get(it.setting!, 'choice'));
      for (const [value, label] of host.settings.options(it.setting!)) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        o.selected = value === cur;
        select.append(o);
      }
      select.addEventListener('change', () => host.settings.set(it.setting!, select.value));
      return control(it, host, vars, select);
    }
    case 'image': {
      const fill = slot === undefined && it.x === undefined && it.w === undefined && it.h === undefined;
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
        const n = renderItem(c, host, vars, slot);
        if (n) div.append(n);
      }
      place(div, it);
      return div;
    }
  }
}

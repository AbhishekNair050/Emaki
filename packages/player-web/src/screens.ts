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
  /** `entry`: the log entry the button is in, for `voice` and `rewind` there. */
  enabled(actions: readonly ScreenAction[], at?: { entry?: number }): boolean;
  run(actions: readonly ScreenAction[], at?: { entry?: number }): void;
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
    get(name: string, as: 'slider' | 'toggle' | 'choice', character?: string): number | boolean | string;
    set(name: string, value: number | boolean | string, character?: string): void;
    range(name: string): { min: number; max: number; step: number };
    options(name: string): ReadonlyArray<readonly [string, string]>;
    show(name: string, value: number): string;
  };
  /** Text of the player's own interface (locked "???", "Empty"), in the chosen language. */
  ui(key: 'locked' | 'empty' | 'slot', vars?: Record<string, string | number>): string;
  /** The text box's own elements (the line, the name, the side image), placed where `screen textbox` puts them. */
  part?(kind: 'dialogue' | 'speaker' | 'side'): HTMLElement;
  /** Whether a button's action is in effect (auto is on, the setting holds that value, it's the page shown). */
  selected?(actions: readonly ScreenAction[]): boolean;
  /** Play the interface sound for pointing at or clicking a button, if the game has one. */
  sound?(kind: 'hover' | 'click'): void;
  /** Replayable scenes (unlocked once reached) and playing one. */
  replays?(): Array<{ label: string; name: string; image: string | null; unlocked: boolean }>;
  playReplay?(label: string): void;
  /** The music room's tracks (unlocked once heard), and playing (or stopping) one. */
  tracks?(): Array<{ name: string; title: string; unlocked: boolean; playing: boolean }>;
  playTrack?(name: string): void;
  /** A plugin's element for a screen (`@clock face`), or null when it can't make one. */
  pluginElement?(plugin: string, element: string, args: Readonly<Record<string, Value>>): HTMLElement | null;
  /** The lines said so far (oldest first) and the first one a `log` shows. */
  log?: { entries: ReadonlyArray<{ name: string; text: string; voice: boolean }>; first: number };
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

/**
 * A picture button's pictures: the idle one, and those for pointed at,
 * pressed, selected and unusable when the screen gives them. theme-free CSS
 * shows the right one (see style.css).
 */
function pictureStates(b: HTMLElement, it: CompiledScreenItem, host: ScreenHost, label: string, vars?: Readonly<Record<string, Value>>): void {
  b.classList.add('picture');
  b.setAttribute('aria-label', label);
  b.title = label;
  for (const k of ['image', 'hover', 'pressed', 'selected', 'disabled'] as const) {
    if (!it[k]) continue;
    // Slot pictures can differ by place on the page: "ui/slot{slot_cell}.png".
    const img = picture(host.url(vars ? interpolate(it[k]!, vars) : it[k]!), it, host);
    img.alt = '';
    img.className = k === 'image' ? 'idle' : k;
    b.append(img);
  }
}

/** Interface sounds and the selected state, for anything clickable on a screen. */
function wire(b: HTMLButtonElement, actions: readonly ScreenAction[], host: ScreenHost): void {
  const on = host.selected?.(actions) ?? false;
  b.classList.toggle('selected', on);
  if (actions.some((a) => a.do === 'auto' || a.do === 'skip' || a.do === 'setting')) b.setAttribute('aria-pressed', String(on));
  b.addEventListener('pointerenter', () => { if (!b.disabled) host.sound?.('hover'); });
  b.addEventListener('click', () => host.sound?.('click'), { capture: true });
}

let controlIds = 0;

function renderItem(it: CompiledScreenItem, host: ScreenHost, vars: Readonly<Record<string, Value>>, slot?: number, entry?: number): HTMLElement | null {
  if (!visible(it, vars)) return null;
  switch (it.kind) {
    case 'log': {
      // A window of `count` lines of the log, each laid out by the lines under it (`size` is one entry's size).
      const div = document.createElement('div');
      div.className = 'screen-log';
      const log = host.log ?? { entries: [], first: 0 };
      for (let k = 0; k < it.count!; k++) {
        const i = log.first + k;
        const e = log.entries[i];
        if (!e) break;
        const cell = document.createElement('div');
        cell.className = 'screen-log-entry';
        if (it.w !== undefined) cell.style.width = `${it.w}cqw`;
        if (it.h !== undefined) cell.style.height = `${it.h}cqh`;
        const cellVars = { ...vars, log_number: i + 1, log_name: e.name, log_text: e.text, log_voice: e.voice };
        for (const c of it.children ?? []) { const n = renderItem(c, host, cellVars, undefined, i); if (n) cell.append(n); }
        div.append(cell);
      }
      div.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        host.run([{ do: 'scroll', to: ev.deltaY > 0 ? 'down' : 'up' }]);
      }, { passive: false });
      place(div, { ...it, w: undefined, h: undefined });
      return div;
    }
    case 'slots': {
      const div = grid(it, 'screen-slots');
      const action = it.actions![0]!.do as 'load' | 'save';
      const first = host.page * it.count!;
      for (let k = 0; k < it.count! && first + k < host.slots.count; k++) {
        const i = first + k;
        const info = host.slots.info(i);
        const cellVars = { ...vars, slot_number: i + 1, slot_cell: k + 1, slot_empty: !info, slot_date: info?.date ?? '', slot_text: info?.text ?? '' };
        const b = document.createElement('button');
        b.type = 'button';
        b.className = info ? 'screen-slot' : 'screen-slot empty';
        const slotLabel = host.ui('slot', { n: i + 1, label: info ? `${info.date} — ${info.text}` : host.ui('empty') });
        if (it.image) pictureStates(b, { ...it, w: undefined, h: undefined }, host, slotLabel, cellVars);
        b.setAttribute('aria-label', slotLabel);
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
        b.removeAttribute('title');
        wire(b, [], host);
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
    case 'scenes': {
      // Replayable scenes: a picture (when declared) and the name; ??? until reached.
      const div = grid(it, 'screen-scenes');
      const first = host.page * it.count!;
      for (const r of (host.replays?.() ?? []).slice(first, first + it.count!)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = r.unlocked ? 'screen-scene' : 'screen-scene locked';
        if (r.unlocked) {
          if (r.image) {
            const img = document.createElement('img');
            img.src = r.image;
            img.alt = '';
            b.append(img);
          }
          const name = document.createElement('span');
          name.className = 'screen-scene-name';
          name.textContent = r.name;
          b.append(name);
          b.addEventListener('click', (e) => { e.stopPropagation(); host.sound?.('click'); host.playReplay?.(r.label); });
        } else {
          b.textContent = host.ui('locked');
          b.disabled = true;
        }
        div.append(b);
      }
      return div;
    }
    case 'music': {
      // The music room: a button per track (??? until heard); the one playing is selected, and stops when pressed again.
      const div = grid({ ...it, columns: it.columns ?? 1 }, 'screen-music');
      const first = host.page * it.count!;
      for (const t of (host.tracks?.() ?? []).slice(first, first + it.count!)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `screen-track${t.unlocked ? '' : ' locked'}${t.playing ? ' selected' : ''}`;
        b.textContent = t.unlocked ? t.title : host.ui('locked');
        b.disabled = !t.unlocked;
        if (t.unlocked) b.setAttribute('aria-pressed', String(t.playing));
        b.addEventListener('click', (e) => { e.stopPropagation(); host.playTrack?.(t.name); });
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
      input.value = String(host.settings.get(it.setting!, 'slider', it.character));
      const out = document.createElement('output');
      out.textContent = host.settings.show(it.setting!, Number(input.value));
      input.addEventListener('input', () => {
        host.settings.set(it.setting!, Number(input.value), it.character);
        out.textContent = host.settings.show(it.setting!, Number(input.value));
      });
      const field = document.createElement('span');
      field.className = 'screen-field';
      field.append(input, out);
      if (!it.image) return control(it, host, vars, field);
      // A picture slider: the track and knob are the game's art, and the label is for screen readers only.
      // The bar fills up to the value (the empty track is the screen's own art underneath), and the knob rides on it.
      input.classList.add('picture');
      const fill = document.createElement('span');
      fill.className = 'fill';
      fill.style.backgroundImage = `url("${host.url(it.image)}")`;
      const setFill = () => field.style.setProperty('--fill', String((Number(input.value) - r.min) / (r.max - r.min || 1)));
      setFill();
      input.addEventListener('input', setFill);
      field.prepend(fill);
      if (it.knob) {
        input.style.setProperty('--knob', `url("${host.url(it.knob)}")`);
        const k = new Image();
        k.addEventListener('load', () => {
          const cw = host.canvas?.[0] ?? 1920;
          input.style.setProperty('--knob-w', `${(k.naturalWidth / cw) * 100}cqw`);
          input.style.setProperty('--knob-h', `${(k.naturalHeight / cw) * 100}cqw`);
        }, { once: true });
        k.src = host.url(it.knob);
      }
      const wrap = control({ ...it, x: undefined, y: undefined, w: undefined, h: undefined, anchor: undefined }, host, vars, field);
      wrap.classList.add('picture');
      wrap.querySelector('.screen-label')!.classList.add('sr-only');
      out.classList.add('sr-only');
      place(wrap, it);
      return wrap;
    }
    case 'toggle': {
      if (it.image) {
        // A picture toggle (a check box drawn by the game): a button that's selected while on.
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'screen-toggle screen-button';
        pictureStates(b, it, host, textOf(it, host, vars).text, vars);
        const on = host.settings.get(it.setting!, 'toggle', it.character) === true;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', String(on));
        b.addEventListener('pointerenter', () => host.sound?.('hover'));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          host.sound?.('click');
          const now = !(host.settings.get(it.setting!, 'toggle', it.character) === true);
          host.settings.set(it.setting!, now, it.character);
          b.classList.toggle('selected', now);
          b.setAttribute('aria-pressed', String(now));
        });
        place(b, it);
        return b;
      }
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.role = 'switch';
      input.checked = host.settings.get(it.setting!, 'toggle', it.character) === true;
      input.addEventListener('change', () => host.settings.set(it.setting!, input.checked, it.character));
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
    case 'plugin': {
      let args: Record<string, Value>;
      try {
        args = Object.fromEntries(Object.entries(it.args ?? {}).map(([k, e]) => [k, evaluate(e, vars)]));
      } catch {
        return null;
      }
      const node = host.pluginElement?.(it.plugin!, it.element!, args) ?? null;
      if (!node) return null;
      node.classList.add('screen-plugin', `plugin-${it.plugin}`);
      place(node, it);
      return node;
    }
    case 'dialogue':
    case 'speaker':
    case 'side': {
      const node = host.part?.(it.kind);
      if (!node) return null;
      node.removeAttribute('style');
      node.classList.add('screen-part');
      place(node, it);
      return node;
    }
    case 'image': {
      const fill = slot === undefined && it.x === undefined && it.w === undefined && it.h === undefined;
      const img = picture(host.url(interpolate(it.image ?? '', vars)), fill ? { ...it, w: 100, h: 100 } : it, host);
      img.className = fill ? 'screen-image screen-fill' : 'screen-image';
      const alt = it.alt !== undefined ? (it.id && host.translated(`${it.id}.alt`)?.text) || it.alt : '';
      img.alt = interpolate(alt, vars);
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
      // A picture button: the label is its accessible name, the pictures what's seen.
      if (it.image) pictureStates(b, it, host, t.text, vars);
      else b.append(...host.nodes(t.text, t.spans));
      const actions = it.actions ?? [];
      const at = entry !== undefined ? { entry } : undefined;
      b.disabled = !host.enabled(actions, at);
      wire(b, actions, host);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        host.run(actions, at);
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
        const n = renderItem(c, host, vars, slot, entry);
        if (n) div.append(n);
      }
      place(div, it);
      return div;
    }
  }
}

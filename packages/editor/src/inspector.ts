/**
 * The inspector (D-065). In Write and Stage it shows the line under the
 * cursor, with controls for what it does (a character's look, place, size and
 * turn, a background, a transition), the line as it is written, and the
 * story's variables at that point on the chosen route. A change rewrites that
 * one line; the script stays the source of truth. In Story it shows the scene
 * the cursor is in: its picture, how long it is, what it can expect and what
 * it sets, how much a playtest has seen, and the choice the route makes there.
 *
 * It is rebuilt only when the cursor reaches another line or the story is
 * recompiled, and it reads one line, so it costs nothing while typing.
 */
import { TRANSITIONS } from '@emaki/format';
import { inspectLine, looksOf, type InspectedLine, type LineChange } from '@emaki/language';

export interface InspectorHooks {
  /** Rewrite the line with this change; returns why it couldn't be done, or null. */
  change(line: number, change: LineChange): string | null;
  openOnStage(label: string): void;
  openInScript(label: string): void;
}

/** What the story declares, from the last compile that worked. */
export interface Catalog {
  /** Image names (`mira smile`, `kitchen`) and their files under assets/. */
  images: Record<string, string>;
  characters: Record<string, { name: string; color: string | null }>;
}

export interface SceneCard {
  label: string;
  file: string;
  line: number;
  picture: string | null;
  facts: [string, string][];
  /** The choice the chosen route makes in this scene, if it passes through. */
  routeChoice: string | null;
  routeName: string | null;
}

const PLACES = ['left', 'center', 'right'];

export class Inspector {
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly code: HTMLElement;
  private readonly codeBox: HTMLElement;
  private readonly varsBox: HTMLElement;
  private readonly note: HTMLElement;
  private readonly hooks: InspectorHooks;
  private catalog: Catalog = { images: {}, characters: {} };
  private line = 0;
  private lineText: string | null = null;
  private where = '';
  private vars: { title: string; rows: [string, string][] } | null = null;

  constructor(parent: HTMLElement, hooks: InspectorHooks) {
    this.hooks = hooks;
    const root = el('section', 'inspector');
    root.setAttribute('aria-label', 'Inspector');
    const head = el('h2', 'pane-head', 'Inspector');
    this.title = el('span', 'hint');
    head.append(' · ', this.title);
    this.body = el('div', 'inspector-body');
    this.codeBox = el('div', 'inspector-code');
    this.codeBox.append(el('div', 'comment', '# written to the script'));
    this.code = el('div', 'code');
    this.codeBox.append(this.code);
    this.varsBox = el('div', 'inspector-field inspector-vars');
    this.note = el('p', 'inspector-note');
    this.note.setAttribute('role', 'status');
    root.append(head, this.body, this.note);
    parent.append(root);
  }

  /** The story was recompiled: what it declares may have changed. */
  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
    if (this.lineText !== null) this.render();
  }

  /** The cursor is on `line` (1-based), whose text is `text`, in `where` (file and scene, for the heading). */
  showLine(line: number, text: string, where: string): void {
    if (line === this.line && text === this.lineText && where === this.where && this.body.dataset.mode === 'line') return;
    if (line !== this.line) this.say('');
    this.line = line;
    this.lineText = text;
    this.where = where;
    this.render();
  }

  /** The story's variables at the cursor, on the chosen route (null: none to show). */
  setVars(title: string, rows: [string, string][] | null): void {
    this.vars = rows ? { title, rows } : null;
    this.renderVars();
  }

  /** The scene card, for the Story workspace. */
  showScene(card: SceneCard | null): void {
    this.body.dataset.mode = 'scene';
    this.lineText = null;
    this.line = 0;
    this.title.textContent = 'scene';
    this.say('');
    if (!card) {
      this.body.replaceChildren(el('p', 'inspector-empty', 'Put the cursor in a scene, or pick one on the left.'));
      return;
    }
    const pic = el('div', 'scene-picture');
    if (card.picture) {
      const img = document.createElement('img');
      img.src = `./${card.picture}`;
      img.alt = '';
      pic.append(img);
    }
    const name = el('div', 'scene-name');
    name.append(el('b', '', card.label), el('span', '', `${card.file}, line ${card.line}`));
    const facts = el('div', 'kv-list');
    for (const [k, v] of card.facts) facts.append(kv(k, v));
    const out: HTMLElement[] = [pic, name, facts];
    if (card.routeChoice) {
      const r = el('div', 'scene-route');
      r.append(el('span', 'inspector-label', `On the route to ${card.routeName ?? 'the ending'}`), el('span', 'route-choice', `“${card.routeChoice}”`));
      out.push(r);
    }
    const actions = el('div', 'scene-actions');
    actions.append(
      button('primary', () => this.hooks.openOnStage(card.label), 'Open on stage'),
      button('', () => this.hooks.openInScript(card.label), 'Open in script'),
    );
    out.push(actions, el('p', 'inspector-help', 'Play from here picks the variable values from the chosen route, so the scene starts the way a player would reach it.'));
    this.body.replaceChildren(...out);
  }

  private render(): void {
    this.body.dataset.mode = 'line';
    this.title.textContent = 'line';
    const found = this.lineText === null ? null : inspectLine(this.lineText);
    const out: HTMLElement[] = [this.heading(found)];
    if (found) out.push(...this.controls(found));
    this.code.textContent = (this.lineText ?? '').trim() || ' ';
    out.push(this.codeBox, this.varsBox);
    this.body.replaceChildren(...out);
    this.renderVars();
  }

  private renderVars(): void {
    if (!this.vars) { this.varsBox.replaceChildren(); return; }
    this.varsBox.replaceChildren(el('div', 'inspector-label', this.vars.title), ...this.vars.rows.map(([k, v]) => kv(k, v)));
  }

  private heading(found: InspectedLine | null): HTMLElement {
    const h = el('div', 'inspector-what');
    const s = found?.stmt;
    const what = !s ? this.kindOfOther() : s.type === 'show' ? `show · ${s.tag}` : s.type === 'hide' ? `hide · ${s.tag}`
      : s.type === 'scene' ? 'Scene change' : s.who === null ? 'Narration' : `Dialogue · ${this.nameOf(s.who)}`;
    h.append(el('b', '', what), el('span', '', this.where ? `${this.where} · line ${this.line}` : `line ${this.line}`));
    return h;
  }

  private kindOfOther(): string {
    const t = (this.lineText ?? '').trim();
    if (!t) return 'Empty line';
    if (t.startsWith('#')) return 'Comment';
    if (t.startsWith('"') && t.endsWith(':')) return 'Choice';
    const word = /^[A-Za-z_]+/.exec(t)?.[0] ?? '';
    const kinds: Record<string, string> = { label: 'Scene', menu: 'Choice', jump: 'Jump', call: 'Call', set: 'Variable', if: 'Condition', elif: 'Condition', else: 'Condition', play: 'Sound', stop: 'Sound' };
    return kinds[word] ?? 'Line';
  }

  private controls({ stmt }: InspectedLine): HTMLElement[] {
    switch (stmt.type) {
      case 'show':
        return [
          this.looks(stmt.tag, stmt.attrs, `${this.nameOf(stmt.tag)}’s look on this line`),
          this.place(stmt.at),
          this.sizeAndTurn(stmt.props?.zoom?.[0] ?? 1, stmt.props?.rotate ?? 0),
          this.transition(stmt.transition, stmt.duration),
        ];
      case 'say':
        return stmt.who !== null && looksOf(stmt.who, Object.keys(this.catalog.images)).length
          ? [this.looks(stmt.who, stmt.attrs, `${this.nameOf(stmt.who)}’s look on this line`)] : [];
      case 'scene':
        return [this.backgrounds(stmt.image), this.transition(stmt.transition, stmt.duration)];
      case 'hide':
        return [this.transition(stmt.transition, stmt.duration)];
    }
  }

  private nameOf(tag: string): string {
    return this.catalog.characters[tag]?.name ?? tag;
  }

  /** A character's looks as pictures; the current one pressed. */
  private looks(tag: string, attrs: string[], label: string): HTMLElement {
    const field = this.field(label);
    const list = el('div', 'inspector-looks');
    const looks = looksOf(tag, Object.keys(this.catalog.images));
    const current = attrs.join(' ');
    // A look the script uses but no image declares (layered characters, or a typo) is still shown, and kept.
    if (current && !looks.some((l) => l.join(' ') === current)) looks.unshift(attrs);
    if (!looks.length) {
      field.append(el('p', 'inspector-empty', `No images named ${tag} … are declared.`));
      return field;
    }
    for (const look of looks) {
      const name = look.join(' ');
      const b = button('look', () => this.apply({ look }));
      b.setAttribute('aria-pressed', String(name === current));
      const path = this.catalog.images[`${tag} ${name}`];
      const face = el('span', 'face');
      if (path) {
        const img = document.createElement('img');
        img.src = `./${path}`;
        img.alt = '';
        img.loading = 'lazy';
        face.append(img);
      }
      b.append(face, el('span', '', name));
      list.append(b);
    }
    field.append(list);
    return field;
  }

  private place(at: string | null): HTMLElement {
    const field = this.field('Position');
    const row = el('div', 'seg');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Position');
    for (const p of PLACES) {
      const b = button('', () => this.apply({ at: p }), p);
      b.setAttribute('aria-pressed', String((at ?? 'center') === p));
      row.append(b);
    }
    const custom = input('text', at && !PLACES.includes(at) ? at : '', 'or 30%', 'Another place, as a percentage across the screen');
    custom.addEventListener('change', () => {
      const v = custom.value.trim();
      this.apply({ at: v === '' ? null : /^\d+(\.\d+)?$/.test(v) ? `${v}%` : v });
    });
    const wrap = el('div', 'inspector-row');
    wrap.append(row, custom);
    field.append(wrap);
    return field;
  }

  private sizeAndTurn(zoom: number, rotate: number): HTMLElement {
    const field = this.field('Size and turn');
    const row = el('div', 'inspector-row');
    const z = input('number', String(zoom), '1', 'Zoom');
    z.step = '0.05';
    z.min = '0.1';
    z.addEventListener('change', () => this.apply({ zoom: z.value.trim() === '' ? null : Number(z.value) }));
    const r = input('number', String(rotate), '0', 'Rotate, in degrees');
    r.step = '1';
    r.addEventListener('change', () => this.apply({ rotate: r.value.trim() === '' ? null : Number(r.value) }));
    row.append(el('span', 'hint', 'zoom'), z, el('span', 'hint', 'turn'), r, el('span', 'hint', '°'));
    field.append(row);
    return field;
  }

  private transition(current: string | null, duration?: number): HTMLElement {
    const field = this.field('Transition');
    const row = el('div', 'inspector-row');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Transition');
    for (const t of ['none', ...TRANSITIONS.filter((t) => t !== 'none' && t !== 'wipe')]) {
      const o = el('option', '', t);
      o.value = t;
      select.append(o);
    }
    select.value = current ?? 'none';
    const secs = input('number', duration === undefined ? '' : String(duration), 'auto', 'Seconds');
    secs.min = '0';
    secs.step = '0.1';
    secs.disabled = !current;
    const send = () => {
      const d = secs.value.trim() === '' ? undefined : Number(secs.value);
      this.apply({ transition: select.value, ...(d !== undefined && Number.isFinite(d) ? { duration: d } : {}) });
    };
    select.addEventListener('change', send);
    secs.addEventListener('change', send);
    row.append(select, secs, el('span', 'hint', 'seconds'));
    field.append(row);
    return field;
  }

  /** Every image without attributes (`kitchen`, not `mira smile`), as pictures. */
  private backgrounds(current: string | null): HTMLElement {
    const field = this.field('Background');
    const list = el('div', 'inspector-looks backgrounds');
    for (const [name, path] of Object.entries(this.catalog.images)) {
      if (name.includes(' ')) continue;
      const b = button('look', () => this.apply({ image: name }));
      b.setAttribute('aria-pressed', String(name === current));
      const face = el('span', 'face');
      const img = document.createElement('img');
      img.src = `./${path}`;
      img.alt = '';
      img.loading = 'lazy';
      face.append(img);
      b.append(face, el('span', '', name));
      list.append(b);
    }
    field.append(list);
    return field;
  }

  private field(label: string): HTMLElement {
    const f = el('div', 'inspector-field');
    f.append(el('div', 'inspector-label', label));
    return f;
  }

  private apply(change: LineChange): void {
    const err = this.hooks.change(this.line, change);
    this.say(err ?? '');
  }

  private say(text: string): void {
    this.note.textContent = text;
  }
}

function kv(k: string, v: string): HTMLElement {
  const row = el('div', 'kv');
  row.append(el('span', '', k), el('span', '', v));
  return row;
}

function input(type: string, value: string, placeholder: string, label: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.value = value;
  i.placeholder = placeholder;
  i.className = 'inspector-input';
  i.setAttribute('aria-label', label);
  return i;
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

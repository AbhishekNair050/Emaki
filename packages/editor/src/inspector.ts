/**
 * The inspector: the line under the cursor, with controls for what it does
 * (a character's look and place, a background, a transition). A change
 * rewrites that one line (D-065); the script stays the source of truth.
 *
 * It is rebuilt only when the cursor reaches another line or the story is
 * recompiled, and it reads one line, so it costs nothing while typing.
 */
import { TRANSITIONS } from '@emaki/format';
import { inspectLine, looksOf, type InspectedLine, type LineChange } from '@emaki/language';

export interface InspectorHooks {
  /** Rewrite the line with this change; returns why it couldn't be done, or null. */
  change(line: number, change: LineChange): string | null;
}

/** What the story declares, from the last compile that worked. */
export interface Catalog {
  /** Image names (`mira smile`, `kitchen`) and their files under assets/. */
  images: Record<string, string>;
  characters: Record<string, { name: string; color: string | null }>;
}

const PLACES = ['left', 'center', 'right'];

export class Inspector {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private readonly note: HTMLElement;
  private catalog: Catalog = { images: {}, characters: {} };
  private line = 0;
  private lineText: string | null = null;
  private where = '';
  private readonly hooks: InspectorHooks;

  constructor(parent: HTMLElement, hooks: InspectorHooks) {
    this.hooks = hooks;
    this.root = el('section', 'inspector');
    this.root.setAttribute('aria-label', 'Inspector');
    const head = el('h2', 'pane-head');
    head.append('Inspector ', this.title = el('span', 'hint'));
    this.body = el('div', 'inspector-body');
    this.note = el('p', 'inspector-note');
    this.note.setAttribute('role', 'status');
    this.root.append(head, this.body, this.note);
    parent.append(this.root);
  }

  /** The story was recompiled: what it declares may have changed. */
  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
    if (this.lineText !== null) this.render();
  }

  /** The cursor is on `line` (1-based), whose text is `text`, in `where` (scene and file, for the heading). */
  show(line: number, text: string, where: string): void {
    if (line === this.line && text === this.lineText && where === this.where) return;
    const sameLine = line === this.line;
    this.line = line;
    this.lineText = text;
    this.where = where;
    if (!sameLine) this.say('');
    this.render();
  }

  private render(): void {
    this.title.textContent = `line ${this.line}${this.where ? ` · ${this.where}` : ''}`;
    const found = this.lineText === null ? null : inspectLine(this.lineText);
    this.body.replaceChildren(...(found ? this.controls(found) : [this.empty()]));
  }

  private empty(): HTMLElement {
    const p = el('p', 'inspector-empty');
    p.textContent = 'Put the cursor on a show, scene, hide or dialogue line to change it here.';
    return p;
  }

  private controls({ stmt }: InspectedLine): HTMLElement[] {
    const out: HTMLElement[] = [];
    const heading = el('div', 'inspector-what');
    out.push(heading);
    switch (stmt.type) {
      case 'show':
        heading.textContent = `Show ${this.nameOf(stmt.tag)}`;
        out.push(this.looks(stmt.tag, stmt.attrs));
        out.push(this.place(stmt.at));
        out.push(this.transition(stmt.transition, stmt.duration));
        break;
      case 'say':
        if (stmt.who === null) {
          heading.textContent = 'Narration';
          break;
        }
        heading.textContent = `${this.nameOf(stmt.who)} speaks`;
        if (looksOf(stmt.who, Object.keys(this.catalog.images)).length) out.push(this.looks(stmt.who, stmt.attrs, 'Look while speaking'));
        break;
      case 'scene':
        heading.textContent = 'Scene';
        out.push(this.backgrounds(stmt.image));
        out.push(this.transition(stmt.transition, stmt.duration));
        break;
      case 'hide':
        heading.textContent = `Hide ${this.nameOf(stmt.tag)}`;
        out.push(this.transition(stmt.transition, stmt.duration));
        break;
    }
    return out;
  }

  private nameOf(tag: string): string {
    return this.catalog.characters[tag]?.name ?? tag;
  }

  /** A character's looks as pictures; the current one pressed. */
  private looks(tag: string, attrs: string[], label = 'Look'): HTMLElement {
    const field = this.field(label);
    const list = el('div', 'inspector-looks');
    const looks = looksOf(tag, Object.keys(this.catalog.images));
    const current = attrs.join(' ');
    // A look the script uses but no image declares (layered characters, or a typo) is still shown, and kept.
    if (current && !looks.some((l) => l.join(' ') === current)) looks.unshift(attrs);
    if (!looks.length) {
      const p = el('p', 'inspector-empty');
      p.textContent = `No images named ${tag} … are declared.`;
      field.append(p);
      return field;
    }
    for (const look of looks) {
      const name = look.join(' ');
      const b = button('look', () => this.apply({ look }));
      b.setAttribute('aria-pressed', String(name === current));
      const path = this.catalog.images[`${tag} ${name}`];
      if (path) {
        const img = document.createElement('img');
        img.src = `./${path}`;
        img.alt = '';
        img.loading = 'lazy';
        b.append(img);
      }
      b.append(el('span', '', name));
      list.append(b);
    }
    field.append(list);
    return field;
  }

  private place(at: string | null): HTMLElement {
    const field = this.field('Place');
    const row = el('div', 'inspector-segments');
    for (const p of PLACES) {
      const b = button('', () => this.apply({ at: p }), p);
      b.setAttribute('aria-pressed', String((at ?? 'center') === p));
      row.append(b);
    }
    const custom = document.createElement('input');
    custom.type = 'text';
    custom.className = 'inspector-input';
    custom.placeholder = '30%';
    custom.setAttribute('aria-label', 'Another place, as a percentage across the screen');
    custom.value = at && !PLACES.includes(at) ? at : '';
    custom.addEventListener('change', () => {
      const v = custom.value.trim();
      this.apply({ at: v === '' ? null : /^\d+(\.\d+)?$/.test(v) ? `${v}%` : v });
    });
    row.append(custom);
    field.append(row);
    return field;
  }

  private transition(current: string | null, duration?: number): HTMLElement {
    const field = this.field('Transition');
    const row = el('div', 'inspector-row');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Transition');
    for (const t of ['none', ...TRANSITIONS.filter((t) => t !== 'none' && t !== 'wipe')]) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      select.append(o);
    }
    select.value = current ?? 'none';
    const secs = document.createElement('input');
    secs.type = 'number';
    secs.min = '0';
    secs.step = '0.1';
    secs.className = 'inspector-input';
    secs.placeholder = 'auto';
    secs.setAttribute('aria-label', 'Seconds');
    secs.value = duration === undefined ? '' : String(duration);
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
      const img = document.createElement('img');
      img.src = `./${path}`;
      img.alt = '';
      img.loading = 'lazy';
      b.append(img, el('span', '', name));
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

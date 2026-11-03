/**
 * The asset browser: the game's images and audio, and whether the script uses them.
 *
 *  - drag an asset onto the script: it is declared (`image hall = "..."`) and,
 *    dropped inside a scene, shown or played right there
 *  - drop files from your computer here (or onto the script) to add them to the game
 *  - click an asset to find its declaration, or declare it
 */
import { ASSET_MIME, type DraggedAsset } from './script/script-pane.ts';

export interface AssetInfo {
  path: string;
  kind: 'image' | 'audio';
  size: number;
}

export interface AssetPanelHooks {
  /** The name the script declares this file under, if any. */
  declaredName(asset: AssetInfo): string | undefined;
  /** Add the declaration to the script. Returns an error message or null. */
  declare(asset: AssetInfo): string | null;
  /** Show the declaration in the script. */
  reveal(name: string, asset: AssetInfo): void;
  /** Files were dropped or picked: add them to the game (and declare them). */
  addFiles(files: File[]): Promise<void>;
  /** The list of files was (re)loaded. */
  listed?(assets: readonly AssetInfo[]): void;
}

export class AssetPanel {
  readonly el: HTMLElement;
  private readonly hooks: AssetPanelHooks;
  private readonly list: HTMLElement;
  private readonly message: HTMLElement;
  private readonly filter: HTMLInputElement;
  private assets: AssetInfo[] = [];
  private playing: HTMLAudioElement | null = null;

  constructor(parent: HTMLElement, hooks: AssetPanelHooks) {
    this.hooks = hooks;
    this.el = el('div', 'assets');

    const bar = el('div', 'flow-toolbar');
    const picker = el('input') as HTMLInputElement;
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = 'image/*,audio/*';
    picker.hidden = true;
    picker.addEventListener('change', () => {
      const files = [...(picker.files ?? [])];
      picker.value = '';
      if (files.length) void this.add(files);
    });
    const addBtn = el('button', '', '+ Add files') as HTMLButtonElement;
    addBtn.type = 'button';
    addBtn.title = 'Copy images or audio into the game’s assets folder (you can also drop files here)';
    addBtn.addEventListener('click', () => picker.click());
    this.filter = el('input', 'asset-filter') as HTMLInputElement;
    this.filter.type = 'search';
    this.filter.placeholder = 'Filter';
    this.filter.setAttribute('aria-label', 'Filter assets');
    this.filter.addEventListener('input', () => this.render());
    this.message = el('span', 'flow-message');
    this.message.setAttribute('role', 'status');
    bar.append(addBtn, picker, this.filter, this.message);

    this.list = el('div', 'asset-list');
    this.el.append(bar, this.list);
    parent.append(this.el);

    // Files dragged in from the computer.
    this.el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.el.classList.add('drop-here');
    });
    this.el.addEventListener('dragleave', (e) => {
      if (!this.el.contains(e.relatedTarget as Node | null)) this.el.classList.remove('drop-here');
    });
    this.el.addEventListener('drop', (e) => {
      this.el.classList.remove('drop-here');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void this.add(files);
    });
  }

  /** Reload the file list from the server. */
  async refresh(): Promise<void> {
    try {
      const res = await fetch('/__emaki/assets');
      if (!res.ok) throw new Error(String(res.status));
      this.assets = (await res.json()) as AssetInfo[];
    } catch {
      this.say('Couldn’t list the assets folder.', true);
      return;
    }
    this.render();
    this.hooks.listed?.(this.assets);
  }

  /** The script changed: declared names may have too. */
  scriptChanged(): void {
    this.render();
  }

  say(text: string, isError = false): void {
    this.message.textContent = text;
    this.message.classList.toggle('error', isError);
  }

  private async add(files: File[]): Promise<void> {
    this.say(`Adding ${files.length === 1 ? files[0]!.name : `${files.length} files`}…`);
    try {
      await this.hooks.addFiles(files);
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }

  private render(): void {
    const q = this.filter.value.trim().toLowerCase();
    const shown = this.assets.filter((a) => !q || a.path.toLowerCase().includes(q) || (this.hooks.declaredName(a) ?? '').includes(q));
    if (!this.assets.length) {
      this.list.replaceChildren(el('p', 'flow-empty', 'No images or audio yet. Drop files here to add them to the game.'));
      return;
    }
    const images = shown.filter((a) => a.kind === 'image');
    const audio = shown.filter((a) => a.kind === 'audio');
    const sections: HTMLElement[] = [];
    if (images.length) {
      const grid = el('ul', 'asset-grid');
      grid.append(...images.map((a) => this.item(a)));
      sections.push(el('h3', '', `Images (${images.length})`), grid);
    }
    if (audio.length) {
      const rows = el('ul', 'asset-rows');
      rows.append(...audio.map((a) => this.item(a)));
      sections.push(el('h3', '', `Audio (${audio.length})`), rows);
    }
    if (!sections.length) sections.push(el('p', 'flow-empty', 'Nothing matches the filter.'));
    this.list.replaceChildren(...sections);
  }

  private item(a: AssetInfo): HTMLElement {
    const name = this.hooks.declaredName(a);
    const li = el('li', `asset ${a.kind}${name ? '' : ' unused'}`);
    li.draggable = true;
    li.title = `${a.path} · ${formatSize(a.size)}\nDrag onto the script to ${a.kind === 'image' ? 'show' : 'play'} it there`;
    li.addEventListener('dragstart', (e) => {
      const data: DraggedAsset = { path: a.path, kind: a.kind };
      e.dataTransfer!.setData(ASSET_MIME, JSON.stringify(data));
      e.dataTransfer!.setData('text/plain', a.path);
      e.dataTransfer!.effectAllowed = 'copy';
    });

    if (a.kind === 'image') {
      const img = el('img') as HTMLImageElement;
      img.src = `./${a.path}`;
      img.alt = '';
      img.loading = 'lazy';
      img.draggable = false;
      li.append(img);
    } else {
      const play = el('button', 'asset-play', '▶') as HTMLButtonElement;
      play.type = 'button';
      play.setAttribute('aria-label', `Listen to ${a.path}`);
      play.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(a, play); });
      li.append(play);
    }
    const label = el('div', 'asset-label');
    label.append(
      el('span', 'asset-name', name ?? 'not in script'),
      el('span', 'asset-path', a.path),
    );
    li.append(label);

    const action = el('button', 'asset-action', name ? 'Find' : 'Declare') as HTMLButtonElement;
    action.type = 'button';
    action.title = name ? `Show the line that declares '${name}'` : `Add an ${a.kind} line for this file to the script`;
    action.addEventListener('click', (e) => {
      e.stopPropagation();
      if (name) { this.hooks.reveal(name, a); return; }
      const err = this.hooks.declare(a);
      this.say(err ?? '', !!err);
    });
    li.append(action);
    return li;
  }

  private toggle(a: AssetInfo, btn: HTMLButtonElement): void {
    const was = this.playing?.dataset.path;
    this.playing?.pause();
    this.list.querySelectorAll('.asset-play').forEach((b) => { b.textContent = '▶'; });
    this.playing = null;
    if (was === a.path) return;
    const audio = new Audio(`./${a.path}`);
    audio.dataset.path = a.path;
    audio.volume = 0.6;
    audio.addEventListener('ended', () => { btn.textContent = '▶'; this.playing = null; });
    void audio.play().catch(() => this.say(`Couldn’t play ${a.path}.`, true));
    btn.textContent = '■';
    this.playing = audio;
  }
}

function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function el(tag: string, cls = '', content?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content !== undefined) e.textContent = content;
  return e;
}

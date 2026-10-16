/**
 * DOM player: renders a Runner's steps in the browser.
 *
 * Deliberately plain DOM + CSS (no canvas) for v0: accessible by default,
 * crisp text at any size, tiny download. A WebGL renderer can implement the
 * same Effect/Block contract later for shaders and particle effects.
 */
import type { CompiledStory, Span, Value } from '@emaki/format';
import {
  Runner, StoryError,
  type Block, type Effect, type SaveData, type SayBlock, type SceneState, type Step,
} from '@emaki/runtime';
import {
  DEFAULT_SETTINGS, INSTANT_SPEED, RANGES, loadSettings, saveSettings, sanitizeSettings, type Settings,
} from './settings.ts';
import { ImagePreloader } from './preload.ts';
import { parsePreview } from './preview.ts';

/** Sprite positions are CSS variables so each layout (landscape, portrait) can place them. */
const POSITIONS: Record<string, string> = { left: 'var(--pos-left)', center: 'var(--pos-center)', right: 'var(--pos-right)' };
const SLOT_COUNT = 3;
const AUTO_PER_CHAR_MS = 28;
const CHOICE_GUARD_MS = 350;
/** How long a transition may wait for its image to finish loading before going ahead anyway. */
const IMAGE_WAIT_MS = 1500;

type Mode = 'title' | 'playing' | 'ended';

export interface PlayerOptions {
  /** Dev mode: resume at the same line after the script is edited. */
  dev?: boolean;
  /** Called whenever a new line/menu/end is shown (null on the title screen). Used by dev tools. */
  onUpdate?: (block: Block | null) => void;
}

export class Player {
  private readonly runner: Runner;
  private readonly story: CompiledStory;
  private readonly opts: PlayerOptions;
  private readonly storeKey: string;

  // DOM
  private readonly stage: HTMLElement;
  private readonly bgLayer: HTMLElement;
  private readonly spriteLayer: HTMLElement;
  private readonly fader: HTMLElement;
  private readonly textbox: HTMLElement;
  private readonly namebox: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly liveRegion: HTMLElement;
  private readonly choicesEl: HTMLElement;
  private readonly quickMenu: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly autoBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly backBtn: HTMLButtonElement;

  // State
  private mode: Mode = 'title';
  private typingTimer = 0;
  private fullText = '';
  private fullSpans: Span[] | null = null;
  private shownChars = 0;
  private auto = false;
  private skip = false;
  private pendingTimer = 0;
  private epoch = 0;
  private busy = false;
  private menuShownAt = 0;
  private music: HTMLAudioElement | null = null;
  private settings: Settings;
  private readonly images = new ImagePreloader();
  private readonly systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(root: HTMLElement, story: CompiledStory, opts: PlayerOptions = {}) {
    this.story = story;
    this.runner = new Runner(story);
    this.opts = opts;
    this.storeKey = `emaki:${story.meta.title ?? 'untitled'}`;
    this.settings = loadSettings(this.storeKey + ':settings');

    this.stage = el('div', 'stage');
    this.bgLayer = el('div', 'layer bg-layer');
    this.spriteLayer = el('div', 'layer sprite-layer');
    this.fader = el('div', 'layer fader');
    this.textbox = el('div', 'textbox');
    this.namebox = el('div', 'namebox');
    this.textEl = el('div', 'text');
    this.textEl.setAttribute('aria-hidden', 'true');
    this.liveRegion = el('div', 'sr-only');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.textbox.append(this.namebox, this.textEl, this.liveRegion, el('div', 'next-indicator', '▾'));
    this.choicesEl = el('div', 'choices');
    this.choicesEl.setAttribute('role', 'group');
    this.choicesEl.setAttribute('aria-label', 'Choices');
    this.overlay = el('div', 'overlay');
    this.toastEl = el('div', 'toast');
    this.toastEl.setAttribute('role', 'status');

    this.quickMenu = el('nav', 'quickmenu');
    this.quickMenu.setAttribute('aria-label', 'Game menu');
    this.backBtn = button('Back', () => this.back(), 'Roll back to the previous line (←)');
    this.autoBtn = button('Auto', () => this.toggleAuto(), 'Advance automatically (A)');
    this.skipBtn = button('Skip', () => this.toggleSkip(), 'Fast-forward to the next choice (S)');
    this.quickMenu.append(
      this.backBtn,
      button('Log', () => this.showLog(), 'Dialogue history (L)'),
      this.autoBtn,
      this.skipBtn,
      button('Save', () => this.showSlots('save')),
      button('Load', () => this.showSlots('load')),
      button('Settings', () => this.showSettings(), 'Text speed, volume, text size (O)'),
      button('Menu', () => this.confirmTitle()),
    );

    this.stage.append(this.bgLayer, this.spriteLayer, this.fader, this.textbox, this.choicesEl, this.quickMenu, this.overlay, this.toastEl);
    root.classList.add('stage-host');
    root.replaceChildren(this.stage);
    this.applySettings();

    this.stage.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, .overlay.open')) return;
      this.onAdvance();
    });
    this.stage.addEventListener('wheel', (e) => {
      if (this.mode === 'playing' && !this.overlayOpen && e.deltaY < 0) this.back();
    }, { passive: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('beforeunload', () => this.devStash());
  }

  boot(): void {
    if (this.opts.dev) {
      const raw = storage.get(this.storeKey + ':dev-resume', true);
      storage.remove(this.storeKey + ':dev-resume', true);
      const stash = raw ? parseStash(raw) : null;
      // Resume after a reload, unless the address changed (e.g. a new ?line= preview link).
      if (stash && stash.search === location.search) {
        try {
          const step = this.runner.resume(stash.save);
          if (step) {
            this.enterPlaying();
            this.syncScene(this.runner.scene());
            void this.present(step, true);
            this.toast('Reloaded — resumed at the same line');
            return;
          }
        } catch (err) {
          console.warn('Could not resume after reload', err);
        }
      }
    }
    const preview = this.opts.dev ? parsePreview(location.search, this.story.vars) : null;
    if (preview) {
      this.jumpToLine(preview.line, preview.vars);
      const ignored = preview.ignored.length ? ` (ignored: ${preview.ignored.join(', ')})` : '';
      this.toast(`Previewing from story.vn line ${preview.line}${ignored}`);
      return;
    }
    this.showTitle();
  }

  // ---------------------------------------------------------------- dev tools

  get vars(): Readonly<Record<string, Value>> {
    return this.runner.vars;
  }

  /** Play from any label, keeping the current variables and what's on screen. */
  jumpTo(label: string): void {
    const scene = this.mode === 'title' ? undefined : this.runner.scene();
    const vars = { ...this.runner.vars };
    this.enterPlaying();
    this.auto = this.skip = false;
    this.updateToggles();
    this.epoch++;
    this.busy = false;
    this.syncScene(scene ?? { bg: null, sprites: [] });
    this.guard(() => this.present(this.runner.startAt(label, { vars, scene })));
  }

  /**
   * Play from a line of the script (dev preview). Uses the given variables, or
   * keeps the current ones; the scene is rebuilt from the top of the label.
   */
  jumpToLine(line: number, vars?: Record<string, Value>): void {
    const keep = vars ?? (this.mode === 'title' ? {} : { ...this.runner.vars });
    this.enterPlaying();
    this.auto = this.skip = false;
    this.updateToggles();
    this.epoch++;
    this.busy = false;
    this.guard(() => {
      const step = this.runner.startAtLine(line, { vars: keep });
      this.syncScene(this.runner.scene());
      this.syncMusic();
      return this.present(step, true);
    });
  }

  setVar(name: string, value: Value): void {
    this.guard(() => this.runner.setVar(name, value));
    this.opts.onUpdate?.(this.runner.block);
  }

  // ---------------------------------------------------------------- flow

  private start(): void {
    this.enterPlaying();
    this.syncScene({ bg: null, sprites: [] });
    this.stopMusic();
    this.guard(() => this.present(this.runner.start()));
  }

  private enterPlaying(): void {
    this.mode = 'playing';
    this.closeOverlay();
    this.stage.classList.add('playing');
  }

  private onAdvance(): void {
    if (this.mode !== 'playing' || this.overlayOpen || this.busy) return;
    const b = this.runner.block;
    if (!b) return;
    if (b.type === 'say' && this.isTyping) {
      this.finishTyping();
      return;
    }
    if (b.type === 'say' || b.type === 'wait') this.guard(() => this.present(this.runner.advance()));
    if (b.type === 'end') this.showEnd();
  }

  private choose(index: number): void {
    if (this.busy) return;
    // Players often click rapidly to advance; don't let a click meant for the
    // previous line land on a choice that just appeared under the cursor.
    if (performance.now() - this.menuShownAt < CHOICE_GUARD_MS) return;
    this.skip = false;
    this.updateToggles();
    this.guard(() => this.present(this.runner.choose(index)));
  }

  private back(): void {
    if (this.mode !== 'playing' || this.busy) return;
    const r = this.runner.back();
    if (!r) return;
    this.auto = this.skip = false;
    this.updateToggles();
    this.epoch++;
    this.syncScene(r.scene);
    this.syncMusic();
    this.renderBlock(r.block, true);
  }

  /** Apply a step's effects (animated), then show its block. */
  private async present(step: Step, instant = false): Promise<void> {
    const my = ++this.epoch;
    this.clearTimers();
    this.choicesEl.replaceChildren();
    this.busy = true;
    try {
      // Hold the step (briefly) until its pictures are ready, so nothing fades in half-loaded.
      const needed = step.effects.flatMap((fx) => (fx.type === 'scene' || fx.type === 'show') && fx.path ? [asset(fx.path)] : []);
      this.images.want(needed);
      this.preloadAhead();
      const wait = instant || this.skip ? 0 : IMAGE_WAIT_MS;
      await Promise.all(needed.map((url) => this.images.ready(url, wait)));
      if (my !== this.epoch) return;
      for (const fx of step.effects) {
        await this.applyEffect(fx, instant || this.skip);
        if (my !== this.epoch) return;
      }
    } finally {
      if (my === this.epoch) this.busy = false;
    }
    this.renderBlock(step.block, instant);
  }

  /** Start loading the images the next few lines might show, down every branch. */
  private preloadAhead(): void {
    this.images.want(this.runner.upcomingImages().map(asset));
  }

  private renderBlock(b: Block, instant: boolean): void {
    this.clearTimers();
    this.choicesEl.replaceChildren();
    this.backBtn.disabled = !this.runner.canGoBack;
    this.textbox.classList.toggle('waiting', false);

    switch (b.type) {
      case 'say':
        this.showLine(b, instant || this.skip || this.reducedMotion);
        break;
      case 'menu': {
        this.auto = this.skip = false;
        this.updateToggles();
        // Keep the line being responded to on screen (also after load/rollback).
        const prompt = this.runner.lastSay;
        if (prompt) this.showLine(prompt, true, false);
        else this.textbox.hidden = true;
        this.textbox.classList.remove('waiting');
        this.menuShownAt = instant ? 0 : performance.now();
        b.choices.forEach((c, i) => {
          const btn = button(c.text, () => this.choose(c.index));
          if (c.spans) btn.replaceChildren(...spanNodes(c.spans));
          btn.className = 'choice';
          btn.dataset.key = String(i + 1);
          this.choicesEl.append(btn);
        });
        (this.choicesEl.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
        break;
      }
      case 'wait':
        this.textbox.hidden = true;
        this.pendingTimer = window.setTimeout(() => this.onAdvance(), this.skip ? 0 : b.seconds * 1000);
        break;
      case 'end':
        this.showEnd();
        break;
    }
    this.opts.onUpdate?.(b);
  }

  // ---------------------------------------------------------- text

  private showLine(b: SayBlock, instant: boolean, announce = true): void {
    this.textbox.hidden = false;
    this.namebox.textContent = b.who?.name ?? '';
    this.namebox.hidden = !b.who;
    this.namebox.style.color = b.who?.color ?? '';
    this.textbox.classList.toggle('narration', !b.who);
    if (announce) this.liveRegion.textContent = b.who ? `${b.who.name}: ${b.text}` : b.text;
    if (instant && !announce) {
      // Static redisplay (behind a menu): no typing, no auto/skip timers.
      window.clearInterval(this.typingTimer);
      this.fullText = b.text;
      this.fullSpans = b.spans ?? null;
      this.shownChars = b.text.length;
      this.renderText();
      return;
    }
    this.typeText(b.text, b.spans ?? null, instant || this.settings.textSpeed >= INSTANT_SPEED);
  }

  private get reducedMotion(): boolean {
    return this.settings.motion === 'reduced' || (this.settings.motion === 'system' && this.systemReducedMotion);
  }

  private get isTyping(): boolean {
    return this.shownChars < this.fullText.length;
  }

  private typeText(text: string, spans: Span[] | null, instant: boolean): void {
    window.clearInterval(this.typingTimer);
    this.fullText = text;
    this.fullSpans = spans;
    this.shownChars = instant ? text.length : 0;
    this.renderText();
    if (instant) { this.onTextDone(); return; }
    const step = 1000 / this.settings.textSpeed;
    this.typingTimer = window.setInterval(() => {
      this.shownChars++;
      this.renderText();
      if (!this.isTyping) {
        window.clearInterval(this.typingTimer);
        this.onTextDone();
      }
    }, step);
  }

  /** Draw the first `shownChars` characters, keeping bold/italic/colour runs. */
  private renderText(): void {
    if (!this.fullSpans) this.textEl.textContent = this.fullText.slice(0, this.shownChars);
    else this.textEl.replaceChildren(...spanNodes(this.fullSpans, this.shownChars));
  }

  private finishTyping(): void {
    if (!this.isTyping) return;
    window.clearInterval(this.typingTimer);
    this.shownChars = this.fullText.length;
    this.renderText();
    this.onTextDone();
  }

  private onTextDone(): void {
    this.textbox.classList.add('waiting');
    if (this.skip) {
      this.pendingTimer = window.setTimeout(() => this.onAdvance(), 40);
    } else if (this.auto) {
      const wait = this.settings.autoDelay * 1000 + this.fullText.length * AUTO_PER_CHAR_MS;
      this.pendingTimer = window.setTimeout(() => this.onAdvance(), wait);
    }
  }

  private clearTimers(): void {
    window.clearTimeout(this.pendingTimer);
    window.clearInterval(this.typingTimer);
  }

  private toggleAuto(): void {
    this.auto = !this.auto;
    if (this.auto) this.skip = false;
    this.updateToggles();
    if (this.auto && !this.isTyping && this.runner.block?.type === 'say') this.onTextDone();
    if (!this.auto) window.clearTimeout(this.pendingTimer);
  }

  private toggleSkip(): void {
    this.skip = !this.skip;
    if (this.skip) this.auto = false;
    this.updateToggles();
    if (this.skip) {
      this.finishTyping();
      if (this.runner.block?.type === 'say') this.onTextDone();
    } else window.clearTimeout(this.pendingTimer);
  }

  private updateToggles(): void {
    this.autoBtn.setAttribute('aria-pressed', String(this.auto));
    this.skipBtn.setAttribute('aria-pressed', String(this.skip));
  }

  // ---------------------------------------------------------- visuals

  private duration(transition: string | null, instant: boolean): number {
    if (instant || this.reducedMotion || !transition || transition === 'none') return 0;
    return transition === 'fade' ? 450 : 400;
  }

  private async applyEffect(fx: Effect, instant: boolean): Promise<void> {
    switch (fx.type) {
      case 'scene': {
        const ms = this.duration(fx.transition, instant);
        if (fx.transition === 'fade' && ms) {
          await this.fadeTo(1, ms);
          this.textbox.hidden = true;
          this.setBackground(fx.path, 0);
          this.spriteLayer.replaceChildren();
          await this.fadeTo(0, ms);
        } else {
          for (const s of this.spriteLayer.children) fadeOutAndRemove(s as HTMLElement, ms);
          await this.setBackground(fx.path, ms);
        }
        return;
      }
      case 'show': {
        const ms = this.duration(fx.transition, instant);
        let img = this.spriteLayer.querySelector<HTMLImageElement>(`img[data-tag="${cssEscape(fx.tag)}"]`);
        if (!img) {
          img = el('img', 'sprite') as HTMLImageElement;
          img.dataset.tag = fx.tag;
          img.alt = '';
          img.style.left = POSITIONS[fx.at] ?? POSITIONS.center!;
          img.src = asset(fx.path);
          img.style.opacity = ms ? '0' : '1';
          this.spriteLayer.append(img);
          if (ms) await animateOpacity(img, 1, ms);
        } else {
          img.style.left = POSITIONS[fx.at] ?? img.style.left;
          if (img.getAttribute('src') !== asset(fx.path)) img.src = asset(fx.path);
        }
        return;
      }
      case 'hide': {
        const img = this.spriteLayer.querySelector<HTMLElement>(`img[data-tag="${cssEscape(fx.tag)}"]`);
        if (img) await fadeOutAndRemove(img, this.duration(fx.transition, instant));
        return;
      }
      case 'play':
        if (fx.channel === 'music') this.playMusic(fx.path, fx.loop);
        else playOnce(fx.path, this.settings.soundVolume);
        return;
      case 'stop':
        if (fx.channel === 'music') this.stopMusic();
        return;
    }
  }

  private async setBackground(path: string | null, ms: number): Promise<void> {
    const next = el('div', 'bg');
    if (path) next.style.backgroundImage = `url("${asset(path)}")`;
    next.style.opacity = ms ? '0' : '1';
    const old = [...this.bgLayer.children] as HTMLElement[];
    this.bgLayer.append(next);
    if (ms) await animateOpacity(next, 1, ms);
    old.forEach((o) => o.remove());
  }

  private fadeTo(opacity: number, ms: number): Promise<void> {
    return animateOpacity(this.fader, opacity, ms);
  }

  /** Redraw the scene from state, without animation (load, rollback). */
  private syncScene(scene: SceneState): void {
    this.fader.style.opacity = '0';
    void this.setBackground(this.runner.imagePath(scene.bg), 0);
    this.spriteLayer.replaceChildren();
    for (const sp of scene.sprites) {
      const path = this.runner.spritePath(sp);
      if (!path) continue;
      const img = el('img', 'sprite') as HTMLImageElement;
      img.dataset.tag = sp.tag;
      img.alt = '';
      img.src = asset(path);
      img.style.left = POSITIONS[sp.at] ?? POSITIONS.center!;
      this.spriteLayer.append(img);
    }
  }

  // ---------------------------------------------------------- audio

  private playMusic(path: string, loop: boolean): void {
    if (this.music?.dataset.path === path) return;
    this.stopMusic();
    const a = new Audio(asset(path));
    a.dataset.path = path;
    a.loop = loop;
    a.volume = this.settings.musicVolume;
    a.play().catch(() => { /* autoplay blocked or file missing: stay silent */ });
    this.music = a;
  }

  private stopMusic(): void {
    this.music?.pause();
    this.music = null;
  }

  private syncMusic(): void {
    const m = this.runner.audio().music;
    if (m) this.playMusic(m.path, m.loop);
    else this.stopMusic();
  }

  // ---------------------------------------------------------- screens

  private get overlayOpen(): boolean {
    return this.overlay.classList.contains('open');
  }

  private openOverlay(cls: string, ...children: Node[]): void {
    this.clearTimers();
    this.overlay.className = `overlay open ${cls}`;
    this.overlay.replaceChildren(...children);
    (this.overlay.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private closeOverlay(): void {
    const wasOpen = this.overlayOpen;
    this.overlay.className = 'overlay';
    this.overlay.replaceChildren();
    // Resume auto/skip timers that were paused by the overlay.
    if (wasOpen && this.mode === 'playing' && this.runner.block?.type === 'say' && !this.isTyping) this.onTextDone();
  }

  private showTitle(): void {
    this.opts.onUpdate?.(null);
    this.mode = 'title';
    this.epoch++;
    this.clearTimers();
    this.stopMusic();
    this.stage.classList.remove('playing');
    this.textbox.hidden = true;
    this.choicesEl.replaceChildren();
    this.spriteLayer.replaceChildren();
    const titleBg = this.story.meta.title_image;
    void this.setBackground(titleBg ?? null, 0);
    this.images.want(new Runner(this.story).upcomingImages().map(asset)); // the opening scene

    const hasSaves = this.slots().some(Boolean);
    const menu = el('div', 'title-menu');
    menu.append(button('Start', () => this.start()));
    if (hasSaves) menu.append(button('Load', () => this.showSlots('load')));
    menu.append(button('Settings', () => this.showSettings()));
    this.openOverlay('title-screen',
      el('h1', 'title', this.story.meta.title ?? 'Untitled'),
      ...(this.story.meta.author ? [el('p', 'byline', this.story.meta.author)] : []),
      menu,
      el('p', 'made-with', 'Made with Emaki'),
    );
  }

  private showEnd(): void {
    if (this.mode === 'ended') return;
    this.mode = 'ended';
    this.clearTimers();
    this.auto = this.skip = false;
    this.updateToggles();
    this.openOverlay('end-screen',
      el('h2', '', 'The End'),
      button('Back to title', () => this.showTitle()),
      button('Undo last line', () => { this.mode = 'playing'; this.closeOverlay(); this.back(); }),
    );
  }

  private confirmTitle(): void {
    this.openOverlay('panel',
      el('h2', '', 'Return to title?'),
      el('p', '', 'Unsaved progress will be lost.'),
      row(button('Return to title', () => this.showTitle()), button('Keep playing', () => this.closeOverlay())),
    );
  }

  private showLog(): void {
    const list = el('ol', 'log');
    for (const b of this.runner.log) {
      const li = el('li', b.who ? '' : 'narration');
      if (b.who) {
        const n = el('span', 'log-name', b.who.name);
        n.style.color = b.who.color ?? '';
        li.append(n);
      }
      const line = el('span');
      if (b.spans) line.append(...spanNodes(b.spans));
      else line.textContent = b.text;
      li.append(line);
      list.append(li);
    }
    this.openOverlay('panel log-panel', el('h2', '', 'History'), list, button('Close', () => this.closeOverlay()));
    list.scrollTop = list.scrollHeight;
  }

  // ---------------------------------------------------------- saves

  private slots(): Array<(SaveData & { preview: string }) | null> {
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const raw = storage.get(`${this.storeKey}:slot${i}`);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    });
  }

  // ---------------------------------------------------------- settings

  /** Push settings into CSS variables and live audio. */
  private applySettings(): void {
    const s = this.settings;
    this.stage.style.setProperty('--text-scale', String(s.textScale));
    this.stage.style.setProperty('--box-alpha', String(s.boxOpacity));
    this.stage.classList.toggle('font-sans', s.font === 'sans');
    this.stage.classList.toggle('reduced-motion', this.reducedMotion);
    this.stage.classList.toggle('full-motion', s.motion === 'full');
    if (this.music) this.music.volume = s.musicVolume;
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    this.applySettings();
    saveSettings(this.storeKey + ':settings', this.settings);
  }

  private showSettings(): void {
    const fromTitle = this.mode === 'title';
    const form = el('div', 'settings');
    const pct = (v: number) => `${Math.round(v * 100)}%`;

    const slider = (key: keyof typeof RANGES, label: string, show: (v: number) => string) => {
      const id = `set-${key}`;
      const lab = el('label', '', label);
      lab.htmlFor = id;
      const input = el('input');
      input.type = 'range';
      input.id = id;
      const { min, max, step } = RANGES[key];
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(this.settings[key]);
      const out = el('output', '', show(this.settings[key]));
      out.htmlFor.add(id);
      input.addEventListener('input', () => {
        this.updateSettings({ [key]: Number(input.value) });
        out.textContent = show(this.settings[key]);
      });
      form.append(lab, input, out);
    };

    const choice = <K extends 'font' | 'motion'>(key: K, label: string, options: Array<[Settings[K], string]>) => {
      const id = `set-${key}`;
      const lab = el('label', '', label);
      lab.htmlFor = id;
      const select = el('select');
      select.id = id;
      for (const [value, text] of options) {
        const o = el('option', '', text);
        o.value = value;
        o.selected = this.settings[key] === value;
        select.append(o);
      }
      select.addEventListener('change', () => this.updateSettings({ [key]: select.value } as Partial<Settings>));
      form.append(lab, select, el('span'));
    };

    slider('textSpeed', 'Text speed', (v) => (v >= INSTANT_SPEED ? 'Instant' : `${v} letters/s`));
    slider('autoDelay', 'Auto-advance wait', (v) => `${v.toFixed(2).replace(/0$/, '')} s`);
    slider('musicVolume', 'Music volume', pct);
    slider('soundVolume', 'Sound volume', pct);
    slider('textScale', 'Text size', pct);
    slider('boxOpacity', 'Text box opacity', pct);
    choice('font', 'Font', [['serif', 'Book (serif)'], ['sans', 'Clean (sans-serif)']]);
    choice('motion', 'Animations', [['system', 'Follow my device'], ['full', 'On'], ['reduced', 'Reduced']]);

    const preview = el('p', 'settings-preview', 'The light sweeps out over the black water, and for a moment the whole bay is silver.');
    const done = () => (fromTitle ? this.showTitle() : this.closeOverlay());
    const reset = button('Reset to defaults', () => {
      this.updateSettings({ ...DEFAULT_SETTINGS });
      this.showSettings();
    });
    this.openOverlay('panel settings-panel', el('h2', '', 'Settings'), form, preview, row(reset, button('Done', done)));
  }

  private showSlots(kind: 'save' | 'load'): void {
    const canSave = kind === 'save' && this.mode === 'playing' && this.runner.block !== null;
    const grid = el('div', 'slots');
    this.slots().forEach((s, i) => {
      const label = s
        ? `${new Date(s.savedAt).toLocaleString()} — ${truncate(s.preview, 60)}`
        : 'Empty';
      const b = button(`Slot ${i + 1}: ${label}`, () => {
        if (kind === 'save') this.saveTo(i);
        else if (s) this.loadFrom(s);
      });
      b.disabled = kind === 'save' ? !canSave : !s;
      grid.append(b);
    });
    this.openOverlay('panel', el('h2', '', kind === 'save' ? 'Save' : 'Load'), grid,
      button('Close', () => (this.mode === 'title' ? this.showTitle() : this.closeOverlay())));
  }

  private saveTo(i: number): void {
    const data = this.runner.save();
    const b = data.block;
    const preview = b.type === 'say' ? (b.who ? `${b.who.name}: ${b.text}` : b.text) : 'At a choice';
    const ok = storage.set(`${this.storeKey}:slot${i}`, JSON.stringify({ ...data, preview }));
    this.closeOverlay();
    this.toast(ok ? `Saved to slot ${i + 1}` : 'Could not save (storage unavailable)');
  }

  private loadFrom(data: SaveData): void {
    const r = this.runner.load(data);
    if (!r.ok) { this.toast('That save could not be loaded'); return; }
    this.enterPlaying();
    this.epoch++;
    this.syncScene(this.runner.scene());
    this.syncMusic();
    this.renderBlock(this.runner.block!, true);
    this.toast(r.mismatch ? 'Loaded (the story has changed since this save)' : 'Loaded');
  }

  private devStash(): void {
    if (!this.opts.dev || this.mode !== 'playing' || !this.runner.block) return;
    const stash: DevStash = { search: location.search, save: this.runner.save() };
    try { storage.set(this.storeKey + ':dev-resume', JSON.stringify(stash), true); } catch { /* ignore */ }
  }

  // ---------------------------------------------------------- input & misc

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    // Keys aimed at something focused outside the game (e.g. a dev panel) aren't ours.
    if (e.target instanceof Element && e.target !== document.body && !this.stage.contains(e.target)) return;
    if (e.key === 'Escape' && this.overlayOpen && this.mode === 'playing') { this.closeOverlay(); return; }
    if (this.mode !== 'playing' || this.overlayOpen) return;
    const block = this.runner.block;
    if (block?.type === 'menu' && /^[1-9]$/.test(e.key)) {
      const btn = this.choicesEl.querySelector<HTMLButtonElement>(`[data-key="${e.key}"]`);
      btn?.click();
      return;
    }
    switch (e.key) {
      case ' ': case 'Enter':
        if (document.activeElement instanceof HTMLButtonElement) return; // let the button handle it
        e.preventDefault();
        this.onAdvance();
        break;
      case 'ArrowLeft': case 'PageUp': this.back(); break;
      case 'ArrowRight': case 'PageDown': this.onAdvance(); break;
      case 'a': this.toggleAuto(); break;
      case 's': this.toggleSkip(); break;
      case 'l': this.showLog(); break;
      case 'h': this.stage.classList.toggle('hide-ui'); break;
      case 'o': this.showSettings(); break;
    }
  }

  private guard(fn: () => Promise<void> | void): void {
    try {
      const p = fn();
      if (p) p.catch((err) => this.fail(err));
    } catch (err) {
      this.fail(err);
    }
  }

  private fail(err: unknown): void {
    console.error(err);
    const msg = err instanceof StoryError ? err.message : `Unexpected error: ${(err as Error)?.message ?? err}`;
    this.busy = false;
    this.openOverlay('panel error-panel', el('h2', '', 'Something went wrong'), el('p', '', msg),
      button('Back to title', () => this.showTitle()));
  }

  private toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }
}

// ------------------------------------------------------------------ helpers

/** What the dev server keeps across a live reload. */
interface DevStash {
  /** The address at the time, so a changed preview link isn't overridden by the old position. */
  search: string;
  save: SaveData;
}

function parseStash(raw: string): DevStash | null {
  try {
    const v = JSON.parse(raw) as Partial<DevStash>;
    return v && typeof v.search === 'string' && v.save ? (v as DevStash) : null;
  } catch {
    return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el('button', '', label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function row(...children: Node[]): HTMLElement {
  const r = el('div', 'row');
  r.append(...children);
  return r;
}

function asset(path: string): string {
  return /^(https?:|data:|\/)/.test(path) ? path : `./${path}`;
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"');
}

/**
 * DOM nodes for styled text, cut off after `limit` characters (for the
 * typewriter effect). Colours were validated by the compiler.
 */
function spanNodes(spans: Span[], limit = Infinity): Node[] {
  const nodes: Node[] = [];
  let left = limit;
  for (const sp of spans) {
    if (left <= 0) break;
    const text = sp.text.length > left ? sp.text.slice(0, left) : sp.text;
    left -= text.length;
    if (!sp.b && !sp.i && !sp.color) {
      nodes.push(document.createTextNode(text));
      continue;
    }
    const e = el('span', [sp.b && 'rt-b', sp.i && 'rt-i'].filter(Boolean).join(' '), text);
    if (sp.color) e.style.color = sp.color;
    nodes.push(e);
  }
  return nodes;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function animateOpacity(node: HTMLElement, to: number, ms: number): Promise<void> {
  if (!ms) { node.style.opacity = String(to); return Promise.resolve(); }
  const from = getComputedStyle(node).opacity;
  const anim = node.animate([{ opacity: from }, { opacity: String(to) }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
  return anim.finished.then(() => {
    node.style.opacity = String(to);
    anim.cancel();
  }, () => { node.style.opacity = String(to); });
}

async function fadeOutAndRemove(node: HTMLElement, ms: number): Promise<void> {
  await animateOpacity(node, 0, ms);
  node.remove();
}

function playOnce(path: string, volume: number): void {
  const a = new Audio(asset(path));
  a.volume = volume;
  a.play().catch(() => { /* ignore */ });
}

/** localStorage/sessionStorage that never throws (private mode, blocked storage). */
const storage = {
  get(key: string, session = false): string | null {
    try { return (session ? sessionStorage : localStorage).getItem(key); } catch { return null; }
  },
  set(key: string, value: string, session = false): boolean {
    try { (session ? sessionStorage : localStorage).setItem(key, value); return true; } catch { return false; }
  },
  remove(key: string, session = false): void {
    try { (session ? sessionStorage : localStorage).removeItem(key); } catch { /* ignore */ }
  },
};

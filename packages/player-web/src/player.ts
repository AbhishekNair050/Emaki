/**
 * DOM player: renders a Runner's steps in the browser.
 *
 * Deliberately plain DOM + CSS (no canvas) for v0: accessible by default,
 * crisp text at any size, tiny download. A WebGL renderer can implement the
 * same Effect/Block contract later for shaders and particle effects.
 */
import { isPercentPosition, parseAspect, type CompiledStory, type CompiledTranslation, type Span, type Value } from '@emaki/format';
import {
  Runner, StoryError,
  type Block, type CameraState, type Effect, type SaveData, type SayBlock, type SceneState, type Step,
} from '@emaki/runtime';
import {
  DEFAULT_SETTINGS, FONTS, INSTANT_SPEED, RANGES, loadSettings, saveSettings, sanitizeSettings, type Settings,
} from './settings.ts';
import { ImagePreloader } from './preload.ts';
import { fadeVolume, LoopAudio, type Track } from './loop-audio.ts';
import { Progress } from './progress.ts';
import { ReadLines } from './read-lines.ts';
import { detectHost, type EmakiHost } from './host.ts';
import { parsePreview } from './preview.ts';
import { UI_STRINGS, fill, isRtl, languageName, matchLanguage, type UiKey } from './ui-strings.ts';

/** Sprite positions are CSS variables so each layout (landscape, portrait) can place them. */
const POSITIONS: Record<string, string> = { left: 'var(--pos-left)', center: 'var(--pos-center)', right: 'var(--pos-right)' };

/** CSS `left` for a position name or a percentage (`at 30%`). */
function positionLeft(at: string | null | undefined): string | undefined {
  if (!at) return undefined;
  return POSITIONS[at] ?? (isPercentPosition(at) ? at : undefined);
}
const SLOT_COUNT = 3;
const AUTO_PER_CHAR_MS = 28;
const CHOICE_GUARD_MS = 350;
/** How long a transition may wait for its image to finish loading before going ahead anyway. */
const IMAGE_WAIT_MS = 1500;

/** 'intro': the story's own `label title` is playing its opening lines, before its menu. */
type Mode = 'title' | 'intro' | 'playing' | 'ended';

/** Built-in title screen buttons, in their default order (header `title_buttons`). */
const TITLE_BUTTONS = ['start', 'load', 'extras', 'settings', 'quit'] as const;

export interface PlayerOptions {
  /** Dev mode: resume at the same line after the script is edited. */
  dev?: boolean;
  /** Called whenever a new line/menu/end is shown (null on the title screen). Used by dev tools. */
  onUpdate?: (block: Block | null) => void;
  /** Languages the game is translated into (from the game's lang/ folder). */
  translations?: CompiledTranslation[];
  /** The player is the whole page: keep the page title and language in step with the game. */
  ownsDocument?: boolean;
  /** The app around the game (desktop, phone, browser). Detected when not given. */
  host?: EmakiHost;
}

export class Player {
  private runner: Runner;
  private story: CompiledStory;
  private readonly opts: PlayerOptions;
  private readonly storeKey: string;
  private translation: CompiledTranslation | null = null;
  /** Ends the movie that's playing, if any (see playMovie). */
  private endMovie: (() => void) | null = null;
  /** Whether the previous language swapped any pictures (switching away has to redraw them). */
  private translationHadAssets = false;
  private readonly host: EmakiHost;
  /** The language changed behind an open panel: redraw the line when it closes. */
  private redrawOnClose = false;

  // DOM
  private readonly stage: HTMLElement;
  private readonly bgLayer: HTMLElement;
  private readonly spriteLayer: HTMLElement;
  private readonly fader: HTMLElement;
  /** `flash`: a colour over the whole picture and text box for a moment. */
  private readonly flashEl: HTMLElement;
  private readonly textbox: HTMLElement;
  private readonly namebox: HTMLElement;
  /** The speaker's side image (portrait) in the text box. */
  private readonly sideEl: HTMLImageElement;
  private readonly textEl: HTMLElement;
  /** NVL mode: the page of text over the whole screen. */
  private readonly nvlEl: HTMLElement;
  /** Where the typewriter writes: the text box, or the newest line of an NVL page. */
  private typeTarget: HTMLElement;
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
  /** Pauses still ahead in the line being typed (`[w]`, `[w=1.5]`), by character position. */
  private stops: Array<{ at: number; pause: 'click' | number }> = [];
  /** Typing is held at a `[w]` until the player clicks. */
  private held = false;
  /** The line ends with `[nw]`: move on by itself, after `endPause` seconds. */
  private autoNext = false;
  private endPause = 0;
  private instantText = false;
  private pauseTimer = 0;
  private auto = false;
  private skip = false;
  private pendingTimer = 0;
  private epoch = 0;
  private busy = false;
  private menuShownAt = 0;
  /** Music, ambience and looping sounds, looped without a gap. */
  private readonly loops = new LoopAudio();
  private music: Track | null = null;
  /** The ambience loop under the music (`play ambience rain`). */
  private ambience: Track | null = null;
  /** The voice line playing now; a new line (or the next click) stops it. */
  private voice: HTMLAudioElement | null = null;
  /** The looping sound playing now (rain, a crowd), kept until stopped or replaced. */
  private loopSound: Track | null = null;
  /** One-shot sound effects still playing, so 'stop sound' can cut them. */
  private readonly sounds = new Set<HTMLAudioElement>();
  private settings: Settings;
  private readonly images = new ImagePreloader();
  /** Lines read in any playthrough, so skip can stop at new text. */
  private readonly read: ReadLines;
  /** Gallery images seen and endings reached, in any playthrough (the Extras screen). */
  private readonly progress: Progress;
  /** The ending this playthrough reached, for the end screen. */
  private endingName: string | null = null;
  private readonly systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(root: HTMLElement, story: CompiledStory, opts: PlayerOptions = {}) {
    this.story = story;
    this.runner = new Runner(story);
    this.opts = opts;
    this.host = opts.host ?? detectHost();
    this.storeKey = `emaki:${story.meta.title ?? 'untitled'}`;
    this.settings = loadSettings(this.storeKey + ':settings');
    this.read = new ReadLines(`${this.storeKey}:read`, storage);
    this.progress = new Progress(this.storeKey, storage);
    this.loadGlobals();

    this.stage = el('div', 'stage');
    this.applyStageShape();
    this.bgLayer = el('div', 'layer bg-layer');
    this.spriteLayer = el('div', 'layer sprite-layer');
    this.fader = el('div', 'layer fader');
    this.flashEl = el('div', 'layer flash');
    this.textbox = el('div', 'textbox');
    this.namebox = el('div', 'namebox');
    this.sideEl = el('img', 'side-image') as HTMLImageElement;
    this.sideEl.alt = '';
    this.sideEl.hidden = true;
    this.textEl = el('div', 'text');
    this.typeTarget = this.textEl;
    this.nvlEl = el('div', 'nvl-page');
    this.nvlEl.hidden = true;
    this.nvlEl.setAttribute('aria-hidden', 'true'); // the live region reads each line
    this.textEl.setAttribute('aria-hidden', 'true');
    this.liveRegion = el('div', 'sr-only');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.textbox.append(this.sideEl, this.namebox, this.textEl, this.liveRegion, el('div', 'next-indicator', '▾'));
    this.choicesEl = el('div', 'choices');
    this.choicesEl.setAttribute('role', 'group');
    this.choicesEl.setAttribute('aria-label', UI_STRINGS['ui.choices']);
    this.overlay = el('div', 'overlay');
    this.toastEl = el('div', 'toast');
    this.toastEl.setAttribute('role', 'status');

    this.quickMenu = el('nav', 'quickmenu');
    this.backBtn = button('', () => this.back());
    this.autoBtn = button('', () => this.toggleAuto());
    this.skipBtn = button('', () => this.toggleSkip());
    // Labels are filled in (and re-filled when the language changes) by applyLanguage().
    const label = (b: HTMLButtonElement, text: UiKey, hint?: UiKey) => {
      b.dataset.text = text;
      if (hint) b.dataset.hint = hint;
      return b;
    };
    this.quickMenu.append(
      label(this.backBtn, 'ui.back', 'ui.back_hint'),
      label(button('', () => this.showLog()), 'ui.log', 'ui.log_hint'),
      label(this.autoBtn, 'ui.auto', 'ui.auto_hint'),
      label(this.skipBtn, 'ui.skip', 'ui.skip_hint'),
      label(button('', () => this.showSlots('save')), 'ui.save'),
      label(button('', () => this.showSlots('load')), 'ui.load'),
      label(button('', () => this.showSettings()), 'ui.settings', 'ui.settings_hint'),
      label(button('', () => this.confirmTitle()), 'ui.menu'),
    );

    this.stage.append(this.bgLayer, this.spriteLayer, this.fader, this.nvlEl, this.textbox, this.flashEl, this.choicesEl, this.quickMenu, this.overlay, this.toastEl);
    root.classList.add('stage-host');
    root.replaceChildren(this.stage);
    this.applySettings();
    this.applyLanguage();

    this.stage.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, .overlay.open')) return;
      this.onAdvance();
    });
    this.stage.addEventListener('wheel', (e) => {
      if (this.mode === 'playing' && !this.overlayOpen && e.deltaY < 0) this.back();
    }, { passive: true });
    this.host.onBackButton?.(() => this.handleBack());
    window.addEventListener('keydown', this.keyListener);
    window.addEventListener('beforeunload', this.unloadListener);
  }

  private readonly keyListener = (e: KeyboardEvent) => this.onKey(e);
  private readonly unloadListener = () => { this.read.flush(); this.devStash(); };

  /** Stop everything (timers, music, listeners) and empty the host. The player can't be used afterwards. */
  destroy(): void {
    this.nextEpoch();
    this.clearTimers();
    this.stopMusic();
    this.stopAmbience();
    this.stopSounds();
    this.stopVoice();
    this.read.flush();
    window.removeEventListener('keydown', this.keyListener);
    window.removeEventListener('beforeunload', this.unloadListener);
    this.stage.remove();
  }

  /**
   * Swap in a new version of the story (the editor calls this as the script
   * changes). A game in progress continues from the same line, with the edit
   * visible at once; music that is still the same track keeps playing.
   * Returns false if the old position couldn't be found (back to the title).
   */
  reload(story: CompiledStory): boolean {
    const save = this.mode === 'playing' && this.runner.block ? this.runner.save() : null;
    this.story = story;
    this.applyStageShape();
    this.runner = new Runner(story);
    this.runner.setTranslation(this.translation);
    this.loadGlobals();
    if (this.mode === 'title') { this.closeOverlay(); this.showTitle(); return true; }
    if (!save) { this.showTitle(); return false; }
    let step: Step | null = null;
    try { step = this.runner.resume(save); } catch (err) { console.warn('Could not resume after an edit', err); }
    if (!step) { this.showTitle(); return false; }
    this.enterPlaying();
    this.nextEpoch();
    this.busy = false;
    this.syncScene(this.runner.scene());
    this.syncAudio();
    this.guard(() => this.present(step, true));
    return true;
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
      this.jumpToLine(preview.line, preview.vars, preview.file);
      const ignored = preview.ignored.length ? ` (ignored: ${preview.ignored.join(', ')})` : '';
      this.toast(`Previewing from ${preview.file ?? 'story.vn'} line ${preview.line}${ignored}`);
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
    this.nextEpoch();
    this.busy = false;
    this.syncScene(scene ?? { bg: null, sprites: [] });
    this.guard(() => this.present(this.runner.startAt(label, { vars, scene })));
  }

  /**
   * Play from a line of the script (dev preview). Uses the given variables, or
   * keeps the current ones; the scene is rebuilt from the top of the label.
   */
  jumpToLine(line: number, vars?: Record<string, Value>, file?: string): void {
    const keep = vars ?? (this.mode === 'title' ? {} : { ...this.runner.vars });
    this.enterPlaying();
    this.auto = this.skip = false;
    this.updateToggles();
    this.nextEpoch();
    this.busy = false;
    this.guard(() => {
      const step = this.runner.startAtLine(line, { vars: keep, ...(file ? { file } : {}) });
      this.syncScene(this.runner.scene());
      this.syncAudio();
      return this.present(step, true);
    });
  }

  setVar(name: string, value: Value): void {
    this.guard(() => this.runner.setVar(name, value));
    this.opts.onUpdate?.(this.runner.block);
  }

  // ---------------------------------------------------------------- flow

  private start(): void {
    this.endingName = null;
    this.enterPlaying();
    this.syncScene({ bg: null, sprites: [] });
    this.stopMusic();
    this.stopAmbience();
    this.stopSounds();
    this.stopVoice();
    this.guard(() => this.present(this.runner.start()));
  }

  private enterPlaying(): void {
    this.mode = 'playing';
    this.closeOverlay();
    this.stage.classList.add('playing');
  }

  private onAdvance(): void {
    if ((this.mode !== 'playing' && this.mode !== 'intro') || this.overlayOpen || this.busy) return;
    const b = this.runner.block;
    if (!b) return;
    if (b.type === 'say' && this.isTyping) {
      this.hurryTyping();
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
    this.nextEpoch();
    this.syncScene(r.scene);
    this.syncAudio();
    this.renderBlock(r.block, true);
  }

  /** Apply a step's effects (animated), then show its block. */
  private async present(step: Step, instant = false): Promise<void> {
    const my = ++this.epoch;
    this.clearTimers();
    this.choicesEl.replaceChildren();
    this.stopVoice();
    this.busy = true;
    try {
      // Hold the step (briefly) until its pictures are ready, so nothing fades in half-loaded.
      const needed = step.effects.flatMap((fx) => fx.type === 'show' ? fx.layers.map(this.assetUrl) : fx.type === 'scene' && fx.path ? [this.assetUrl(fx.path)] : []);
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
    this.images.want(this.runner.upcomingImages().map(this.assetUrl));
  }

  private renderBlock(b: Block, instant: boolean): void {
    this.clearTimers();
    this.choicesEl.replaceChildren();
    this.backBtn.disabled = !this.runner.canGoBack;
    this.textbox.classList.toggle('waiting', false);
    this.nvlEl.classList.remove('waiting');
    // NVL mode shows a page of lines; ADV mode the text box.
    const page = b.type === 'say' || b.type === 'menu' ? this.runner.nvlPage : null;
    if (!page) { this.nvlEl.hidden = true; this.typeTarget = this.textEl; }

    switch (b.type) {
      case 'say':
        if (page) { this.showPage(page, b, instant || this.skip); this.read.add(b.id); break; }
        if (this.skip && this.settings.skipMode === 'read' && !this.read.has(b.id)) {
          this.skip = false;
          this.updateToggles();
          this.toast(this.t('ui.skip_stopped'));
        }
        this.read.add(b.id);
        // Typing speed is the Text speed setting's job alone. Reduced motion (which Windows turns on
        // with "Animation effects" off) is about movement, not letters appearing.
        this.showLine(b, instant || this.skip);
        break;
      case 'menu': {
        if (this.mode === 'intro') { this.showTitleMenu(); break; }
        this.auto = this.skip = false;
        this.updateToggles();
        // Keep the line being responded to on screen (also after load/rollback).
        const prompt = this.runner.lastSay;
        if (page) this.showPage(page, null, true);
        else if (prompt) this.showLine(prompt, true, false);
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
        this.claimFocus(this.choicesEl.firstElementChild as HTMLElement | null);
        break;
      }
      case 'wait':
        this.textbox.hidden = true;
        this.pendingTimer = window.setTimeout(() => this.onAdvance(), this.skip ? 0 : b.seconds * 1000);
        break;
      case 'end':
        if (this.mode === 'intro') this.showTitleMenu();
        else this.showEnd();
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
    // theme.css can style each character's box: .textbox[data-speaker="mira"]
    if (b.who) this.textbox.dataset.speaker = b.who.id;
    else delete this.textbox.dataset.speaker;
    this.sideEl.hidden = !b.side;
    this.textbox.classList.toggle('has-side', !!b.side);
    if (b.side && this.sideEl.getAttribute('src') !== this.assetUrl(b.side)) this.sideEl.src = this.assetUrl(b.side);
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
    window.clearTimeout(this.pauseTimer);
    this.fullText = text;
    this.fullSpans = spans;
    this.shownChars = 0;
    this.held = false;
    this.instantText = instant;
    // Pauses inside the line stop the typing; ones at the very end only matter with [nw].
    this.stops = [];
    this.autoNext = false;
    this.endPause = 0;
    let at = 0;
    for (const sp of spans ?? []) {
      at += sp.text.length;
      if (sp.pause === 'next') this.autoNext = true;
      else if (sp.pause !== undefined && at < text.length) this.stops.push({ at, pause: sp.pause });
      else if (typeof sp.pause === 'number') this.endPause += sp.pause;
    }
    this.typeOn();
  }

  /** Type up to the next pause, or to the end of the line. */
  private typeOn(): void {
    window.clearInterval(this.typingTimer);
    const stop = this.stops[0];
    const until = stop ? stop.at : this.fullText.length;
    const arrive = () => {
      if (!stop) { this.onTextDone(); return; }
      this.stops.shift();
      if (this.skip) this.typeOn();
      else if (stop.pause === 'click') this.holdForClick();
      else this.pauseTimer = window.setTimeout(() => this.typeOn(), stop.pause * 1000);
    };
    if (this.instantText || this.skip || this.shownChars >= until) {
      this.shownChars = until;
      this.renderText();
      arrive();
      return;
    }
    this.typingTimer = window.setInterval(() => {
      this.shownChars++;
      this.renderText();
      if (this.shownChars >= until) {
        window.clearInterval(this.typingTimer);
        arrive();
      }
    }, 1000 / this.settings.textSpeed);
  }

  /** Stop at a `[w]` with the "click to continue" mark; auto mode carries on after its delay. */
  private holdForClick(): void {
    this.held = true;
    this.textbox.classList.add('waiting');
    this.nvlEl.classList.add('waiting');
    if (this.auto) this.pendingTimer = window.setTimeout(() => this.hurryTyping(), this.settings.autoDelay * 1000);
  }

  /** Draw the first `shownChars` characters, keeping bold/italic/colour runs. */
  private renderText(): void {
    if (!this.fullSpans) this.typeTarget.textContent = this.fullText.slice(0, this.shownChars);
    else this.typeTarget.replaceChildren(...spanNodes(this.fullSpans, this.shownChars));
  }

  /**
   * NVL mode: the page so far, with `current` (the line being shown) typing
   * out at the bottom. A page that would overflow turns over: the new line
   * starts a fresh page. Laid out from the first line every time, so rollback
   * and loading land on the same page breaks.
   */
  private showPage(lines: SayBlock[], current: SayBlock | null, instant: boolean): void {
    this.textbox.hidden = true;
    this.nvlEl.hidden = false;
    const nodes = lines.map((b) => {
      const p = el('p', b.who ? 'nvl-line' : 'nvl-line narration');
      if (b.who) p.dataset.speaker = b.who.id;
      if (b.who) {
        const name = el('span', 'nvl-name', b.who.name);
        name.style.color = b.who.color ?? '';
        p.append(name);
      }
      const text = el('span', 'nvl-text');
      if (b.spans) text.append(...spanNodes(b.spans));
      else text.textContent = b.text;
      p.append(text);
      return p;
    });
    this.nvlEl.replaceChildren();
    for (const n of nodes) {
      this.nvlEl.append(n);
      if (this.nvlEl.scrollHeight > this.nvlEl.clientHeight + 1 && this.nvlEl.childElementCount > 1) {
        this.nvlEl.replaceChildren(n); // turn the page
      }
    }
    if (!current) {
      window.clearInterval(this.typingTimer);
      return;
    }
    this.liveRegion.textContent = current.who ? `${current.who.name}: ${current.text}` : current.text;
    this.typeTarget = nodes[nodes.length - 1]!.querySelector<HTMLElement>('.nvl-text')!;
    this.typeText(current.text, current.spans ?? null, instant || this.settings.textSpeed >= INSTANT_SPEED);
  }

  /**
   * A click while the line is still typing: at a `[w]`, go on; otherwise show
   * the rest up to the next `[w]` at once (timed pauses on the way are dropped).
   * `all` shows the whole line (skip mode).
   */
  private hurryTyping(all = false): void {
    if (!this.isTyping) return;
    window.clearInterval(this.typingTimer);
    window.clearTimeout(this.pauseTimer);
    window.clearTimeout(this.pendingTimer);
    this.textbox.classList.remove('waiting');
    this.nvlEl.classList.remove('waiting');
    if (this.held && !all) {
      this.held = false;
      this.typeOn();
      return;
    }
    this.held = false;
    if (all) this.stops = [];
    while (this.stops[0] && this.stops[0].pause !== 'click') this.stops.shift();
    const next = this.stops.shift();
    this.shownChars = next ? next.at : this.fullText.length;
    this.renderText();
    if (next) this.holdForClick();
    else this.onTextDone();
  }

  private onTextDone(): void {
    this.textbox.classList.add('waiting');
    this.nvlEl.classList.add('waiting');
    if (this.autoNext && !this.skip) {
      // [nw]: the line moves on by itself, after any pause at its end.
      this.pendingTimer = window.setTimeout(() => this.onAdvance(), this.endPause * 1000);
    } else if (this.skip) {
      this.pendingTimer = window.setTimeout(() => this.onAdvance(), 40);
    } else if (this.auto && !(this.voice && !this.voice.paused && !this.voice.ended)) {
      const wait = this.settings.autoDelay * 1000 + this.fullText.length * AUTO_PER_CHAR_MS;
      this.pendingTimer = window.setTimeout(() => this.onAdvance(), wait);
    }
  }

  private clearTimers(): void {
    window.clearTimeout(this.pendingTimer);
    window.clearTimeout(this.pauseTimer);
    window.clearInterval(this.typingTimer);
  }

  private toggleAuto(): void {
    this.auto = !this.auto;
    if (this.auto) this.skip = false;
    this.updateToggles();
    if (this.auto && this.held) this.holdForClick();
    else if (this.auto && !this.isTyping && this.runner.block?.type === 'say') this.onTextDone();
    if (!this.auto) window.clearTimeout(this.pendingTimer);
  }

  private toggleSkip(): void {
    this.skip = !this.skip;
    if (this.skip) this.auto = false;
    this.updateToggles();
    if (this.skip) {
      if (this.isTyping) this.hurryTyping(true);
      else if (this.runner.block?.type === 'say') this.onTextDone();
    } else window.clearTimeout(this.pendingTimer);
  }

  private updateToggles(): void {
    this.autoBtn.setAttribute('aria-pressed', String(this.auto));
    this.skipBtn.setAttribute('aria-pressed', String(this.skip));
  }

  // ---------------------------------------------------------- visuals

  /**
   * How long a transition takes, in ms. `with fade 2` is the whole fade (out to
   * black and back), so each half is 1 s; `with dissolve 1.5` is the crossfade.
   */
  private duration(fx: { transition: string | null; duration?: number }, instant: boolean): number {
    const t = fx.transition;
    if (instant || this.reducedMotion || !t || t === 'none') return 0;
    if (fx.duration !== undefined) return t === 'fade' ? (fx.duration * 1000) / 2 : fx.duration * 1000;
    return t === 'fade' ? 450 : t === 'move' ? 500 : 400;
  }

  private async applyEffect(fx: Effect, instant: boolean): Promise<void> {
    switch (fx.type) {
      case 'scene': {
        if (fx.bg) this.markSeen(fx.bg);
        this.nvlEl.replaceChildren();
        const ms = this.duration(fx, instant);
        if (fx.transition === 'fade' && ms) {
          await this.fadeTo(1, ms);
          this.textbox.hidden = true;
          this.setBackground(fx.path, 0);
          this.spriteLayer.replaceChildren();
          this.moveCamera(null, 0);
          await this.fadeTo(0, ms);
        } else {
          // A dissolve also eases a zoomed camera back out, so the old picture doesn't jump.
          this.moveCamera(null, ms);
          for (const s of this.spriteLayer.children) fadeOutAndRemove(s as HTMLElement, ms);
          await this.setBackground(fx.path, ms);
        }
        return;
      }
      case 'show': {
        this.markSeen(`${fx.tag} ${fx.attrs.join(' ')}`.trim());
        const ms = this.duration(fx, instant);
        let sprite = this.spriteEl(fx.tag);
        if (!sprite) {
          sprite = makeSprite(fx.tag, fx.layers.map(this.assetUrl), fx.at);
          sprite.style.opacity = ms ? '0' : '1';
          this.spriteLayer.append(sprite);
          if (ms) await animateOpacity(sprite, 1, ms);
        } else {
          const left = positionLeft(fx.at) ?? sprite.style.left;
          setLayers(sprite, fx.layers.map(this.assetUrl));
          if (fx.transition === 'move' && ms && left !== sprite.style.left) {
            sprite.style.transition = `left ${ms}ms ease-in-out`;
            sprite.style.left = left;
            await delay(ms);
            sprite.style.transition = '';
          } else sprite.style.left = left;
        }
        return;
      }
      case 'hide': {
        const sprite = this.spriteEl(fx.tag);
        if (sprite) await fadeOutAndRemove(sprite, this.duration(fx, instant));
        return;
      }
      case 'play': {
        const fadeMs = instant ? 0 : (fx.fade ?? 0) * 1000;
        if (fx.channel === 'music') this.playMusic(fx.path, fx.loop, fadeMs);
        else if (fx.channel === 'ambience') this.playAmbience(fx.path, fx.loop, fadeMs);
        else if (fx.channel === 'sound' && fx.loop) this.playLoopSound(fx.path, fadeMs);
        // Skipping, rolling back or loading: don't fire a burst of old sound effects or voices.
        else if (instant) return;
        else if (fx.channel === 'voice') this.playVoice(fx.path);
        else this.playSound(fx.path);
        return;
      }
      case 'stop': {
        const fadeMs = instant ? 0 : (fx.fade ?? 0) * 1000;
        if (fx.channel === 'music') this.stopMusic(fadeMs);
        else if (fx.channel === 'ambience') this.stopAmbience(fadeMs);
        else if (fx.channel === 'sound') this.stopSounds(fadeMs);
        else this.stopVoice();
        return;
      }
      case 'achieve':
        this.unlockAchievement(fx.id, fx.name);
        return;
      case 'globals':
        storage.set(`${this.storeKey}:globals`, JSON.stringify(fx.values));
        return;
      case 'ending':
        this.progress.reachEnding(fx.id);
        this.endingName = fx.name;
        return;
      case 'shake':
        if (!instant && !this.reducedMotion) this.shake((fx.duration ?? 0.5) * 1000);
        return;
      case 'flash':
        // Flashing is skipped with reduced motion (it can be uncomfortable), and while skipping.
        if (!instant && !this.reducedMotion) await this.flash(fx.color, (fx.duration ?? 0.6) * 1000);
        return;
      case 'camera':
        this.moveCamera(fx.camera, instant || this.reducedMotion ? 0 : (fx.duration ?? 0) * 1000);
        return;
      case 'motion':
        if (!instant && !this.reducedMotion) this.motion(fx.motion, fx.target, fx.times);
        return;
      case 'movie':
        if (!instant) await this.playMovie(fx.path);
        return;
    }
  }

  /** Whatever is under way belongs to an earlier moment now: stop waiting for it. */
  private nextEpoch(): void {
    this.epoch++;
    this.endMovie?.();
  }

  /**
   * A character (or the text box) hops, nods, bows or shakes its head. Distances
   * are in hundredths of the screen's height, so moves look the same at any size.
   * Runs in the background, through `translate`, which leaves the sprite's own
   * positioning (`left`, `transform`) alone.
   */
  private motion(kind: 'hop' | 'nod' | 'bow' | 'shake', target: string, times: number): void {
    const node = target === 'textbox' ? this.textbox : this.spriteEl(target);
    if (!node) return;
    const u = this.stage.clientHeight / 100;
    const y = (...v: number[]) => v.map((n) => ({ translate: `0 ${n * u}px` }));
    const moves: Record<typeof kind, { frames: Keyframe[]; ms: number; easing: string }> = {
      hop: { frames: y(0, -1.6, 0), ms: 280, easing: 'ease-out' },
      nod: { frames: [{ translate: '0 0' }, { translate: `0 ${u}px`, offset: 0.5 }, { translate: `0 ${0.45 * u}px`, offset: 0.75 }, { translate: '0 0' }], ms: 260, easing: 'ease-out' },
      bow: { frames: [{ translate: '0 0' }, { translate: `0 ${1.9 * u}px`, offset: 0.4 }, { translate: `0 ${1.8 * u}px`, offset: 0.7 }, { translate: '0 0' }], ms: 1500, easing: 'ease-in-out' },
      shake: { frames: [-1.1, 1.1, -1.1, 0].reduce<Keyframe[]>((f, n) => [...f, { translate: `${n * u}px 0` }], [{ translate: '0 0' }]), ms: 480, easing: 'ease-out' },
    };
    const m = moves[kind];
    node.animate(m.frames, { duration: m.ms, easing: m.easing, iterations: times });
  }

  /**
   * Play a movie over the whole stage and wait for it to end. A click, Enter,
   * Space or Escape skips it; leaving the scene (loading, the title) stops it.
   * It plays at the music volume, and silently if the browser won't allow sound.
   */
  private playMovie(path: string): Promise<void> {
    this.endMovie?.();
    return new Promise((resolve) => {
      const video = el('video', 'movie') as HTMLVideoElement;
      video.src = this.assetUrl(path);
      video.playsInline = true;
      video.volume = Math.min(1, Math.max(0, this.settings.musicVolume));
      video.setAttribute('aria-label', this.t('ui.skip'));
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        finish();
      };
      const finish = () => {
        if (this.endMovie !== finish) return;
        this.endMovie = null;
        window.removeEventListener('keydown', onKey, true);
        video.pause();
        video.removeAttribute('src');
        video.remove();
        resolve();
      };
      this.endMovie = finish;
      video.addEventListener('ended', finish);
      video.addEventListener('error', finish);
      video.addEventListener('click', (e) => { e.stopPropagation(); finish(); });
      window.addEventListener('keydown', onKey, true);
      this.stage.append(video);
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(finish);
      });
    });
  }

  // ---------------------------------------------------------- screen effects

  /**
   * Zoom the picture toward a point. With the transform origin at the top left,
   * `translate((1 - z) * x%, (1 - z) * y%) scale(z)` keeps the point (x%, y%)
   * where it is on screen, so a zoom of 1 or more never shows past the edges.
   * Runs in the background: a slow pan can play under the next lines.
   */
  private moveCamera(cam: CameraState | null, ms: number): void {
    const transform = cam ? `translate(${(1 - cam.zoom) * cam.x}%, ${(1 - cam.zoom) * cam.y}%) scale(${cam.zoom})` : '';
    for (const layer of [this.bgLayer, this.spriteLayer]) {
      if (layer.style.transform === transform) continue;
      layer.style.transition = ms ? `transform ${ms}ms ease-in-out` : 'none';
      layer.style.transform = transform;
    }
  }

  /** Shake the picture for `ms`, dying down; the text keeps going meanwhile. */
  private shake(ms: number): void {
    const frames: Keyframe[] = [];
    const n = Math.max(4, Math.round(ms / 45));
    for (let i = 0; i < n; i++) {
      const a = 1.4 * (1 - i / n); // percent of the screen
      frames.push({ translate: `${i % 2 ? a : -a}% ${((i * 7) % 3 - 1) * a * 0.6}%` });
    }
    frames.push({ translate: '0 0' });
    for (const layer of [this.bgLayer, this.spriteLayer]) layer.animate(frames, { duration: ms });
  }

  /**
   * Flash the screen: the colour comes up fast and fades out over the rest of
   * `ms`. Waits only until the screen is covered, so a `scene` right after a
   * `flash` changes under it.
   */
  private async flash(color: string, ms: number): Promise<void> {
    const rise = Math.min(120, ms * 0.25);
    this.flashEl.style.background = color;
    this.flashEl.animate([{ opacity: 0 }, { opacity: 1, offset: rise / ms }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
    await delay(rise);
  }

  /** `global var` values from earlier playthroughs on this device. */
  private loadGlobals(): void {
    if (!this.story.globals?.length) return;
    try {
      const raw = JSON.parse(storage.get(`${this.storeKey}:globals`) ?? '{}') as unknown;
      if (raw && typeof raw === 'object') this.runner.setGlobals(raw as Record<string, Value>);
    } catch { /* corrupt: start over */ }
  }

  /**
   * Remember an achievement (per game, on this device), tell the platform
   * (Steam), and show a notice the first time unless the platform shows its own.
   */
  private unlockAchievement(id: string, name: string): void {
    const key = `${this.storeKey}:achievements`;
    let have: string[] = [];
    try { have = JSON.parse(storage.get(key) ?? '[]') as string[]; } catch { /* corrupt: start over */ }
    const isNew = Array.isArray(have) && !have.includes(id);
    if (isNew) storage.set(key, JSON.stringify([...have, id]));
    this.host.unlockAchievement?.(id);
    if (isNew && !this.host.notifiesAchievements) this.toast(this.t('ui.achievement', { name }));
  }

  private async setBackground(path: string | null, ms: number): Promise<void> {
    const next = el('div', 'bg');
    if (path) next.style.backgroundImage = `url("${this.assetUrl(path)}")`;
    next.style.opacity = ms ? '0' : '1';
    const old = [...this.bgLayer.children] as HTMLElement[];
    this.bgLayer.append(next);
    if (ms) await animateOpacity(next, 1, ms);
    old.forEach((o) => o.remove());
  }

  private fadeTo(opacity: number, ms: number): Promise<void> {
    return animateOpacity(this.fader, opacity, ms);
  }

  /** The character on screen with this tag. */
  private spriteEl(tag: string): HTMLElement | null {
    return this.spriteLayer.querySelector<HTMLElement>(`.sprite[data-tag="${cssEscape(tag)}"]`);
  }

  /** Redraw the scene from state, without animation (load, rollback). */
  private syncScene(scene: SceneState): void {
    this.fader.style.opacity = '0';
    void this.setBackground(this.runner.imagePath(scene.bg), 0);
    this.moveCamera(scene.camera ?? null, 0);
    this.spriteLayer.replaceChildren();
    for (const sp of scene.sprites) {
      const layers = this.runner.spriteLayers(sp);
      if (layers?.length) this.spriteLayer.append(makeSprite(sp.tag, layers.map(this.assetUrl), sp.at));
    }
  }

  // ---------------------------------------------------------- audio

  /** Start a music track; with `fadeMs`, the old track fades out while the new one fades in. */
  private playMusic(path: string, loop: boolean, fadeMs = 0): void {
    if (this.music?.path === path) return;
    this.stopMusic(fadeMs);
    this.music = this.loops.play(path, asset(path), loop, this.settings.musicVolume, fadeMs);
  }

  private stopMusic(fadeMs = 0): void {
    this.music?.stop(fadeMs);
    this.music = null;
  }

  /** `play ambience rain`: a loop under the music, at the sound effects volume. */
  private playAmbience(path: string, loop: boolean, fadeMs = 0): void {
    if (this.ambience?.path === path) return;
    this.stopAmbience(fadeMs);
    this.ambience = this.loops.play(path, asset(path), loop, this.settings.soundVolume, fadeMs);
  }

  private stopAmbience(fadeMs = 0): void {
    this.ambience?.stop(fadeMs);
    this.ambience = null;
  }

  /** Match the audio to the story's state after a jump in time (load, rollback, edit). */
  private syncAudio(): void {
    const { music, sound, ambience } = this.runner.audio();
    if (music) this.playMusic(music.path, music.loop);
    else this.stopMusic();
    if (ambience) this.playAmbience(ambience.path, true);
    else this.stopAmbience();
    this.stopVoice();
    for (const a of this.sounds) a.pause();
    this.sounds.clear();
    if (sound) this.playLoopSound(sound.path);
    else this.stopSounds();
  }

  private playVoice(path: string): void {
    this.stopVoice();
    const a = new Audio(asset(path));
    a.volume = this.settings.voiceVolume;
    a.addEventListener('ended', () => {
      if (this.voice !== a) return;
      this.voice = null;
      // Auto mode was waiting for the voice to finish.
      if (this.auto && !this.isTyping && this.runner.block?.type === 'say') this.onTextDone();
    });
    a.play().catch(() => { if (this.voice === a) this.voice = null; });
    this.voice = a;
  }

  private stopVoice(): void {
    this.voice?.pause();
    this.voice = null;
  }

  private playSound(path: string): void {
    const a = new Audio(asset(path));
    a.volume = this.settings.soundVolume;
    this.sounds.add(a);
    a.addEventListener('ended', () => this.sounds.delete(a));
    a.play().catch(() => this.sounds.delete(a));
  }

  private playLoopSound(path: string, fadeMs = 0): void {
    if (this.loopSound?.path === path) return;
    this.stopLoopSound(fadeMs);
    this.loopSound = this.loops.play(path, asset(path), true, this.settings.soundVolume, fadeMs);
  }

  private stopLoopSound(fadeMs = 0): void {
    this.loopSound?.stop(fadeMs);
    this.loopSound = null;
  }

  /** `stop sound`: the looping sound and any effects still ringing. */
  private stopSounds(fadeMs = 0): void {
    this.stopLoopSound(fadeMs);
    for (const a of this.sounds) {
      if (fadeMs) void fadeVolume(a, () => 0, fadeMs).then(() => a.pause());
      else a.pause();
    }
    this.sounds.clear();
  }

  // ---------------------------------------------------------- screens

  private get overlayOpen(): boolean {
    return this.overlay.classList.contains('open');
  }

  private openOverlay(cls: string, ...children: Node[]): void {
    this.clearTimers();
    this.overlay.onkeydown = null;
    this.overlay.className = `overlay open ${cls}`;
    this.overlay.replaceChildren(...children);
    this.claimFocus(this.overlay.querySelector('button'));
  }

  /**
   * Focus a control in the game, but only if the keyboard is the game's to take
   * (nothing else focused, or already inside the game). When the player is
   * embedded, e.g. in the editor, it must never pull focus out of the script.
   */
  private claimFocus(target: HTMLElement | null): void {
    const active = document.activeElement;
    if (!target || (active && active !== document.body && !this.stage.contains(active))) return;
    target.focus({ preventScroll: true });
  }

  private closeOverlay(): void {
    const wasOpen = this.overlayOpen;
    this.overlay.className = 'overlay';
    this.overlay.replaceChildren();
    if (this.redrawOnClose && this.mode === 'playing' && this.runner.block) {
      this.redrawOnClose = false;
      this.renderBlock(this.runner.block, true);
      return;
    }
    // Resume auto/skip timers that were paused by the overlay.
    if (wasOpen && this.mode === 'playing' && this.runner.block?.type === 'say' && !this.isTyping) this.onTextDone();
  }

  /**
   * The title screen. A story with a `label title` gets its own: that label
   * plays (scenes, music, opening lines) and its menu becomes the title menu.
   * Otherwise the built-in one, shaped by the header (title_image, title_music,
   * title_logo, title_layout, title_buttons).
   */
  private showTitle(): void {
    this.opts.onUpdate?.(null);
    this.mode = 'title';
    this.nextEpoch();
    this.clearTimers();
    this.stopMusic();
    this.stopAmbience();
    this.stopSounds();
    this.stopVoice();
    this.auto = this.skip = false;
    this.updateToggles();
    this.stage.classList.remove('playing');
    this.textbox.hidden = true;
    this.choicesEl.replaceChildren();
    this.spriteLayer.replaceChildren();
    this.moveCamera(null, 0);
    this.closeOverlay();

    if (this.story.labels.title !== undefined) {
      this.mode = 'intro';
      this.syncScene({ bg: null, sprites: [] });
      this.guard(() => this.present(this.runner.startAt('title')));
      return;
    }
    const meta = this.story.meta;
    void this.setBackground(meta.title_image ? this.imageAsset(meta.title_image) : null, 0);
    if (meta.title_music) this.playMusic(this.story.audio[meta.title_music] ?? meta.title_music, true);
    this.images.want(new Runner(this.story).upcomingImages().map(asset)); // the opening scene
    this.showTitleMenu();
  }

  /** The title menu over whatever the title screen shows: the story's own choices first, then built-in buttons. */
  private showTitleMenu(): void {
    this.mode = 'title';
    this.textbox.hidden = true;
    this.choicesEl.replaceChildren();
    const meta = this.story.meta;
    const block = this.story.labels.title !== undefined ? this.runner.block : null;
    const own = block?.type === 'menu' ? block.choices : null;

    const menu = el('div', 'title-menu');
    for (const c of own ?? []) {
      const b = button(c.text, () => this.startFromTitle(c.index));
      if (c.spans) b.replaceChildren(...spanNodes(c.spans));
      b.classList.add('title-choice');
      menu.append(b);
    }
    const hasSaves = this.slots().some(Boolean);
    const quit = this.host.quit;
    for (const id of titleButtons(meta.title_buttons)) {
      if (id === 'start' && !own) menu.append(button(this.t('ui.start'), () => this.start()));
      if (id === 'load' && hasSaves) menu.append(button(this.t('ui.load'), () => this.showSlots('load')));
      if (id === 'extras' && this.extrasTabs().length) menu.append(button(this.t('ui.extras'), () => this.showExtras()));
      if (id === 'settings') menu.append(button(this.t('ui.settings'), () => this.showSettings()));
      if (id === 'quit' && quit && this.opts.ownsDocument) menu.append(button(this.t('ui.quit'), () => quit()));
    }
    let heading: HTMLElement;
    if (meta.title_logo) {
      const img = el('img', 'title-logo') as HTMLImageElement;
      img.src = this.assetUrl(this.imageAsset(meta.title_logo));
      img.alt = this.title;
      heading = img;
    } else heading = el('h1', 'title', this.title);
    const layout = ['left', 'right', 'bottom'].includes(meta.title_layout ?? '') ? ` title-${meta.title_layout}` : '';
    this.openOverlay(`title-screen${layout}`,
      heading,
      ...(meta.author ? [el('p', 'byline', meta.author)] : []),
      menu,
      el('p', 'made-with', this.t('ui.made_with')),
    );
  }

  // ---------------------------------------------------------- extras

  /** A gallery image was shown: remember it for the Extras gallery. */
  private markSeen(image: string): void {
    if (this.story.gallery?.includes(image)) this.progress.seeImage(image);
  }

  /** The Extras tabs this story has something for. */
  private extrasTabs(): Array<'gallery' | 'endings' | 'achievements'> {
    const s = this.story;
    return [
      ...(s.gallery?.length ? ['gallery' as const] : []),
      ...(s.endings && Object.keys(s.endings).length ? ['endings' as const] : []),
      ...(s.achievements && Object.keys(s.achievements).length ? ['achievements' as const] : []),
    ];
  }

  /** Extras: gallery images seen, endings reached and achievements earned (locked ones as ???). */
  private showExtras(tab = this.extrasTabs()[0]): void {
    const tabs = this.extrasTabs();
    if (!tab) return;
    const bar = el('div', 'row extras-tabs');
    bar.setAttribute('role', 'tablist');
    for (const t of tabs) {
      const b = button(this.t(`ui.${t}`), () => this.showExtras(t));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t === tab));
      bar.append(b);
    }
    const name = (id: string, table: Record<string, { name: string }> | undefined, kind: string) =>
      this.translation?.strings[`${kind}.${id}`]?.text ?? table?.[id]?.name ?? id;
    let body: HTMLElement;
    let count: string;
    if (tab === 'gallery') {
      const images = this.story.gallery ?? [];
      const seen = images.filter((i) => this.progress.hasSeen(i));
      count = this.t('ui.count', { n: seen.length, total: images.length });
      body = el('div', 'gallery');
      for (const image of images) {
        if (!this.progress.hasSeen(image)) { body.append(el('div', 'gallery-item locked', '?')); continue; }
        const b = button('', () => this.viewImage(seen, seen.indexOf(image)));
        b.className = 'gallery-item';
        const img = el('img') as HTMLImageElement;
        img.src = this.assetUrl(this.story.images[image]!);
        img.alt = '';
        img.loading = 'lazy';
        b.append(img);
        body.append(b);
      }
    } else {
      const table = tab === 'endings' ? this.story.endings : this.story.achievements;
      const ids = Object.keys(table ?? {});
      const earned = tab === 'endings' ? (id: string) => this.progress.hasReached(id) : (id: string) => this.achievements().includes(id);
      count = this.t('ui.count', { n: ids.filter(earned).length, total: ids.length });
      body = el('ol', 'extras-list');
      for (const id of ids) {
        const got = earned(id);
        body.append(el('li', got ? 'unlocked' : 'locked', got ? name(id, table, tab === 'endings' ? 'ending' : 'achievement') : this.t('ui.locked')));
      }
    }
    this.openOverlay('panel extras-panel', el('h2', '', this.t('ui.extras')), ...(tabs.length > 1 ? [bar] : []),
      el('p', 'extras-count', count), body, button(this.t('ui.close'), () => this.showTitleMenu()));
  }

  /** One gallery image over the whole screen; click, arrows or Esc. */
  private viewImage(images: string[], index: number): void {
    const show = (i: number) => {
      const n = (i + images.length) % images.length;
      const img = el('img', 'gallery-full') as HTMLImageElement;
      img.src = this.assetUrl(this.story.images[images[n]!]!);
      img.alt = '';
      const close = button(this.t('ui.close'), () => this.showExtras('gallery'));
      close.className = 'gallery-close';
      this.openOverlay('gallery-view', img, close);
      img.addEventListener('click', () => (images.length > 1 ? show(n + 1) : this.showExtras('gallery')));
      this.overlay.onkeydown = (e) => {
        if (e.key === 'Escape') this.showExtras('gallery');
        else if (e.key === 'ArrowRight') show(n + 1);
        else if (e.key === 'ArrowLeft') show(n - 1);
        else return;
        e.preventDefault();
      };
    };
    show(index);
  }

  /** Ids of the achievements earned on this device. */
  private achievements(): string[] {
    try {
      const raw = JSON.parse(storage.get(`${this.storeKey}:achievements`) ?? '[]') as unknown;
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
  }

  /** A choice on a scripted title screen: the story continues from that choice as a new game. */
  private startFromTitle(index: number): void {
    if (this.busy) return;
    this.endingName = null;
    this.enterPlaying();
    this.runner.clearHistory(); // going back can't return into the title screen
    this.guard(() => this.present(this.runner.choose(index)));
  }

  /** An image name from the story, or a path in assets/. */
  private imageAsset(nameOrPath: string): string {
    return this.story.images[nameOrPath] ?? nameOrPath;
  }

  private showEnd(): void {
    if (this.mode === 'ended') return;
    this.mode = 'ended';
    this.clearTimers();
    this.auto = this.skip = false;
    this.updateToggles();
    this.openOverlay('end-screen',
      el('h2', '', this.t('ui.the_end')),
      ...(this.endingName ? [el('p', 'ending-name', this.endingName)] : []),
      button(this.t('ui.back_to_title'), () => this.showTitle()),
      button(this.t('ui.undo_last_line'), () => { this.mode = 'playing'; this.closeOverlay(); this.back(); }),
    );
  }

  private confirmTitle(): void {
    this.openOverlay('panel',
      el('h2', '', this.t('ui.return_to_title_question')),
      el('p', '', this.t('ui.unsaved_progress_lost')),
      row(button(this.t('ui.return_to_title'), () => this.showTitle()), button(this.t('ui.keep_playing'), () => this.closeOverlay())),
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
      if (b.voice) {
        const voice = b.voice;
        const play = button('▶', () => this.playVoice(voice), this.t('ui.replay_voice'));
        play.className = 'log-voice';
        play.setAttribute('aria-label', this.t('ui.replay_voice'));
        li.append(play);
      }
      list.append(li);
    }
    this.openOverlay('panel log-panel', el('h2', '', this.t('ui.history')), list, button(this.t('ui.close'), () => this.closeOverlay()));
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

  // ---------------------------------------------------------- language

  /** Interface text in the current language. */
  private t(key: UiKey, vars?: Record<string, string | number>): string {
    return fill(this.translation?.strings[key]?.text ?? UI_STRINGS[key], vars);
  }

  private get title(): string {
    return this.translation?.meta.title ?? this.story.meta.title ?? this.t('ui.untitled');
  }

  /** The language the script is written in (`language:` in its header; English if not given). */
  private get sourceLanguage(): string {
    return this.story.meta.language ?? 'en';
  }

  /** URL of a picture or movie, in the chosen language's version when the game has one (`cg/sign.fr.png`). */
  private readonly assetUrl = (path: string): string => asset(this.translation?.assets?.[path] ?? path);

  /** The language the player chose, or the best match for their device. */
  private chooseTranslation(): CompiledTranslation | null {
    const list = this.opts.translations ?? [];
    const source = this.sourceLanguage;
    const wanted = this.settings.language === 'auto'
      ? (typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [])
      : [this.settings.language];
    const code = matchLanguage(wanted, [source, ...list.map((x) => x.lang)]);
    return code && code !== source ? list.find((x) => x.lang === code) ?? null : null;
  }

  /** Switch story and interface text to the chosen language, redrawing whatever is on screen. */
  /** Header options that shape the stage: `aspect` (16:9 unless set) and `narration` style. */
  private applyStageShape(): void {
    const ratio = this.story.meta.aspect ? parseAspect(this.story.meta.aspect) : null;
    if (ratio) this.stage.style.setProperty('--aspect', String(ratio));
    else this.stage.style.removeProperty('--aspect');
    this.stage.classList.toggle('narration-plain', this.story.meta.narration === 'plain');
  }

  private applyLanguage(): void {
    const next = this.chooseTranslation();
    const changed = next !== this.translation;
    this.translation = next;
    const lang = next?.lang ?? this.sourceLanguage;
    this.stage.lang = lang;
    this.stage.dir = isRtl(lang) ? 'rtl' : 'ltr';
    for (const b of this.quickMenu.querySelectorAll<HTMLButtonElement>('button[data-text]')) {
      b.textContent = this.t(b.dataset.text as UiKey);
      b.title = b.dataset.hint ? this.t(b.dataset.hint as UiKey) : '';
    }
    this.quickMenu.setAttribute('aria-label', this.t('ui.game_menu'));
    this.choicesEl.setAttribute('aria-label', this.t('ui.choices'));
    if (this.opts.ownsDocument) {
      document.documentElement.lang = lang;
      document.title = this.title;
    }
    if (!changed) return;
    const block = this.runner.setTranslation(next);
    // Pictures with text in them may have a version for the new language.
    if (this.mode === 'playing' && (this.translation?.assets || this.translationHadAssets)) this.syncScene(this.runner.save().state.scene);
    this.translationHadAssets = !!this.translation?.assets;
    if (this.mode === 'title' && this.overlay.classList.contains('title-screen')) this.showTitleMenu();
    else if (this.mode === 'playing' && block) {
      if (this.overlayOpen) this.redrawOnClose = true;
      else this.renderBlock(block, true);
    }
  }

  // ---------------------------------------------------------- settings

  /** Push settings into CSS variables and live audio. */
  private applySettings(): void {
    const s = this.settings;
    this.stage.style.setProperty('--text-scale', String(s.textScale));
    this.stage.style.setProperty('--box-alpha', String(s.boxOpacity));
    for (const [id] of FONTS) this.stage.classList.toggle(`font-${id}`, s.font === id);
    this.stage.classList.toggle('reduced-motion', this.reducedMotion);
    this.stage.classList.toggle('full-motion', s.motion === 'full');
    void this.music?.fadeTo(s.musicVolume, 0);
    void this.loopSound?.fadeTo(s.soundVolume, 0);
    void this.ambience?.fadeTo(s.soundVolume, 0);
    if (this.voice) this.voice.volume = s.voiceVolume;
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

    const choice = <K extends 'font' | 'motion' | 'language' | 'skipMode'>(key: K, label: string, options: ReadonlyArray<readonly [Settings[K], string]>) => {
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
      select.addEventListener('change', () => {
        this.updateSettings({ [key]: select.value } as Partial<Settings>);
        if (key !== 'language') return;
        // Redraw everything, this screen included, in the new language.
        this.applyLanguage();
        this.showSettings();
        this.stage.querySelector<HTMLElement>('#set-language')?.focus();
      });
      form.append(lab, select, el('span'));
    };

    const t = (k: UiKey, vars?: Record<string, string | number>) => this.t(k, vars);
    const translations = this.opts.translations ?? [];
    if (translations.length) {
      const source = this.sourceLanguage;
      choice('language', t('ui.language'), [
        ['auto', t('ui.language_auto')],
        [source, languageName(source)],
        ...translations.filter((x) => x.lang !== source).map((x) => [x.lang, languageName(x.lang)] as const),
      ]);
    }
    const host = this.host;
    if (host.setFullscreen && this.opts.ownsDocument) {
      const lab = el('label', '', t('ui.fullscreen'));
      lab.htmlFor = 'set-fullscreen';
      const select = el('select');
      select.id = 'set-fullscreen';
      for (const [value, text] of [['on', t('ui.on')], ['off', t('ui.off')]] as const) {
        const o = el('option', '', text);
        o.value = value;
        select.append(o);
      }
      select.value = 'off';
      void host.isFullscreen?.().then((on) => { select.value = on ? 'on' : 'off'; });
      select.addEventListener('change', () => {
        void host.setFullscreen!(select.value === 'on').then((on) => { select.value = on ? 'on' : 'off'; });
      });
      form.append(lab, select, el('span'));
    }
    slider('textSpeed', t('ui.text_speed'), (v) => (v >= INSTANT_SPEED ? t('ui.instant') : t('ui.letters_per_second', { n: v })));
    slider('autoDelay', t('ui.auto_wait'), (v) => t('ui.seconds', { n: v.toFixed(2).replace(/0$/, '') }));
    slider('musicVolume', t('ui.music_volume'), pct);
    slider('soundVolume', t('ui.sound_volume'), pct);
    slider('voiceVolume', t('ui.voice_volume'), pct);
    slider('textScale', t('ui.text_size'), pct);
    slider('boxOpacity', t('ui.box_opacity'), pct);
    choice('font', t('ui.font'), FONTS.map(([id]) => [id, t(`ui.font_${id}`)] as const));
    choice('skipMode', t('ui.skip_mode'), [['read', t('ui.skip_read')], ['all', t('ui.skip_all')]]);
    choice('motion', t('ui.animations'), [['system', t('ui.motion_system')], ['full', t('ui.motion_full')], ['reduced', t('ui.motion_reduced')]]);

    const preview = el('p', 'settings-preview', t('ui.settings_preview'));
    const done = () => (fromTitle ? this.showTitleMenu() : this.closeOverlay());
    const reset = button(t('ui.reset_settings'), () => {
      this.updateSettings({ ...DEFAULT_SETTINGS, language: this.settings.language });
      this.showSettings();
    });
    this.openOverlay('panel settings-panel', el('h2', '', t('ui.settings')), form, preview, row(reset, button(t('ui.done'), done)));
  }

  private showSlots(kind: 'save' | 'load'): void {
    const canSave = kind === 'save' && this.mode === 'playing' && this.runner.block !== null;
    const grid = el('div', 'slots');
    this.slots().forEach((s, i) => {
      const label = s
        ? `${new Date(s.savedAt).toLocaleString()} — ${truncate(s.preview, 60)}`
        : this.t('ui.empty');
      const b = button(this.t('ui.slot', { n: i + 1, label }), () => {
        if (kind === 'save') this.saveTo(i);
        else if (s) this.loadFrom(s);
      });
      b.disabled = kind === 'save' ? !canSave : !s;
      grid.append(b);
    });
    this.openOverlay('panel', el('h2', '', this.t(kind === 'save' ? 'ui.save' : 'ui.load')), grid,
      button(this.t('ui.close'), () => (this.mode === 'title' ? this.showTitleMenu() : this.closeOverlay())));
  }

  private saveTo(i: number): void {
    const data = this.runner.save();
    const b = data.block;
    const preview = b.type === 'say' ? (b.who ? `${b.who.name}: ${b.text}` : b.text) : this.t('ui.at_a_choice');
    const ok = storage.set(`${this.storeKey}:slot${i}`, JSON.stringify({ ...data, preview }));
    this.closeOverlay();
    this.toast(ok ? this.t('ui.saved_to_slot', { n: i + 1 }) : this.t('ui.could_not_save'));
  }

  private loadFrom(data: SaveData): void {
    const r = this.runner.load(data);
    if (!r.ok) { this.toast(this.t('ui.could_not_load')); return; }
    this.enterPlaying();
    this.nextEpoch();
    this.syncScene(this.runner.scene());
    this.syncAudio();
    this.renderBlock(this.runner.block!, true);
    this.toast(this.t(r.mismatch ? 'ui.loaded_changed' : 'ui.loaded'));
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
    if (this.mode === 'intro' && !this.overlayOpen && [' ', 'Enter', 'ArrowRight', 'PageDown'].includes(e.key)) {
      if (document.activeElement instanceof HTMLButtonElement) return;
      e.preventDefault();
      this.onAdvance();
      return;
    }
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

  /** The phone's back button: close what's open, then offer to leave, then quit. */
  private handleBack(): void {
    if (this.mode === 'title') {
      if (this.overlay.classList.contains('title-screen')) this.host.quit?.();
      else this.showTitleMenu();
      return;
    }
    if (this.mode === 'intro') { this.host.quit?.(); return; }
    if (this.overlayOpen && this.mode === 'playing') this.closeOverlay();
    else if (this.mode === 'ended') this.showTitle();
    else this.confirmTitle();
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
    this.openOverlay('panel error-panel', el('h2', '', this.t('ui.error_title')), el('p', '', msg),
      button(this.t('ui.back_to_title'), () => this.showTitle()));
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

/**
 * A character on screen: a box holding one image per layer, bottom first (a
 * plain sprite has one). The first image sizes the box; the others lie on top.
 */
function makeSprite(tag: string, urls: string[], at: string): HTMLElement {
  const sprite = el('div', 'sprite');
  sprite.dataset.tag = tag;
  sprite.style.left = positionLeft(at) ?? POSITIONS.center!;
  setLayers(sprite, urls);
  return sprite;
}

/** Point a sprite's images at `layers`, keeping the ones that don't change (no reload, no flicker). */
function setLayers(sprite: HTMLElement, urls: string[]): void {
  const imgs = [...sprite.children] as HTMLImageElement[];
  urls.forEach((url, i) => {
    let img = imgs[i];
    if (!img) {
      img = el('img') as HTMLImageElement;
      img.alt = '';
      sprite.append(img);
    }
    if (img.getAttribute('src') !== url) img.src = url;
  });
  for (const extra of imgs.slice(urls.length)) extra.remove();
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fadeOutAndRemove(node: HTMLElement, ms: number): Promise<void> {
  await animateOpacity(node, 0, ms);
  node.remove();
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

/** The built-in title buttons a story asked for (header `title_buttons: start, settings`), else all of them. */
export function titleButtons(spec: string | undefined): Array<(typeof TITLE_BUTTONS)[number]> {
  if (!spec) return [...TITLE_BUTTONS];
  return spec.split(/[\s,]+/).filter((b): b is (typeof TITLE_BUTTONS)[number] => (TITLE_BUTTONS as readonly string[]).includes(b));
}

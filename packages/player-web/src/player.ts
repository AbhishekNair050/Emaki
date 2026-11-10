/**
 * DOM player: renders a Runner's steps in the browser.
 *
 * Deliberately plain DOM + CSS (no canvas) for v0: accessible by default,
 * crisp text at any size, tiny download. A WebGL renderer can implement the
 * same Effect/Block contract later for shaders and particle effects.
 */
import {
  evaluate, isPercentPosition, parseAspect, parseCanvas, saveSlotCount,
  type CompiledScreenItem, type CompiledStory, type CompiledTranslation, type ScreenAction, type Span, type Value,
} from '@emaki/format';
import {
  Runner, StoryError,
  type Block, type CameraState, type Effect, type SaveData, type SayBlock, type SceneState, type Step,
} from '@emaki/runtime';
import {
  DEFAULT_SETTINGS, FONTS, INSTANT_SPEED, RANGES, loadSettings, saveSettings, sanitizeSettings, type ConfirmKind, type Settings,
} from './settings.ts';
import { ImagePreloader } from './preload.ts';
import { watchGamepads } from './gamepad.ts';
import { PluginManager, type PluginSetup } from './plugins.ts';
import { renderScreen, type ScreenHost } from './screens.ts';
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
  /** The game's plugins (plugins/<name>/index.js default exports), by name. */
  plugins?: Readonly<Record<string, PluginSetup>>;
}

export class Player {
  private runner: Runner;
  private story: CompiledStory;
  private readonly opts: PlayerOptions;
  private readonly storeKey: string;
  private translation: CompiledTranslation | null = null;
  /** The game's own screens open now, the top one showing (`open about` from the title pushes `about`). */
  private screenStack: string[] = [];
  /** The game's screens shown over the story (`show screen`, `call screen`). */
  private readonly screenLayer: HTMLElement;
  private readonly nextEl: HTMLElement;
  /** Who says the line on screen ("" for narration), for `screen textbox`. */
  private speaking = '';
  /** Story screens drawn last time, so only newly shown ones play their transition. */
  private drawnStoryScreens = new Set<string>();
  /** The page each screen's slots or gallery is on, from 0. */
  private screenPages: Record<string, number> = {};
  /** Last known full-screen state, for a `toggle ... fullscreen` (the host answers asynchronously). */
  private fullscreenOn = false;
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
    this.nextEl = el('div', 'next-indicator', '▾');
    this.textbox.append(this.sideEl, this.namebox, this.textEl, this.liveRegion, this.nextEl);
    this.screenLayer = el('div', 'layer screen-layer');
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
      label(button('', () => (this.story.screens?.menu ? this.openScreen('menu', true) : this.confirmTitle())), 'ui.menu'),
    );

    this.stage.append(this.bgLayer, this.spriteLayer, this.fader, this.nvlEl, this.textbox, this.flashEl, this.screenLayer, this.choicesEl, this.quickMenu, this.overlay, this.toastEl);
    root.classList.add('stage-host');
    root.replaceChildren(this.stage);
    this.plugins = new PluginManager(opts.plugins ?? {}, {
      stage: this.stage,
      before: this.fader,
      modalParent: this.screenLayer,
      asset: this.assetUrl,
      vars: () => this.runner.vars,
      reducedMotion: () => this.reducedMotion,
      volume: (ch) => this.vol(ch),
      playSound: (path) => this.playSound(path),
      language: () => this.runner.language,
    });
    this.applySettings();
    this.applyLanguage();
    this.drawTextbox();

    this.stage.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, .overlay.open, .screen-layer label, .screen-layer .called, .textbox label')) return;
      // With the interface hidden (H, or a text box's own hide button), a click brings it back.
      if (this.stage.classList.contains('hide-ui') && this.mode === 'playing') { this.stage.classList.remove('hide-ui'); return; }
      this.onAdvance();
    });
    this.stage.addEventListener('wheel', (e) => {
      if (this.mode === 'playing' && !this.overlayOpen && e.deltaY < 0) this.back();
    }, { passive: true });
    this.host.onBackButton?.(() => this.handleBack());
    this.stopGamepads = watchGamepads({
      scope: () => (this.overlayOpen ? this.overlay : this.stage),
      advance: () => {
        const first = this.choicesEl.querySelector<HTMLElement>('button');
        if (first && !this.overlayOpen) first.focus();
        else if (!this.overlayOpen) this.onAdvance();
      },
      cancel: () => { if (!this.closeScreenOnTop() && this.overlayOpen && this.mode === 'playing') this.closeOverlay(); },
      menu: () => {
        if (this.mode !== 'playing' || this.overlayOpen) return;
        if (this.story.screens?.menu) this.openScreen('menu', true); else this.showSettings();
      },
      back: () => { if (!this.overlayOpen) this.back(); },
    });
    window.addEventListener('keydown', this.keyListener);
    window.addEventListener('beforeunload', this.unloadListener);
  }

  private readonly stopGamepads: () => void;
  /** The game's plugins (see plugins.ts). */
  private readonly plugins: PluginManager;
  /** The waiting plugin command running now, so a redraw doesn't start it twice. */
  private pluginRunning: Block | null = null;
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
    this.stopGamepads();
    this.plugins.destroy();
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
    this.drawTextbox();
    if (this.mode === 'title') { this.closeOverlay(); this.showTitle(); return true; }
    if (!save) { this.showTitle(); return false; }
    let step: Step | null = null;
    try { step = this.runner.resume(save); } catch (err) { console.warn('Could not resume after an edit', err); }
    if (!step) { this.showTitle(); return false; }
    this.enterPlaying();
    this.nextEpoch();
    this.busy = false;
    this.syncScene(this.runner.scene());
    this.plugins.restore(this.runner.pluginState);
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
            this.plugins.restore(this.runner.pluginState);
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
    const screens = this.mode === 'title' ? [] : this.runner.screens;
    const plugins = this.mode === 'title' ? {} : Object.fromEntries(this.runner.pluginState.map((c, i) => [`${c.plugin}.${i}`, c]));
    this.guard(() => this.present(this.runner.startAt(label, { vars, scene, screens, plugins })));
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
      this.plugins.restore(this.runner.pluginState);
      this.syncAudio();
      return this.present(step, true);
    });
  }

  /**
   * Editor: show one of the game's screens while it's being written (null:
   * stop). `again` redraws it after the script changed. The text box needs no
   * preview: during a game it's always the live one.
   */
  previewScreen(name: string | null, again = false): void {
    if (name === this.previewing && !again) return;
    const was = this.previewing;
    this.previewing = name;
    if (name && name !== 'textbox' && this.story.screens?.[name]) { this.openScreen(name, true); return; }
    if (was && this.overlay.classList.contains(`screen-${was}`)) {
      this.screenStack = [];
      if (this.mode === 'title') this.showTitleMenu(); else this.closeOverlay();
    }
  }

  private previewing: string | null = null;

  setVar(name: string, value: Value): void {
    this.guard(() => this.runner.setVar(name, value));
    this.opts.onUpdate?.(this.runner.block);
  }

  // ---------------------------------------------------------------- flow

  private start(): void {
    this.endingName = null;
    this.plugins.restore([]);
    this.plugins.emit('start');
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
    const b = this.runner.block;
    const c = b?.type === 'menu' ? b.choices.find((x) => x.index === index) : undefined;
    if (c) this.plugins.emit('choice', { id: c.id, text: c.text });
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
    this.plugins.restore(this.runner.pluginState);
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
      this.stepSpeaker = step.block.type === 'say' ? step.block.who?.id ?? null : null;
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
    const b = step.block;
    if (b.type === 'say') this.plugins.emit('line', { id: b.id, speaker: b.who?.id ?? null, text: b.text, label: b.label });
  }

  /** Start loading the images the next few lines might show, down every branch. */
  private preloadAhead(): void {
    this.images.want(this.runner.upcomingImages().map(this.assetUrl));
  }

  private renderBlock(b: Block, instant: boolean): void {
    this.clearTimers();
    this.choicesEl.replaceChildren();
    this.drawStoryScreens(b);
    // The game's own text box: its buttons follow what can be done now (Back at the first line can't).
    if (this.story.screens?.textbox) {
      if (b.type === 'say') this.speaking = b.who?.name ?? '';
      this.drawTextbox();
    }
    this.backBtn.disabled = !this.runner.canGoBack;
    this.textbox.classList.toggle('waiting', false);
    this.nvlEl.classList.remove('waiting');
    // NVL mode shows a page of lines; ADV mode the text box.
    const page = b.type === 'say' || b.type === 'menu' ? this.runner.nvlPage : null;
    if (!page) { this.nvlEl.hidden = true; this.typeTarget = this.textEl; }

    switch (b.type) {
      case 'say':
        if (page) { this.showPage(page, b, instant || this.skip); this.read.add(b.id); break; }
        if (this.skip && !this.skipToChoice && this.settings.skipMode === 'read' && !this.read.has(b.id)) {
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
      case 'plugin': {
        // The story waits on the plugin (a minigame), with the last line still showing.
        this.auto = this.skip = false;
        this.updateToggles();
        const prompt = this.runner.lastSay;
        if (page) this.showPage(page, null, true);
        else if (prompt) this.showLine(prompt, true, false);
        else this.textbox.hidden = true;
        this.textbox.classList.remove('waiting');
        if (this.pluginRunning === b) break;
        this.pluginRunning = b;
        const my = this.epoch;
        void Promise.resolve(this.plugins.run(b, { instant: false, restoring: false })).then((value) => {
          if (this.pluginRunning === b) this.pluginRunning = null;
          if (my !== this.epoch || this.runner.block !== b) return; // the player went back or loaded meanwhile
          this.guard(() => this.present(this.runner.resumeFromPlugin(value ?? undefined)));
        });
        break;
      }
      case 'screen': {
        // Like a menu: the story waits for the player, with the last line still showing.
        this.auto = this.skip = false;
        this.updateToggles();
        const prompt = this.runner.lastSay;
        if (page) this.showPage(page, null, true);
        else if (prompt) this.showLine(prompt, true, false);
        else this.textbox.hidden = true;
        this.textbox.classList.remove('waiting');
        this.claimFocus(this.screenLayer.querySelector<HTMLElement>('.called button:not(:disabled), .called input, .called select'));
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
    if (this.speaking !== (b.who?.name ?? '')) {
      this.speaking = b.who?.name ?? '';
      if (this.story.screens?.textbox) this.drawTextbox();
    }
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
    if (!this.skip) this.skipToChoice = false;
    this.autoBtn.setAttribute('aria-pressed', String(this.auto));
    this.skipBtn.setAttribute('aria-pressed', String(this.skip));
    if (this.story.screens?.textbox) this.drawTextbox();
  }

  /**
   * The game's own text box (`screen textbox`), drawn over the whole stage with
   * the line, the name and the side image where it places them; or the built-in
   * one. Buttons on it replace the quick menu.
   */
  private drawTextbox(): void {
    const screen = this.story.screens?.textbox;
    this.stage.classList.toggle('own-textbox', !!screen);
    const hasButtons = (items: readonly CompiledScreenItem[]): boolean => items.some((it) => it.kind === 'button' || (it.children ? hasButtons(it.children) : false));
    this.stage.classList.toggle('own-quickmenu', !!screen && hasButtons(screen.items));
    if (!screen) {
      if (this.textbox.firstElementChild?.classList.contains('screen-root')) {
        for (const e of [this.sideEl, this.namebox, this.textEl]) { e.removeAttribute('style'); e.classList.remove('screen-part'); }
        this.textbox.replaceChildren(this.sideEl, this.namebox, this.textEl, this.liveRegion, this.nextEl);
      }
      return;
    }
    const focused = this.textbox.contains(document.activeElement) ? (document.activeElement as HTMLElement).getAttribute('aria-label') ?? (document.activeElement as HTMLElement).textContent : null;
    const node = renderScreen('textbox', screen, this.screenHost('textbox', true));
    node.append(this.liveRegion, this.nextEl);
    this.textbox.replaceChildren(node);
    if (focused !== null) [...this.textbox.querySelectorAll<HTMLElement>('button')].find((x) => (x.getAttribute('aria-label') ?? x.textContent) === focused)?.focus({ preventScroll: true });
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
        this.plugins.emit('achievement', { id: fx.id, name: fx.name });
        return;
      case 'plugin':
        void this.plugins.run(fx, { instant, restoring: false });
        return;
      case 'globals':
        storage.set(`${this.storeKey}:globals`, JSON.stringify(fx.values));
        return;
      case 'ending':
        this.progress.reachEnding(fx.id);
        this.endingName = fx.name;
        this.plugins.emit('ending', { id: fx.id, name: fx.name });
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
        // An endless move is part of the scene, so it starts even while skipping.
        if (this.reducedMotion) return;
        if (fx.forever) { const s = this.spriteEl(fx.target); if (s) startLoop(s, fx.motion, this.stage.clientHeight / 100); }
        else if (!instant) this.motion(fx.motion, fx.target, fx.times);
        return;
      case 'screens':
        this.drawStoryScreens(null);
        break;
      case 'still': {
        const s = this.spriteEl(fx.target);
        if (s) stopLoop(s);
        return;
      }
      case 'tone':
        this.setTone(fx.tone, instant || this.reducedMotion ? 0 : (fx.duration ?? 0) * 1000);
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
  private motion(kind: MotionKind, target: string, times: number): void {
    const node = target === 'textbox' ? this.textbox : this.spriteEl(target);
    if (!node) return;
    const m = motionFrames(kind, this.stage.clientHeight / 100);
    node.animate(m.frames, { duration: m.ms, easing: m.easing, iterations: times });
  }

  /**
   * Tint the picture (backgrounds and characters, not the text). Animated with
   * Web Animations rather than a CSS transition, because the camera owns the
   * layers' `transition` for its transform.
   */
  private setTone(tone: 'sepia' | 'mono' | null, ms: number): void {
    const filter = tone === 'sepia' ? 'sepia(0.85) saturate(0.9)' : tone === 'mono' ? 'grayscale(1)' : '';
    for (const layer of [this.bgLayer, this.spriteLayer]) {
      const from = getComputedStyle(layer).filter;
      layer.style.filter = filter;
      if (ms && from !== (filter || 'none')) layer.animate([{ filter: from }, { filter: filter || 'none' }], { duration: ms, easing: 'ease-in-out' });
    }
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
      video.volume = Math.min(1, Math.max(0, this.vol('music')));
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
    this.setTone(scene.tone ?? null, 0);
    this.spriteLayer.replaceChildren();
    const u = this.stage.clientHeight / 100;
    for (const sp of scene.sprites) {
      const layers = this.runner.spriteLayers(sp);
      if (!layers?.length) continue;
      const node = makeSprite(sp.tag, layers.map(this.assetUrl), sp.at);
      this.spriteLayer.append(node);
      if (sp.loop && !this.reducedMotion) startLoop(node, sp.loop, u);
    }
  }

  // ---------------------------------------------------------- audio

  /** Start a music track; with `fadeMs`, the old track fades out while the new one fades in. */
  private playMusic(path: string, loop: boolean, fadeMs = 0): void {
    if (this.music?.path === path) return;
    this.stopMusic(fadeMs);
    this.music = this.loops.play(path, asset(path), loop, this.vol('music'), fadeMs);
  }

  private stopMusic(fadeMs = 0): void {
    this.music?.stop(fadeMs);
    this.music = null;
  }

  /** `play ambience rain`: a loop under the music, at the sound effects volume. */
  private playAmbience(path: string, loop: boolean, fadeMs = 0): void {
    if (this.ambience?.path === path) return;
    this.stopAmbience(fadeMs);
    this.ambience = this.loops.play(path, asset(path), loop, this.vol('sound'), fadeMs);
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

  /** A volume as heard: the channel's, times the master volume (and the character's, for a voice); 0 when muted. */
  private vol(ch: 'music' | 'sound' | 'voice', who: string | null = null): number {
    const s = this.settings;
    if (s.muted.master || s.muted[ch]) return 0;
    const v = s.masterVolume * (ch === 'music' ? s.musicVolume : ch === 'sound' ? s.soundVolume : s.voiceVolume);
    if (ch !== 'voice' || !who) return v;
    return s.voiceMuted.includes(who) ? 0 : v * (s.voiceVolumes[who] ?? 1);
  }

  /** Whose voice is playing (for their own volume), and whose line the step being shown is. */
  private voiceWho: string | null = null;
  private stepSpeaker: string | null = null;

  /** `who`: the character speaking (the next line's speaker when not given). */
  private playVoice(path: string, who: string | null = this.stepSpeaker): void {
    this.stopVoice();
    const a = new Audio(asset(path));
    this.voiceWho = who;
    a.volume = this.vol('voice', who);
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
    a.volume = this.vol('sound');
    this.sounds.add(a);
    a.addEventListener('ended', () => this.sounds.delete(a));
    a.play().catch(() => this.sounds.delete(a));
  }

  private playLoopSound(path: string, fadeMs = 0): void {
    if (this.loopSound?.path === path) return;
    this.stopLoopSound(fadeMs);
    this.loopSound = this.loops.play(path, asset(path), true, this.vol('sound'), fadeMs);
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
    this.screenLayer.replaceChildren();
    this.plugins.restore([]);
    this.plugins.emit('title');
    if (this.story.screens?.textbox) this.drawTextbox();
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
    if (this.story.screens?.title) { this.openScreen('title', true); return; }
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

  // ---------------------------------------------------------- the game's own screens

  /**
   * Show one of the game's own screens (`screen name:` in the script) in the
   * overlay. `fresh` starts a new stack (the title, the game menu); otherwise
   * the screen goes on top of the one showing, and `close` comes back to it.
   */
  private openScreen(name: string, fresh = false): void {
    const screen = this.story.screens?.[name];
    if (!screen) return;
    if (fresh) this.screenStack = [];
    if (this.screenStack[this.screenStack.length - 1] !== name) this.screenStack.push(name);
    const focused = this.overlay.querySelector(':focus') ? [...this.overlay.querySelectorAll('button')].indexOf(document.activeElement as HTMLButtonElement) : -1;
    const node = renderScreen(name, screen, this.screenHost(name));
    const shown = this.overlayOpen && this.overlay.querySelector<HTMLElement>(':scope > .screen-root')?.dataset.screen;
    if (shown !== name) this.enter(node, screen);
    this.openOverlay(`screen screen-${name}`, node);
    // Esc closes a screen opened over the story or over another screen.
    this.overlay.onkeydown = (e) => {
      if (e.key !== 'Escape' || (this.screenStack.length <= 1 && this.mode !== 'playing')) return;
      e.preventDefault();
      this.runActions([{ do: 'close' }]);
    };
    if (focused >= 0) this.overlay.querySelectorAll('button')[focused]?.focus({ preventScroll: true });
  }

  /**
   * Show the game's own version of a built-in screen, if it has one: over the
   * screen that's showing (so `close` returns to it), or on its own.
   */
  private openOwn(name: 'save' | 'load' | 'settings' | 'extras' | 'history'): boolean {
    if (!this.story.screens?.[name]) return false;
    const over = this.overlayOpen && this.overlay.classList.contains('screen') && this.screenStack.length > 0;
    this.openScreen(name, !over);
    return true;
  }

  /** The log lines a screen's `log` shows: all of them, and where its window starts (the newest at the bottom until scrolled). */
  private logWindow(name: string): ScreenHost['log'] {
    const item = this.findItem(name, 'log');
    if (!item) return undefined;
    const entries = this.runner.log.map((b) => ({ name: b.who?.name ?? '', text: b.text, voice: !!b.voice }));
    const last = Math.max(0, entries.length - item.count!);
    const first = Math.min(last, Math.max(0, this.logFirst[name] ?? last));
    return { entries, first };
  }

  /** Where each screen's `log` window starts (absent: at the newest lines). */
  private logFirst: Record<string, number> = {};

  /** The first element of a kind in one of the game's screens. */
  private findItem(name: string, kind: CompiledScreenItem['kind']): CompiledScreenItem | null {
    const find = (items: readonly CompiledScreenItem[]): CompiledScreenItem | null => {
      for (const it of items) {
        if (it.kind === kind) return it;
        const inner = it.children ? find(it.children) : null;
        if (inner) return inner;
      }
      return null;
    };
    return find(this.story.screens?.[name]?.items ?? []);
  }

  /** Variables a screen sees: the story's (on the title, between games, their starting values and the globals), and its page. */
  private screenVars(name?: string): Readonly<Record<string, Value>> {
    const story = this.mode === 'title' ? { ...this.story.vars, ...this.runner.globals } : this.runner.vars;
    if (!name) return story;
    const asking: Record<string, Value> = name === 'confirm' && this.asking ? { confirm: this.asking.kind, message: this.t(`ui.confirm_${this.asking.kind}`) } : {};
    return { page: (this.screenPages[name] ?? 0) + 1, pages: this.screenPageCount(name), ...(name === 'textbox' ? { speaker: this.speaking } : {}), ...asking, ...story };
  }

  /** Pages of a screen's slots or gallery (the first one it has). */
  private screenPageCount(name: string): number {
    const find = (items: readonly CompiledScreenItem[]): CompiledScreenItem | null => {
      for (const it of items) {
        if (it.kind === 'slots' || it.kind === 'gallery') return it;
        const inner = it.children ? find(it.children) : null;
        if (inner) return inner;
      }
      return null;
    };
    const paged = find(this.story.screens?.[name]?.items ?? []);
    if (!paged) return 1;
    const total = paged.kind === 'slots' ? saveSlotCount(this.story.meta.save_slots) : (this.story.gallery ?? []).length;
    return Math.max(1, Math.ceil(total / paged.count!));
  }

  /** The player's settings by their script name (music_volume, skip_unread, font, ...), for screens. */
  private screenSettings(): ScreenHost['settings'] {
    const t = (k: UiKey, vars?: Record<string, string | number>) => this.t(k, vars);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const SLIDERS: Record<string, keyof typeof RANGES> = {
      text_speed: 'textSpeed', auto_wait: 'autoDelay', music_volume: 'musicVolume', sound_volume: 'soundVolume',
      voice_volume: 'voiceVolume', text_size: 'textScale', box_opacity: 'boxOpacity', master_volume: 'masterVolume',
    };
    const MUTES: Record<string, keyof Settings['muted']> = { master_mute: 'master', music_mute: 'music', sound_mute: 'sound', voice_mute: 'voice' };
    return {
      get: (setting, as, who) => {
        const st = this.settings;
        if (setting === 'voice_volume' && who) return st.voiceVolumes[who] ?? 1;
        if (setting === 'voice_mute' && who) return st.voiceMuted.includes(who);
        if (SLIDERS[setting]) return st[SLIDERS[setting]!];
        if (MUTES[setting]) return st.muted[MUTES[setting]!];
        if (setting.startsWith('confirm_')) return st.confirm[setting.slice(8) as ConfirmKind] !== false;
        switch (setting) {
          case 'skip_unread': return st.skipMode === 'all';
          case 'animations': return as === 'toggle' ? !this.reducedMotion : st.motion;
          case 'fullscreen': return this.fullscreenOn;
          case 'font': return st.font;
          case 'language': return st.language;
          case 'skip': return st.skipMode;
          default: return '';
        }
      },
      set: (setting, value, who) => {
        const st = this.settings;
        if (setting === 'voice_volume' && who) { this.updateSettings({ voiceVolumes: { ...st.voiceVolumes, [who]: Number(value) } }); return; }
        if (setting === 'voice_mute' && who) { this.updateSettings({ voiceMuted: value === true ? [...st.voiceMuted, who] : st.voiceMuted.filter((x) => x !== who) }); return; }
        if (SLIDERS[setting]) { this.updateSettings({ [SLIDERS[setting]!]: Number(value) }); return; }
        if (MUTES[setting]) { this.updateSettings({ muted: { ...st.muted, [MUTES[setting]!]: value === true } }); return; }
        if (setting.startsWith('confirm_')) { this.updateSettings({ confirm: { ...st.confirm, [setting.slice(8)]: value === true } }); return; }
        switch (setting) {
          case 'skip_unread': this.updateSettings({ skipMode: value === true ? 'all' : 'read' }); return;
          case 'animations':
            this.updateSettings({ motion: typeof value === 'boolean' ? (value ? 'full' : 'reduced') : (value as Settings['motion']) });
            return;
          case 'fullscreen':
            void this.host.setFullscreen?.(value === true).then((on) => { this.fullscreenOn = on; });
            return;
          case 'font': this.updateSettings({ font: value as Settings['font'] }); return;
          case 'skip': this.updateSettings({ skipMode: value as Settings['skipMode'] }); return;
          case 'language':
            this.updateSettings({ language: String(value) });
            this.applyLanguage(); // redraws this screen in the new language
            return;
        }
      },
      range: (setting) => RANGES[SLIDERS[setting]!],
      options: (setting): ReadonlyArray<readonly [string, string]> => {
        switch (setting) {
          case 'font': return FONTS.map(([id]) => [id, t(`ui.font_${id}`)] as const);
          case 'skip': return [['read', t('ui.skip_read')], ['all', t('ui.skip_all')]];
          case 'animations': return [['system', t('ui.motion_system')], ['full', t('ui.motion_full')], ['reduced', t('ui.motion_reduced')]];
          case 'language': {
            const source = this.sourceLanguage;
            return [
              ['auto', t('ui.language_auto')],
              [source, languageName(source)],
              ...(this.opts.translations ?? []).filter((x) => x.lang !== source).map((x) => [x.lang, languageName(x.lang)] as const),
            ];
          }
          default: return [];
        }
      },
      show: (setting, v) => {
        if (setting === 'text_speed') return v >= INSTANT_SPEED ? t('ui.instant') : t('ui.letters_per_second', { n: v });
        if (setting === 'auto_wait') return t('ui.seconds', { n: v.toFixed(2).replace(/0$/, '') });
        return pct(v);
      },
    };
  }

  /** What a screen needs from the player: text, pictures, saves, extras and settings. */
  private screenHost(name: string, onStory = false): ScreenHost {
    const saved = this.slots();
    const t = (k: UiKey, vars?: Record<string, string | number>) => this.t(k, vars);
    const named = (id: string, table: Record<string, { name: string }> | undefined, kind: string) =>
      this.translation?.strings[`${kind}.${id}`]?.text ?? table?.[id]?.name ?? id;
    return {
      vars: () => this.screenVars(name),
      translated: (id) => this.translation?.strings[id] ?? null,
      nodes: (text, spans) => (spans ? spanNodes(spans) : [document.createTextNode(text)]),
      url: this.assetUrl,
      canvas: parseCanvas(this.story.meta.canvas),
      enabled: (actions, at) => actions.every((a) => this.canRun(a, name, at?.entry)),
      run: (actions, at) => this.runActions(actions, name, onStory, at?.entry),
      log: this.logWindow(name),
      page: this.screenPages[name] ?? 0,
      slots: {
        count: saved.length,
        info: (i) => (saved[i] ? { date: new Date(saved[i]!.savedAt).toLocaleString(this.stage.lang || undefined), text: saved[i]!.preview } : null),
        thumbnail: (i) => (saved[i] ? this.thumbnail(saved[i]!) : null),
        canSave: () => this.mode === 'playing' && this.runner.block !== null,
        use: (kind, i) => {
          const go = () => {
            this.screenStack = [];
            if (kind === 'save') this.saveTo(i);
            else if (saved[i]) this.loadFrom(saved[i]!);
          };
          if (kind === 'save' && saved[i]) this.ask('overwrite', go);
          else if (kind === 'load' && this.mode === 'playing') this.ask('load', go);
          else go();
        },
      },
      gallery: () => (this.story.gallery ?? []).map((image) => ({ name: image, url: this.assetUrl(this.story.images[image]!), seen: this.progress.hasSeen(image) })),
      view: (image) => {
        const seen = (this.story.gallery ?? []).filter((i) => this.progress.hasSeen(i));
        this.viewImage(seen, Math.max(0, seen.indexOf(image)));
      },
      endings: () => Object.keys(this.story.endings ?? {}).map((id) => ({ name: named(id, this.story.endings, 'ending'), reached: this.progress.hasReached(id) })),
      achievements: () => Object.keys(this.story.achievements ?? {}).map((id) => ({ name: named(id, this.story.achievements, 'achievement'), earned: this.achievements().includes(id) })),
      settings: this.screenSettings(),
      part: (kind) => (kind === 'dialogue' ? this.textEl : kind === 'speaker' ? this.namebox : this.sideEl),
      pluginElement: (plugin, element, args) => this.plugins.element(plugin, element, args),
      selected: (actions) => actions.length > 0 && actions.every((a) => this.isSelected(a, name)),
      sound: (kind) => {
        const path = this.story.meta[`${kind}_sound`];
        if (path) this.playSound(path);
      },
      ui: (key, vars) => t(`ui.${key}`, vars),
    };
  }

  /**
   * A save's picture: its scene drawn again, small (background, characters,
   * tone), from the saved state. Nothing is stored for it, and the game's
   * theme.css styles it like the real stage.
   */
  private thumbnail(save: SaveData): HTMLElement {
    const scene = save.state.scene;
    const box = el('div', 'thumb');
    const bg = el('div', 'bg');
    const path = this.runner.imagePath(scene.bg);
    if (path) bg.style.backgroundImage = `url("${this.assetUrl(path)}")`;
    box.append(bg);
    for (const sp of scene.sprites) {
      const layers = this.runner.spriteLayers(sp);
      if (layers?.length) box.append(makeSprite(sp.tag, layers.map(this.assetUrl), sp.at));
    }
    if (scene.tone === 'sepia') box.style.filter = 'sepia(0.85) saturate(0.9)';
    else if (scene.tone === 'mono') box.style.filter = 'grayscale(1)';
    return box;
  }

  private latestSave(): SaveData | null {
    let best: SaveData | null = null;
    for (const s of this.slots()) if (s && (!best || s.savedAt > best.savedAt)) best = s;
    return best;
  }

  /** Whether an action can do anything now: there must be a save to continue or load, a way to quit, something to save. */
  private canRun(a: ScreenAction, screen?: string, entry?: number): boolean {
    switch (a.do) {
      case 'page': {
        if (!screen) return true;
        const log = this.logWindow(screen);
        if (log) {
          const n = this.findItem(screen, 'log')!.count!;
          return a.to === 'previous' ? log.first > 0 : a.to === 'next' ? log.first + n < log.entries.length : true;
        }
        const page = this.screenPages[screen] ?? 0;
        const last = this.screenPageCount(screen) - 1;
        return a.to === 'next' ? page < last : a.to === 'previous' ? page > 0 : a.to - 1 <= last && a.to - 1 !== page;
      }
      case 'continue': return this.latestSave() !== null;
      case 'open':
        if (a.screen === 'load') return this.slots().some(Boolean);
        if (a.screen === 'save') return this.mode === 'playing' && this.runner.block !== null;
        if (a.screen === 'extras') return this.extrasTabs().length > 0;
        return true;
      case 'quit': return !!this.host.quit && !!this.opts.ownsDocument;
      case 'switch': return this.screenStack[this.screenStack.length - 1] !== a.screen;
      case 'back': return this.mode === 'playing' && this.runner.canGoBack;
      case 'auto': case 'skip': case 'hide': return this.mode === 'playing';
      case 'quicksave': return this.mode === 'playing' && this.runner.block !== null;
      case 'quickload': return storage.get(`${this.storeKey}:quick`) !== null;
      case 'voice': {
        if (entry !== undefined) return !!this.runner.log[entry]?.voice;
        const b = this.runner.block;
        return this.mode === 'playing' && !!(b?.type === 'say' ? b.voice : this.runner.lastSay?.voice);
      }
      case 'rewind': return entry !== undefined && entry < this.runner.log.length - 1;
      case 'scroll': {
        const log = screen ? this.logWindow(screen) : undefined;
        if (!log) return false;
        return a.to === 'up' ? log.first > 0 : log.first + this.findItem(screen!, 'log')!.count! < log.entries.length;
      }
      case 'next_choice': return this.mode === 'playing' && this.runner.block?.type !== 'menu' && this.runner.block?.type !== 'end';
      case 'previous_choice': return this.mode === 'playing' && this.runner.canGoBackToChoice;
      default: return true;
    }
  }

  /** Whether a button's action is in effect now, so it shows as selected. */
  private isSelected(a: ScreenAction, screen?: string): boolean {
    switch (a.do) {
      case 'auto': return this.auto;
      case 'skip': return this.skip;
      case 'page': return !!screen && typeof a.to === 'number' && (this.screenPages[screen] ?? 0) === a.to - 1;
      case 'open': case 'switch': return this.screenStack[this.screenStack.length - 1] === a.screen && this.overlayOpen;
      case 'setting': {
        const as = typeof a.value === 'boolean' ? 'toggle' : typeof a.value === 'number' ? 'slider' : 'choice';
        return String(this.screenSettings().get(a.name, as)) === String(a.value);
      }
      default: return false;
    }
  }

  private runActions(actions: readonly ScreenAction[], screen?: string, onStory = false, entry?: number): void {
    let redraw = false;
    const called = onStory && this.runner.block?.type === 'screen' && this.runner.block.name === screen;
    for (const a of actions) {
      switch (a.do) {
        case 'page': {
          if (!screen) break;
          const logWin = this.logWindow(screen);
          if (logWin) {
            const n = this.findItem(screen, 'log')!.count!;
            const lastFirst = Math.max(0, logWin.entries.length - n);
            const to = a.to === 'next' ? logWin.first + n : a.to === 'previous' ? logWin.first - n : (a.to - 1) * n;
            this.logFirst[screen] = Math.min(lastFirst, Math.max(0, to));
            redraw = true;
            break;
          }
          const last = this.screenPageCount(screen) - 1;
          const page = this.screenPages[screen] ?? 0;
          this.screenPages[screen] = Math.min(last, Math.max(0, a.to === 'next' ? page + 1 : a.to === 'previous' ? page - 1 : a.to - 1));
          redraw = true;
          break;
        }
        case 'load':
        case 'save':
          break; // only on slots, which handle them themselves
        case 'set': {
          const vars = this.screenVars(screen);
          try {
            const v = evaluate(a.value, vars);
            const old = vars[a.name];
            const next = a.op === '=' ? v : typeof old === 'number' && typeof v === 'number' ? (a.op === '+=' ? old + v : old - v) : a.op === '+=' ? String(old) + String(v) : v;
            this.runner.setVar(a.name, next);
          } catch (err) {
            this.fail(err);
            return;
          }
          if (this.story.globals?.includes(a.name)) storage.set(`${this.storeKey}:globals`, JSON.stringify(this.runner.globals));
          redraw = true;
          break;
        }
        case 'setting':
          this.screenSettings().set(a.name, a.value);
          redraw = true;
          break;
        case 'back': this.back(); return;
        case 'auto': this.toggleAuto(); return;
        case 'skip': this.toggleSkip(); return;
        case 'hide': this.stage.classList.add('hide-ui'); return;
        case 'scroll': {
          const logWin = screen ? this.logWindow(screen) : undefined;
          if (!logWin) break;
          const n = this.findItem(screen!, 'log')!.count!;
          this.logFirst[screen!] = Math.min(Math.max(0, logWin.entries.length - n), Math.max(0, logWin.first + (a.to === 'up' ? -1 : 1)));
          redraw = true;
          break;
        }
        case 'yes': {
          const ask = this.asking;
          this.asking = null;
          if (this.screenStack[this.screenStack.length - 1] === 'confirm') this.screenStack.pop();
          if (ask) ask.yes(); else this.runActions([{ do: 'close' }]);
          return;
        }
        case 'no': {
          const ask = this.asking;
          this.asking = null;
          if (ask?.no) { if (this.screenStack[this.screenStack.length - 1] === 'confirm') this.screenStack.pop(); ask.no(); }
          else this.runActions([{ do: 'close' }]);
          return;
        }
        case 'reset':
          this.ask('reset', () => {
            this.updateSettings({ ...DEFAULT_SETTINGS, language: this.settings.language });
            this.reopenTop();
          });
          return;
        case 'next_choice':
          this.ask('next_choice', () => {
            this.screenStack = [];
            this.closeOverlay();
            this.skipToChoice = true;
            if (!this.skip) this.toggleSkip(); else this.updateToggles();
          });
          return;
        case 'previous_choice':
          this.ask('previous_choice', () => { this.screenStack = []; this.closeOverlay(); this.rewind(this.runner.backToChoice()); });
          return;
        case 'rewind':
          if (entry === undefined) return;
          this.ask('rewind', () => { this.screenStack = []; this.closeOverlay(); this.rewind(this.runner.rewindTo(entry)); });
          return;
        case 'sample': {
          const a2 = new Audio(asset(a.path));
          a2.volume = a.channel === 'voice' ? this.vol('voice', a.character ?? null) : this.vol('sound');
          void a2.play().catch(() => {});
          return;
        }
        case 'voice': {
          if (entry !== undefined) {
            const line = this.runner.log[entry];
            if (line?.voice) this.playVoice(line.voice, line.who?.id ?? null);
            return;
          }
          const b = this.runner.block;
          const v = b?.type === 'say' ? b.voice : this.runner.lastSay?.voice;
          if (v) this.playVoice(v);
          return;
        }
        case 'quicksave': {
          if (!this.runner.block) return;
          const save = () => {
            const ok = storage.set(`${this.storeKey}:quick`, JSON.stringify(this.runner.save()));
            this.plugins.emit('save');
            this.closeConfirm();
            this.toast(ok ? this.t('ui.quick_saved') : this.t('ui.could_not_save'));
            if (this.story.screens?.textbox) this.drawTextbox();
          };
          if (storage.get(`${this.storeKey}:quick`) !== null) this.ask('quicksave', save); else save();
          return;
        }
        case 'quickload': {
          const raw = storage.get(`${this.storeKey}:quick`);
          const load = () => {
            this.screenStack = [];
            try { if (raw) this.loadFrom(JSON.parse(raw)); } catch { this.toast(this.t('ui.could_not_load')); }
          };
          if (this.mode === 'playing') this.ask('quickload', load); else load();
          return;
        }
        case 'switch':
          // Tabs: the new screen takes this one's place, so `close` goes back to what was under both.
          if (this.screenStack.length) this.screenStack.pop();
          if (this.story.screens?.[a.screen]) { this.openScreen(a.screen); return; }
          this.runActions([{ do: 'open', screen: a.screen }], screen, onStory);
          return;
        case 'start':
          this.screenStack = [];
          if (a.label) this.startAtLabel(a.label); else this.start();
          return;
        case 'continue': {
          const save = this.latestSave();
          this.screenStack = [];
          if (save) this.loadFrom(save);
          return;
        }
        case 'jump':
          this.screenStack = [];
          if (this.mode === 'title') this.startAtLabel(a.label); else this.jumpTo(a.label);
          return;
        case 'open':
          if (this.story.screens?.[a.screen]) { this.openScreen(a.screen, onStory); return; }
          if (a.screen === 'load' || a.screen === 'save') this.showSlots(a.screen);
          else if (a.screen === 'settings') this.showSettings();
          else if (a.screen === 'extras') this.showExtras();
          else if (a.screen === 'history') this.showLog();
          return;
        case 'return': {
          if (!called) { this.runActions([{ do: 'close' }], screen, onStory); return; }
          let value: Value | undefined;
          try {
            value = a.value ? evaluate(a.value, this.screenVars(screen)) : undefined;
          } catch (err) {
            this.fail(err);
            return;
          }
          if (this.busy) return;
          this.guard(() => this.present(this.runner.returnFromScreen(value)));
          return;
        }
        case 'close':
          if (!this.screenStack.length && this.overlay.classList.contains('confirm-panel')) { this.closeOverlay(); return; }
          if (!this.screenStack.length && this.overlay.classList.contains('panel') && this.mode === 'playing' && !onStory) { this.closeOverlay(); return; }
          if (onStory) {
            // A called screen goes on with the story; a shown one goes away (`hide screen`).
            if (called) { this.runActions([{ do: 'return' }], screen, onStory); return; }
            this.runner.hideScreen(screen!);
            this.drawStoryScreens();
            return;
          }
          this.screenStack.pop();
          if (this.screenStack.length) this.openScreen(this.screenStack[this.screenStack.length - 1]!);
          else if (this.mode === 'title') this.showTitleMenu();
          else this.closeOverlay();
          return;
        case 'title':
          // The question goes over the screen the button is on, so No comes back to it.
          if (this.mode === 'playing') this.ask('title', () => { this.screenStack = []; this.showTitle(); });
          else { this.screenStack = []; this.showTitle(); }
          return;
        case 'quit':
          if (this.mode === 'playing') this.ask('quit', () => this.host.quit?.()); else this.host.quit?.();
          return;
      }
    }
    if (redraw && screen === 'textbox') this.drawTextbox();
    else if (redraw && onStory) this.drawStoryScreens();
    else if (redraw && this.screenStack.length) this.openScreen(this.screenStack[this.screenStack.length - 1]!);
  }

  /** A screen with `with fade` fades in as it opens (not when it's redrawn). */
  private enter(node: HTMLElement, screen: { transition?: string; duration?: number }): void {
    if (!screen.transition || this.reducedMotion) return;
    node.style.animation = `screen-in ${screen.duration ?? 0.3}s ease-out both`;
  }

  /**
   * Draw the game's screens over the story: the ones shown with `show screen`,
   * and on top the one a `call screen` is waiting on. Shown screens let clicks
   * through to the story except on their own controls; a called one doesn't.
   */
  private drawStoryScreens(b: Block | null = this.runner.block): void {
    const names = this.mode === 'playing' ? this.runner.screens : [];
    const call = this.mode === 'playing' && b?.type === 'screen' ? b.name : null;
    const focused = this.screenLayer.contains(document.activeElement) ? (document.activeElement as HTMLElement).textContent : null;
    const nodes = [...names.map((n) => [n, 'shown'] as const), ...(call ? [[call, 'called'] as const] : [])].flatMap(([n, how]) => {
      const screen = this.story.screens?.[n];
      if (!screen) return [];
      const node = renderScreen(n, screen, this.screenHost(n, true));
      node.classList.add(how);
      if (!this.drawnStoryScreens.has(n)) this.enter(node, screen);
      return [node];
    });
    this.drawnStoryScreens = new Set([...names, ...(call ? [call] : [])]);
    this.screenLayer.replaceChildren(...nodes);
    if (focused !== null) [...this.screenLayer.querySelectorAll<HTMLElement>('button')].find((x) => x.textContent === focused)?.focus({ preventScroll: true });
  }

  /** A new game from a label (a title screen's "Epilogue" button). Variables start fresh, globals kept. */
  private startAtLabel(label: string): void {
    this.endingName = null;
    this.plugins.restore([]);
    this.plugins.emit('start');
    this.enterPlaying();
    this.syncScene({ bg: null, sprites: [] });
    this.stopMusic();
    this.stopAmbience();
    this.stopSounds();
    this.stopVoice();
    this.guard(() => this.present(this.runner.startAt(label)));
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
    if (this.openOwn('extras')) return;
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
    this.ask('title', () => this.showTitle());
  }

  /** The question being asked, and what to do on each answer (`no` absent: go back to what was open). */
  private asking: { kind: ConfirmKind; yes: () => void; no?: () => void } | null = null;

  /**
   * Ask before doing something that can't be undone (unless the player
   * switched that question off): with the game's `screen confirm` over what's
   * open, or the built-in question.
   */
  private ask(kind: ConfirmKind, yes: () => void, no?: () => void): void {
    if (!this.settings.confirm[kind]) { yes(); return; }
    this.asking = { kind, yes, ...(no ? { no } : {}) };
    if (this.story.screens?.confirm) {
      const over = this.overlayOpen && this.overlay.classList.contains('screen') && this.screenStack.length > 0;
      this.openScreen('confirm', !over);
      return;
    }
    if (kind === 'title') {
      this.openOverlay('panel',
        el('h2', '', this.t('ui.return_to_title_question')),
        el('p', '', this.t('ui.unsaved_progress_lost')),
        row(button(this.t('ui.return_to_title'), () => this.runActions([{ do: 'yes' }])), button(this.t('ui.keep_playing'), () => this.runActions([{ do: 'no' }]))),
      );
      return;
    }
    this.openOverlay('panel confirm-panel', el('h2', '', this.t(`ui.confirm_${kind}`)),
      row(button(this.t('ui.yes'), () => this.runActions([{ do: 'yes' }])), button(this.t('ui.no'), () => this.runActions([{ do: 'no' }]))));
  }

  /** After a confirmed action that stays where it was: take the question away. */
  private closeConfirm(): void {
    if (this.screenStack[this.screenStack.length - 1] === 'confirm') { this.screenStack.pop(); this.reopenTop(); }
    else if (this.overlay.classList.contains('confirm-panel')) this.closeOverlay();
  }

  /** Show the screen on top of the stack again (or nothing, when there's none). */
  private reopenTop(): void {
    const top = this.screenStack[this.screenStack.length - 1];
    if (top) this.openScreen(top);
    else if (this.overlay.classList.contains('confirm-panel') || this.overlay.classList.contains('screen-confirm')) {
      if (this.mode === 'title') this.showTitleMenu(); else this.closeOverlay();
    } else if (this.overlay.classList.contains('settings-panel')) this.showSettings();
  }

  /** Show the story after going back to an earlier point (a choice, a line of the log). */
  private rewind(r: { block: Block; scene: SceneState } | null): void {
    if (!r) return;
    this.auto = this.skip = false;
    this.updateToggles();
    this.nextEpoch();
    this.syncScene(r.scene);
    this.plugins.restore(this.runner.pluginState);
    this.syncAudio();
    this.renderBlock(r.block, true);
  }

  /** Skip is running to the next choice: it doesn't stop at unread lines. */
  private skipToChoice = false;

  private showLog(): void {
    if (this.story.screens?.history) {
      delete this.logFirst.history; // open at the newest lines
      this.openOwn('history');
      return;
    }
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
        const who = b.who?.id ?? null;
        const play = button('▶', () => this.playVoice(voice, who), this.t('ui.replay_voice'));
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
    return Array.from({ length: saveSlotCount(this.story.meta.save_slots) }, (_, i) => {
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
    if (this.mode === 'playing') this.drawStoryScreens();
    if (this.story.screens?.textbox) this.drawTextbox();
    if (this.overlay.classList.contains('screen') && this.screenStack.length) this.openScreen(this.screenStack[this.screenStack.length - 1]!);
    else if (this.mode === 'title' && this.overlay.classList.contains('title-screen')) this.showTitleMenu();
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
    void this.music?.fadeTo(this.vol('music'), 0);
    void this.loopSound?.fadeTo(this.vol('sound'), 0);
    void this.ambience?.fadeTo(this.vol('sound'), 0);
    if (this.voice) this.voice.volume = this.vol('voice', this.voiceWho);
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    this.applySettings();
    saveSettings(this.storeKey + ':settings', this.settings);
  }

  private showSettings(): void {
    if (this.openOwn('settings')) return;
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
    slider('masterVolume', t('ui.master_volume'), pct);
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
    const reset = button(t('ui.reset_settings'), () => this.ask('reset', () => {
      this.updateSettings({ ...DEFAULT_SETTINGS, language: this.settings.language });
      this.showSettings();
    }, () => this.showSettings()));
    this.openOverlay('panel settings-panel', el('h2', '', t('ui.settings')), form, preview, row(reset, button(t('ui.done'), done)));
  }

  private showSlots(kind: 'save' | 'load'): void {
    if (this.openOwn(kind)) return;
    const canSave = kind === 'save' && this.mode === 'playing' && this.runner.block !== null;
    const grid = el('div', 'slots');
    this.slots().forEach((s, i) => {
      const label = s
        ? `${new Date(s.savedAt).toLocaleString()} — ${truncate(s.preview, 60)}`
        : this.t('ui.empty');
      const b = button(this.t('ui.slot', { n: i + 1, label }), () => {
        const again = () => this.showSlots(kind);
        if (kind === 'save') { if (s) this.ask('overwrite', () => this.saveTo(i), again); else this.saveTo(i); }
        else if (s) { if (this.mode === 'playing') this.ask('load', () => this.loadFrom(s), again); else this.loadFrom(s); }
      });
      b.disabled = kind === 'save' ? !canSave : !s;
      grid.append(b);
    });
    this.openOverlay('panel', el('h2', '', this.t(kind === 'save' ? 'ui.save' : 'ui.load')), grid,
      button(this.t('ui.close'), () => (this.mode === 'title' ? this.showTitleMenu() : this.closeOverlay())));
  }

  private saveTo(i: number): void {
    const data = this.runner.save();
    this.plugins.emit('save');
    const b = data.block;
    const preview = b.type === 'say' ? (b.who ? `${b.who.name}: ${b.text}` : b.text) : this.t('ui.at_a_choice');
    const ok = storage.set(`${this.storeKey}:slot${i}`, JSON.stringify({ ...data, preview }));
    this.closeOverlay();
    this.toast(ok ? this.t('ui.saved_to_slot', { n: i + 1 }) : this.t('ui.could_not_save'));
  }

  private loadFrom(data: SaveData): void {
    const r = this.runner.load(data);
    if (!r.ok) { this.toast(this.t('ui.could_not_load')); return; }
    this.plugins.emit('load');
    this.enterPlaying();
    this.nextEpoch();
    this.syncScene(this.runner.scene());
    this.plugins.restore(this.runner.pluginState);
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
  /** Close the game's own screen that's open on top (as its `close` would), if one is; false if there's none to close. */
  private closeScreenOnTop(): boolean {
    if (!this.overlayOpen || !this.overlay.classList.contains('screen') || !this.screenStack.length) return false;
    if (this.mode === 'title' && this.screenStack.length <= 1 && this.screenStack[0] === 'title') return false;
    this.runActions([{ do: 'close' }]);
    return true;
  }

  private handleBack(): void {
    if (this.closeScreenOnTop()) return;
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
    let node: Node;
    if (!sp.b && !sp.i && !sp.color) node = document.createTextNode(text);
    else {
      const e = el('span', [sp.b && 'rt-b', sp.i && 'rt-i'].filter(Boolean).join(' '), text);
      if (sp.color) e.style.color = sp.color;
      node = e;
    }
    if (sp.ruby !== undefined) {
      // The reading appears with the first character of the text it goes over.
      const ruby = document.createElement('ruby');
      ruby.append(node, el('rt', '', sp.ruby));
      node = ruby;
    }
    nodes.push(node);
  }
  return nodes;
}

type MotionKind = 'hop' | 'nod' | 'bow' | 'shake' | 'float';

/** Keyframes of a move; `u` is a hundredth of the screen's height, in pixels. */
function motionFrames(kind: MotionKind, u: number): { frames: Keyframe[]; ms: number; easing: string } {
  const at = (x: number, y: number, offset?: number): Keyframe => ({ translate: `${x * u}px ${y * u}px`, ...(offset !== undefined ? { offset } : {}) });
  switch (kind) {
    case 'hop': return { frames: [at(0, 0), at(0, -1.6), at(0, 0)], ms: 280, easing: 'ease-out' };
    case 'nod': return { frames: [at(0, 0), at(0, 1, 0.5), at(0, 0.45, 0.75), at(0, 0)], ms: 260, easing: 'ease-out' };
    case 'bow': return { frames: [at(0, 0), at(0, 1.9, 0.4), at(0, 1.8, 0.7), at(0, 0)], ms: 1500, easing: 'ease-in-out' };
    case 'shake': return { frames: [at(0, 0), at(-1.1, 0), at(1.1, 0), at(-1.1, 0), at(0, 0)], ms: 480, easing: 'ease-out' };
    case 'float': return { frames: [at(0, 0), at(0, -0.9), at(0, 0), at(0, 0.9), at(0, 0)], ms: 8000, easing: 'ease-in-out' };
  }
}

const LOOP_ID = 'emaki-loop';

/** Start a sprite's endless move (replacing any it had). */
function startLoop(sprite: HTMLElement, kind: MotionKind, u: number): void {
  stopLoop(sprite);
  const m = motionFrames(kind, u);
  sprite.animate(m.frames, { duration: m.ms, easing: m.easing, iterations: Infinity, id: LOOP_ID });
}

function stopLoop(sprite: HTMLElement): void {
  for (const a of sprite.getAnimations()) if (a.id === LOOP_ID) a.cancel();
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

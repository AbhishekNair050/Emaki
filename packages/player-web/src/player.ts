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
  type Block, type Effect, type SaveData, type SayBlock, type SceneState, type Step,
} from '@emaki/runtime';
import {
  DEFAULT_SETTINGS, FONTS, INSTANT_SPEED, RANGES, loadSettings, saveSettings, sanitizeSettings, type Settings,
} from './settings.ts';
import { ImagePreloader } from './preload.ts';
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

type Mode = 'title' | 'playing' | 'ended';

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
  private readonly host: EmakiHost;
  /** The language changed behind an open panel: redraw the line when it closes. */
  private redrawOnClose = false;

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
  /** The voice line playing now; a new line (or the next click) stops it. */
  private voice: HTMLAudioElement | null = null;
  /** The looping sound playing now (rain, a crowd), kept until stopped or replaced. */
  private loopSound: HTMLAudioElement | null = null;
  /** One-shot sound effects still playing, so 'stop sound' can cut them. */
  private readonly sounds = new Set<HTMLAudioElement>();
  private settings: Settings;
  private readonly images = new ImagePreloader();
  private readonly systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(root: HTMLElement, story: CompiledStory, opts: PlayerOptions = {}) {
    this.story = story;
    this.runner = new Runner(story);
    this.opts = opts;
    this.host = opts.host ?? detectHost();
    this.storeKey = `emaki:${story.meta.title ?? 'untitled'}`;
    this.settings = loadSettings(this.storeKey + ':settings');
    this.loadGlobals();

    this.stage = el('div', 'stage');
    this.applyStageShape();
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

    this.stage.append(this.bgLayer, this.spriteLayer, this.fader, this.textbox, this.choicesEl, this.quickMenu, this.overlay, this.toastEl);
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
  private readonly unloadListener = () => this.devStash();

  /** Stop everything (timers, music, listeners) and empty the host. The player can't be used afterwards. */
  destroy(): void {
    this.epoch++;
    this.clearTimers();
    this.stopMusic();
    this.stopSounds();
    this.stopVoice();
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
    this.epoch++;
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
    this.enterPlaying();
    this.syncScene({ bg: null, sprites: [] });
    this.stopMusic();
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
        // Typing speed is the Text speed setting's job alone. Reduced motion (which Windows turns on
        // with "Animation effects" off) is about movement, not letters appearing.
        this.showLine(b, instant || this.skip);
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
        this.claimFocus(this.choicesEl.firstElementChild as HTMLElement | null);
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
    } else if (this.auto && !(this.voice && !this.voice.paused && !this.voice.ended)) {
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
          img.style.left = positionLeft(fx.at) ?? POSITIONS.center!;
          img.src = asset(fx.path);
          img.style.opacity = ms ? '0' : '1';
          this.spriteLayer.append(img);
          if (ms) await animateOpacity(img, 1, ms);
        } else {
          img.style.left = positionLeft(fx.at) ?? img.style.left;
          if (img.getAttribute('src') !== asset(fx.path)) img.src = asset(fx.path);
        }
        return;
      }
      case 'hide': {
        const img = this.spriteLayer.querySelector<HTMLElement>(`img[data-tag="${cssEscape(fx.tag)}"]`);
        if (img) await fadeOutAndRemove(img, this.duration(fx.transition, instant));
        return;
      }
      case 'play': {
        const fadeMs = instant ? 0 : (fx.fade ?? 0) * 1000;
        if (fx.channel === 'music') this.playMusic(fx.path, fx.loop, fadeMs);
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
    }
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
      img.style.left = positionLeft(sp.at) ?? POSITIONS.center!;
      this.spriteLayer.append(img);
    }
  }

  // ---------------------------------------------------------- audio

  /** Start a music track; with `fadeMs`, the old track fades out while the new one fades in. */
  private playMusic(path: string, loop: boolean, fadeMs = 0): void {
    if (this.music?.dataset.path === path) return;
    this.stopMusic(fadeMs);
    const a = new Audio(asset(path));
    a.dataset.path = path;
    a.loop = loop;
    a.volume = fadeMs ? 0 : this.settings.musicVolume;
    a.play().catch(() => { /* autoplay blocked or file missing: stay silent */ });
    this.music = a;
    if (fadeMs) void fadeVolume(a, () => this.settings.musicVolume, fadeMs);
  }

  private stopMusic(fadeMs = 0): void {
    const old = this.music;
    this.music = null;
    if (!old) return;
    if (!fadeMs) {
      fadeVolume(old, () => old.volume, 0); // cancel any fade in progress
      old.pause();
      return;
    }
    void fadeVolume(old, () => 0, fadeMs).then(() => old.pause());
  }

  /** Match the audio to the story's state after a jump in time (load, rollback, edit). */
  private syncAudio(): void {
    const { music, sound } = this.runner.audio();
    if (music) this.playMusic(music.path, music.loop);
    else this.stopMusic();
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
    if (this.loopSound?.dataset.path === path) return;
    this.stopLoopSound(fadeMs);
    const a = new Audio(asset(path));
    a.dataset.path = path;
    a.loop = true;
    a.volume = fadeMs ? 0 : this.settings.soundVolume;
    a.play().catch(() => { /* autoplay blocked or file missing: stay silent */ });
    this.loopSound = a;
    if (fadeMs) void fadeVolume(a, () => this.settings.soundVolume, fadeMs);
  }

  private stopLoopSound(fadeMs = 0): void {
    const old = this.loopSound;
    this.loopSound = null;
    if (!old) return;
    if (!fadeMs) { fadeVolume(old, () => old.volume, 0); old.pause(); return; }
    void fadeVolume(old, () => 0, fadeMs).then(() => old.pause());
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

  private showTitle(): void {
    this.opts.onUpdate?.(null);
    this.mode = 'title';
    this.epoch++;
    this.clearTimers();
    this.stopMusic();
    this.stopSounds();
    this.stopVoice();
    this.stage.classList.remove('playing');
    this.textbox.hidden = true;
    this.choicesEl.replaceChildren();
    this.spriteLayer.replaceChildren();
    const titleBg = this.story.meta.title_image;
    void this.setBackground(titleBg ?? null, 0);
    this.images.want(new Runner(this.story).upcomingImages().map(asset)); // the opening scene

    const hasSaves = this.slots().some(Boolean);
    const menu = el('div', 'title-menu');
    menu.append(button(this.t('ui.start'), () => this.start()));
    if (hasSaves) menu.append(button(this.t('ui.load'), () => this.showSlots('load')));
    menu.append(button(this.t('ui.settings'), () => this.showSettings()));
    const quit = this.host.quit;
    if (quit && this.opts.ownsDocument) menu.append(button(this.t('ui.quit'), () => quit()));
    this.openOverlay('title-screen',
      el('h1', 'title', this.title),
      ...(this.story.meta.author ? [el('p', 'byline', this.story.meta.author)] : []),
      menu,
      el('p', 'made-with', this.t('ui.made_with')),
    );
  }

  private showEnd(): void {
    if (this.mode === 'ended') return;
    this.mode = 'ended';
    this.clearTimers();
    this.auto = this.skip = false;
    this.updateToggles();
    this.openOverlay('end-screen',
      el('h2', '', this.t('ui.the_end')),
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
    if (this.mode === 'title' && this.overlay.classList.contains('title-screen')) this.showTitle();
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
    if (this.music) this.music.volume = s.musicVolume;
    if (this.loopSound) this.loopSound.volume = s.soundVolume;
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

    const choice = <K extends 'font' | 'motion' | 'language'>(key: K, label: string, options: ReadonlyArray<readonly [Settings[K], string]>) => {
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
    choice('motion', t('ui.animations'), [['system', t('ui.motion_system')], ['full', t('ui.motion_full')], ['reduced', t('ui.motion_reduced')]]);

    const preview = el('p', 'settings-preview', t('ui.settings_preview'));
    const done = () => (fromTitle ? this.showTitle() : this.closeOverlay());
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
      button(this.t('ui.close'), () => (this.mode === 'title' ? this.showTitle() : this.closeOverlay())));
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
    this.epoch++;
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
      else this.showTitle();
      return;
    }
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

async function fadeOutAndRemove(node: HTMLElement, ms: number): Promise<void> {
  await animateOpacity(node, 0, ms);
  node.remove();
}

const fades = new WeakMap<HTMLAudioElement, number>();

/**
 * Ramp an element's volume to `target()` over `ms`, replacing any ramp already
 * running on it. The target is re-read every tick, so moving the volume slider
 * mid-fade is respected. Timers rather than animation frames: fades must finish
 * even in a background tab.
 */
function fadeVolume(a: HTMLAudioElement, target: () => number, ms: number): Promise<void> {
  window.clearInterval(fades.get(a));
  fades.delete(a);
  if (ms <= 0) {
    a.volume = clamp01(target());
    return Promise.resolve();
  }
  const from = a.volume;
  const start = performance.now();
  return new Promise((resolve) => {
    const id = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / ms);
      a.volume = clamp01(from + (target() - from) * t);
      if (t >= 1) {
        window.clearInterval(id);
        fades.delete(a);
        resolve();
      }
    }, 40);
    fades.set(a, id);
  });
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));


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

/**
 * Headless story VM.
 *
 * Runs a CompiledStory and produces Steps: visual/audio effects to apply,
 * followed by one blocking event (a line of dialogue, a menu, a wait, or the
 * end). Knows nothing about the DOM, so it runs the same in the browser,
 * Node tests, or a future native shell.
 */
import {
  EvalError, evaluate, truthy,
  type CompiledStory, type CompiledTranslation, type Instr, type Value, type Channel, type Span,
} from '@emaki/format';

export interface SpriteState {
  tag: string;
  /** The image's attributes; for a layered character, the option shown in each group, bottom first. */
  attrs: string[];
  at: string;
  /** An endless move (`float mira`, `shake mira forever`) until `still mira`; absent when she's still. */
  loop?: Motion;
}

export type Motion = 'hop' | 'nod' | 'bow' | 'shake' | 'float';
export type Tone = 'sepia' | 'mono';

/** `camera zoom 1.5 at 70% 30%`: zoom toward a point given in percent of the screen. */
export interface CameraState {
  zoom: number;
  x: number;
  y: number;
}

export interface SceneState {
  /** Background image name, or null for black. */
  bg: string | null;
  sprites: SpriteState[];
  /** Absent (or null) when the camera shows the whole picture. */
  camera?: CameraState | null;
  /** The picture's colour tone (`tone sepia`); absent for normal colours. Kept when the scene changes. */
  tone?: Tone;
}

export interface AudioState {
  music: { path: string; loop: boolean } | null;
  /** The looping sound (rain, engine hum) still playing, if any. One-shot sounds and voices aren't state. */
  sound?: { path: string; loop: true } | null;
  /** The ambience loop playing under the music. Missing in saves from before it existed. */
  ambience?: { path: string } | null;
}

export interface RunState {
  pc: number;
  vars: Record<string, Value>;
  stack: number[];
  scene: SceneState;
  audio: AudioState;
  ended: boolean;
  /** Most recent dialogue line, shown behind menus (also after load/rollback). */
  lastSay: SayBlock | null;
  /**
   * NVL mode (`nvl on`): the lines on the current page, the newest last; null
   * in ADV mode (the text box). Missing in saves from before NVL existed.
   */
  nvl?: SayBlock[] | null;
  /**
   * Each character's latest attributes (`mira smile: ...`, `show mira sad`),
   * kept while they're off screen, to pick their side image. Only stories
   * with side images keep it.
   */
  faces?: Record<string, string[]>;
  /** The game's screens shown over the story (`show screen hud`), bottom first. Absent when none. */
  screens?: string[];
}

/** `label` is the story label the line belongs to (for maps, analytics, debugging). */
export type SayBlock = {
  type: 'say'; id: string; who: Speaker | null;
  /** Plain text (markup removed, variables filled in). */
  text: string;
  /** Styled runs, only when the line uses bold/italic/colour. */
  spans?: Span[];
  line: number; label: string;
  /** The script file, when it isn't the main story.vn. */
  file?: string;
  /** The line's voice (from `play voice` just before it, or the header's `voice:` pattern), for replaying it. */
  voice?: string;
  /** The speaker's portrait for the text box (`image side mira smile`), when the story has one. */
  side?: string;
};

export interface ChoiceOption { index: number; id: string; text: string; spans?: Span[] }

export type Effect =
  /** `duration`: seconds, when the script set one (`with dissolve 1.5`). */
  | { type: 'scene'; bg: string | null; path: string | null; transition: string | null; duration?: number }
  /** `layers`: the images to stack, bottom first (one for a plain image; `path` is the first). */
  | { type: 'show'; tag: string; attrs: string[]; path: string; layers: string[]; at: string; transition: string | null; duration?: number; isNew: boolean }
  | { type: 'hide'; tag: string; transition: string | null; duration?: number }
  | { type: 'play'; channel: Channel; path: string; loop: boolean; fade: number | null }
  | { type: 'stop'; channel: Channel; fade: number | null }
  /** The story reached a declared ending (`end light_holds`); `name` is translated. */
  | { type: 'ending'; id: string; name: string }
  /** A `global var` changed: the host should store `values` (all globals) for future playthroughs. */
  | { type: 'globals'; values: Record<string, Value> }
  /** `name` is in the current language. */
  | { type: 'achieve'; id: string; name: string }
  /** Screen effects (`shake`, `flash red`); `duration` in seconds when the script set one. */
  | { type: 'shake'; duration?: number }
  | { type: 'flash'; color: string; duration?: number }
  /** A character on screen (by tag) or `textbox` hops, nods, bows or shakes its head, `times` times. */
  | { type: 'motion'; motion: Motion; target: string; times: number; forever?: true }
  /** A character's endless move stops. */
  | { type: 'still'; target: string }
  /** Tint the picture (null: normal colours) over `duration` seconds. */
  | { type: 'tone'; tone: Tone | null; duration?: number }
  /** Play a full-screen video; the host waits for it to end (or be skipped) before showing the next line. */
  | { type: 'movie'; path: string }
  /** The screens shown over the story changed (`show screen`, `hide screen`): all of them now, bottom first. */
  | { type: 'screens'; screens: string[] }
  /** Move the camera to `camera` (null: the whole picture) over `duration` seconds (instant when absent). */
  | { type: 'camera'; camera: CameraState | null; duration?: number };

export interface Speaker {
  id: string;
  name: string;
  color: string | null;
}

export type Block =
  | SayBlock
  | { type: 'menu'; id: string; choices: ChoiceOption[]; line: number; label: string; file?: string }
  | { type: 'wait'; seconds: number; line: number; label: string; file?: string }
  /** `call screen map`: the story waits for one of the screen's buttons to return (see Runner.returnFromScreen). */
  | { type: 'screen'; name: string; line: number; label: string; file?: string }
  | { type: 'end' };

export interface Step {
  effects: Effect[];
  block: Block;
}

export interface SaveData {
  format: 'emaki-save';
  version: 1;
  storyHash: string;
  state: RunState;
  block: Block;
  savedAt: string;
}

export class StoryError extends Error {
  line: number | null;
  constructor(message: string, line: number | null) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'StoryError';
    this.line = line;
  }
}

/** Max instructions executed between two blocking events before we assume an infinite loop. */
const STEP_LIMIT = 100_000;
/** Instructions the preload lookahead may visit; keeps it cheap on huge stories. */
const LOOKAHEAD_INSTRUCTIONS = 2_000;
const DEFAULT_POSITION = 'center';
/** Lines an NVL page keeps (a full page holds fewer; the player shows the ones that fit). */
const NVL_PAGE_MAX = 40;

interface HistoryEntry {
  state: RunState;
  block: Block;
}

export class Runner {
  readonly story: CompiledStory;
  private state: RunState;
  private current: Block | null = null;
  private history: HistoryEntry[] = [];
  /** Maximum rollback depth. */
  historyLimit = 500;
  private translation: CompiledTranslation | null = null;
  private textInstrs: Map<string, Extract<Instr, { op: 'say' | 'menu' }>> | null = null;
  /** Values of `global var`s, carried across playthroughs; they win over anything in a save or rollback. */
  private globalValues: Record<string, Value> = {};

  constructor(story: CompiledStory) {
    this.story = story;
    this.state = this.initialState();
  }

  /** Begin from the start label. */
  start(): Step {
    this.state = this.initialState();
    this.applyGlobals();
    this.history = [];
    return this.run();
  }

  /**
   * Begin from any label: a testing aid for writers ("play from here").
   * Variables start from their declared values, overridden by `vars`.
   * Pass `scene` to keep what's currently on screen, since a label that
   * doesn't open with `scene` would otherwise start on black.
   */
  startAt(label: string, opts: { vars?: Record<string, Value>; scene?: SceneState; screens?: string[] } = {}): Step {
    const pc = this.story.labels[label];
    if (pc === undefined) throw new StoryError(`No label named '${label}'`, null);
    this.state = this.initialState();
    this.state.pc = pc;
    for (const [name, v] of Object.entries(opts.vars ?? {})) {
      if (Object.prototype.hasOwnProperty.call(this.story.vars, name)) this.state.vars[name] = v;
    }
    if (opts.scene) this.state.scene = clone(opts.scene);
    if (opts.screens?.length) this.state.screens = [...opts.screens];
    this.applyGlobals();
    this.history = [];
    return this.run();
  }

  /**
   * Start at a line of the script (1-based), for previewing while writing.
   *
   * Begins at the first instruction on or after that line. The picture and
   * music are rebuilt by replaying the visual statements of that label from
   * its top down to the line, ignoring conditions and menus (if two branches
   * both change the background, the later one wins), so the preview opens on
   * the right scene instead of a black screen. Only declared variables in
   * `vars` are applied; the rest keep their starting values.
   */
  startAtLine(line: number, opts: { vars?: Record<string, Value>; file?: string } = {}): Step {
    const code = this.story.code;
    let pc = -1;
    for (let i = 0; i < code.length; i++) {
      const ins = code[i]!;
      if (ins.src.file !== opts.file) continue;
      // The compiler ends every label with a return tagged with the label's own line; skip those.
      const first = code[this.story.labels[ins.src.label] ?? i]!;
      if (ins.op === 'return' && ins.src.line < first.src.line) continue;
      const l = ins.src.line;
      if (l >= line && (pc < 0 || l < code[pc]!.src.line)) pc = i;
    }
    if (pc < 0) throw new StoryError(`Line ${line} is past the end of ${opts.file ?? 'story.vn'}`, null);
    const label = code[pc]!.src.label;
    const from = this.story.labels[label] ?? pc;

    this.state = this.initialState();
    for (const [name, v] of Object.entries(opts.vars ?? {})) {
      if (Object.prototype.hasOwnProperty.call(this.story.vars, name)) this.state.vars[name] = v;
    }
    const scene = this.state.scene;
    for (let i = from; i < pc; i++) {
      const ins = code[i]!;
      if (ins.op === 'scene') {
        scene.bg = ins.image === 'black' ? null : ins.image;
        scene.sprites = [];
        delete scene.camera; // a new scene shows the whole picture, as it does in play
      } else if (ins.op === 'show') {
        let sp = scene.sprites.find((x) => x.tag === ins.tag);
        if (!sp) scene.sprites.push(sp = { tag: ins.tag, attrs: this.nextAttrs(ins.tag, null, ins.attrs), at: ins.at ?? DEFAULT_POSITION });
        else {
          if (ins.attrs) sp.attrs = this.nextAttrs(ins.tag, sp.attrs, ins.attrs);
          if (ins.at) sp.at = ins.at;
        }
        this.noteFace(ins.tag, sp.attrs);
      } else if (ins.op === 'hide') {
        scene.sprites = scene.sprites.filter((x) => x.tag !== ins.tag);
      } else if (ins.op === 'say' && ins.who && ins.attrs.length) {
        this.sayAttrs(ins.who, ins.attrs, scene.sprites);
      } else if (ins.op === 'play' || ins.op === 'stop') {
        trackAudio(this.state.audio, ins);
      } else if (ins.op === 'nvl') {
        this.state.nvl = ins.mode === 'off' ? null : [];
      } else if (ins.op === 'camera') {
        scene.camera = cameraOf(ins);
      } else if (ins.op === 'motion' && ins.forever) {
        const sp = scene.sprites.find((x) => x.tag === ins.target);
        if (sp) sp.loop = ins.motion;
      } else if (ins.op === 'still') {
        const sp = scene.sprites.find((x) => x.tag === ins.target);
        if (sp) delete sp.loop;
      } else if (ins.op === 'tone') {
        if (ins.tone === 'none') delete scene.tone; else scene.tone = ins.tone;
      } else if (ins.op === 'screen' && ins.mode !== 'call') {
        showScreen(this.state, ins.name, ins.mode === 'show');
      }
    }
    this.state.pc = pc;
    this.applyGlobals();
    this.history = [];
    return this.run();
  }

  /**
   * Values of the story's `global var`s from earlier playthroughs (as stored
   * by the host). Unknown names and non-globals are ignored.
   */
  setGlobals(values: Record<string, Value>): void {
    const names = new Set(this.story.globals ?? []);
    this.globalValues = {};
    for (const [k, v] of Object.entries(values ?? {})) {
      if (names.has(k) && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) this.globalValues[k] = v;
    }
    this.applyGlobals();
  }

  /** Current values of every `global var`. */
  get globals(): Record<string, Value> {
    const out: Record<string, Value> = {};
    for (const name of this.story.globals ?? []) out[name] = this.state.vars[name] ?? this.story.vars[name]!;
    return out;
  }

  private applyGlobals(): void {
    for (const [k, v] of Object.entries(this.globalValues)) this.state.vars[k] = v;
  }

  /** Change a declared variable (testing aid). Throws for unknown names. */
  setVar(name: string, value: Value): void {
    if (!Object.prototype.hasOwnProperty.call(this.story.vars, name)) {
      throw new StoryError(`Unknown variable '${name}'`, null);
    }
    this.state.vars[name] = value;
  }

  /** Continue past the current dialogue line or wait. */
  advance(): Step {
    const b = this.current;
    if (!b) throw new StoryError('Story has not started', null);
    if (b.type === 'menu') throw new StoryError('A choice must be made before continuing', b.line);
    if (b.type === 'screen') throw new StoryError(`The screen '${b.name}' must return before the story goes on`, b.line);
    if (b.type === 'end') return { effects: [], block: b };
    return this.run();
  }

  /** Pick a menu option by its index in the original menu. */
  choose(index: number): Step {
    const b = this.current;
    if (!b || b.type !== 'menu') throw new StoryError('There is no menu to choose from', null);
    if (!b.choices.some((c) => c.index === index)) throw new StoryError(`Choice ${index} is not available`, b.line);
    const ins = this.story.code[this.state.pc];
    if (ins.op !== 'menu') throw new StoryError('Internal error: menu state out of sync', b.line);
    this.state.pc = ins.choices[index].target;
    return this.run();
  }

  /**
   * A button on the screen the story is waiting on (`call screen map -> place`)
   * returned: put `value` in the call's variable (when it has one and a value
   * was given) and go on.
   */
  returnFromScreen(value?: Value): Step {
    const b = this.current;
    if (!b || b.type !== 'screen') throw new StoryError('No screen is waiting to return', null);
    const ins = this.story.code[this.state.pc];
    if (ins?.op !== 'screen' || ins.mode !== 'call') throw new StoryError('Internal error: screen state out of sync', b.line);
    const effects: Effect[] = [];
    if (ins.into && value !== undefined) {
      this.state.vars[ins.into] = value;
      if (this.story.globals?.includes(ins.into)) {
        this.globalValues[ins.into] = value;
        effects.push({ type: 'globals', values: this.globals });
      }
    }
    this.state.pc++;
    const step = this.run();
    return { effects: [...effects, ...step.effects], block: step.block };
  }

  /** The screens shown over the story, bottom first. */
  get screens(): string[] {
    return [...(this.state.screens ?? [])];
  }

  /** Take a screen off the story (its own `close` button), as `hide screen` does. */
  hideScreen(name: string): void {
    showScreen(this.state, name, false);
  }

  /**
   * Show text in another language (null: the language the script is written
   * in). Lines and choices missing from the translation stay in the original.
   * The line on screen is redone at once; returns it.
   */
  setTranslation(t: CompiledTranslation | null): Block | null {
    this.translation = t;
    if (this.current) this.current = this.localize(this.current);
    return this.current;
  }

  get language(): string | null {
    return this.translation?.lang ?? null;
  }

  /** Forget rollback history, so going back stops here (e.g. once a game starts from its title screen). */
  clearHistory(): void {
    this.history = [];
  }

  /** Roll back to the previous blocking event. Returns null if at the beginning. */
  back(): { block: Block; scene: SceneState } | null {
    if (this.history.length < 2) return null;
    this.history.pop();
    const prev = this.history[this.history.length - 1];
    this.state = clone(prev.state);
    this.applyGlobals();
    this.current = this.localize(prev.block);
    return { block: this.current, scene: this.scene() };
  }

  get canGoBack(): boolean {
    return this.history.length > 1;
  }

  /**
   * Go back to the `n`th line of the log (0 = the oldest kept), as if Back
   * had been pressed until it was on screen. Null if there's no such line.
   */
  rewindTo(n: number): { block: Block; scene: SceneState } | null {
    let seen = -1;
    const at = this.history.findIndex((h) => h.block.type === 'say' && ++seen === n);
    return at < 0 || at === this.history.length - 1 ? null : this.restore(at);
  }

  /** Go back to the last choice before the one on screen (skip back to a choice). Null if there's none. */
  backToChoice(): { block: Block; scene: SceneState } | null {
    const at = this.lastChoice();
    return at < 0 ? null : this.restore(at);
  }

  get canGoBackToChoice(): boolean {
    return this.lastChoice() >= 0;
  }

  private lastChoice(): number {
    for (let i = this.history.length - 2; i >= 0; i--) if (this.history[i]!.block.type === 'menu') return i;
    return -1;
  }

  private restore(at: number): { block: Block; scene: SceneState } {
    this.history.length = at + 1;
    const h = this.history[at]!;
    this.state = clone(h.state);
    this.applyGlobals();
    this.current = this.localize(h.block);
    return { block: this.current, scene: this.scene() };
  }

  get block(): Block | null {
    return this.current;
  }

  get vars(): Readonly<Record<string, Value>> {
    return this.state.vars;
  }

  /** Dialogue lines seen so far on the current path (for the history log). */
  get log(): Array<Extract<Block, { type: 'say' }>> {
    return this.history
      .filter((h) => h.block.type === 'say')
      .map((h) => this.localize(h.block, h.state.vars) as Extract<Block, { type: 'say' }>);
  }

  /** Current scene, for redrawing from scratch (after load or rollback). */
  scene(): SceneState {
    return clone(this.state.scene);
  }

  audio(): AudioState {
    return clone(this.state.audio);
  }

  imagePath(name: string | null): string | null {
    if (!name || name === 'black') return null;
    return this.story.images[name] ?? null;
  }

  /** The images a sprite is drawn from, bottom first (one unless it's layered); null if it has none. */
  spriteLayers(s: SpriteState): string[] | null {
    return this.resolveSprite(s.tag, s.attrs);
  }

  /**
   * Image paths the story may need soon, nearest first, for preloading.
   *
   * Looks ahead from the current position without running anything: every
   * branch of conditions and menus is followed, calls are entered and
   * returned from, and the search stops `maxBlocks` lines/menus/waits away.
   * Over-fetching a little is fine; what matters is that the next scene's
   * images are already loaded when the player gets there.
   */
  upcomingImages(maxBlocks = 4): string[] {
    const code = this.story.code;
    const onScreen = new Set(this.state.scene.sprites.map((s) => s.tag));
    const found = new Set<string>();
    const add = (path: string | null | undefined) => { if (path) found.add(path); };
    // Buckets by distance (blocks passed), so nearer images come first.
    const buckets: Array<Array<{ pc: number; stack: number[] }>> = [[{ pc: this.state.pc, stack: [...this.state.stack] }]];
    const seen = new Set<string>();
    let budget = LOOKAHEAD_INSTRUCTIONS;

    for (let cost = 0; cost <= maxBlocks && cost < buckets.length; cost++) {
      const queue = buckets[cost]!;
      const push = (pc: number, stack: number[], dist: number) => {
        if (dist > maxBlocks) return;
        (buckets[dist] ??= []).push({ pc, stack });
      };
      while (queue.length && budget-- > 0) {
        const { pc, stack } = queue.shift()!;
        const key = pc + ':' + stack.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const ins = code[pc];
        if (!ins) continue;
        switch (ins.op) {
          case 'say':
            if (ins.who && ins.attrs.length) this.previewImages(ins.who, ins.attrs).forEach(add);
            push(pc + 1, stack, cost + 1);
            break;
          case 'menu':
            for (const c of ins.choices) push(c.target, stack, cost + 1);
            break;
          case 'wait':
            push(pc + 1, stack, cost + 1);
            break;
          case 'scene':
            add(this.imagePath(ins.image));
            push(pc + 1, stack, cost);
            break;
          case 'show':
            if (ins.attrs) this.previewImages(ins.tag, ins.attrs).forEach(add);
            else if (!onScreen.has(ins.tag)) this.resolveSprite(ins.tag, this.nextAttrs(ins.tag, null, null))?.forEach(add);
            push(pc + 1, stack, cost);
            break;
          case 'jump':
            push(ins.target, stack, cost);
            break;
          case 'jumpIfNot':
            push(pc + 1, stack, cost);
            push(ins.target, stack, cost);
            break;
          case 'call':
            push(ins.target, [...stack, pc + 1], cost);
            break;
          case 'return':
            if (stack.length) push(stack[stack.length - 1]!, stack.slice(0, -1), cost);
            break;
          case 'end':
            break;
          default:
            push(pc + 1, stack, cost);
        }
      }
    }
    return [...found];
  }

  save(): SaveData {
    if (!this.current) throw new StoryError('Nothing to save yet', null);
    return {
      format: 'emaki-save',
      version: 1,
      storyHash: this.story.hash,
      state: clone(this.state),
      block: clone(this.current),
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * Restore a save. Returns false (and changes nothing) if the save looks
   * invalid. A save from a different story build is loaded anyway when the
   * position still exists; `mismatch` tells the caller to warn the player.
   */
  load(data: SaveData): { ok: boolean; mismatch: boolean } {
    if (data?.format !== 'emaki-save' || !data.state || !data.block) return { ok: false, mismatch: false };
    if (data.state.pc < 0 || data.state.pc > this.story.code.length) return { ok: false, mismatch: false };
    this.state = clone(data.state);
    // Variables added in a newer build get their default values.
    this.state.vars = { ...this.story.vars, ...this.state.vars };
    this.applyGlobals();
    this.current = this.localize(clone(data.block));
    this.history = [{ state: clone(this.state), block: this.current }];
    return { ok: true, mismatch: data.storyHash !== this.story.hash };
  }

  /**
   * Live-preview resume: put the player back at the same line after the
   * script was edited. Exact restore if the story is unchanged; otherwise
   * find the same dialogue line by id (or the nearest line at/after its old
   * position) and continue from there with the saved variables.
   */
  resume(data: SaveData): Step | null {
    if (data?.format !== 'emaki-save' || !data.state || !data.block) return null;
    if (data.storyHash === this.story.hash && this.load(data).ok) {
      return { effects: [], block: this.current! };
    }
    if (data.block.type !== 'say' && data.block.type !== 'menu') return null;
    const code = this.story.code;
    const old = data.block;
    let idx = code.findIndex((i) => (i.op === 'say' || i.op === 'menu') && i.id === old.id);
    if (idx < 0) idx = code.findIndex((i) => (i.op === 'say' || i.op === 'menu') && i.src.file === old.file && i.src.line >= old.line);
    if (idx < 0) return null;
    const imagesOk = (name: string | null) => !name || name === 'black' || this.story.images[name] !== undefined;
    const scene = imagesOk(data.state.scene.bg) ? data.state.scene : { bg: null, sprites: [] };
    scene.sprites = scene.sprites.filter((sp) => this.resolveSprite(sp.tag, sp.attrs) !== null);
    this.state = {
      ...clone(data.state),
      scene: clone(scene),
      vars: { ...this.story.vars, ...data.state.vars },
      pc: idx,
      stack: [],
      ended: false,
    };
    this.applyGlobals();
    this.history = [];
    return this.run();
  }

  // ----------------------------------------------------------------------

  private initialState(): RunState {
    return {
      pc: this.story.start,
      vars: { ...this.story.vars },
      stack: [],
      scene: { bg: null, sprites: [] },
      audio: { music: null, sound: null, ambience: null },
      ended: false,
      lastSay: null,
      nvl: this.story.meta.nvl === 'on' ? [] : null,
    };
  }

  /** The line of dialogue most recently shown (e.g. the line a menu responds to). */
  /** In NVL mode, the lines on the page (the line being shown is the last); null in ADV mode. */
  get nvlPage(): SayBlock[] | null {
    const page = this.state.nvl;
    return page ? page.map((b) => this.localize(b) as SayBlock) : null;
  }

  get lastSay(): SayBlock | null {
    const b = this.state.lastSay;
    return b ? (this.localize(b) as SayBlock) : null;
  }

  private run(): Step {
    const effects: Effect[] = [];
    const s = this.state;
    const code = this.story.code;
    /** A `play voice` since the last line: it belongs to the next line. */
    let voice: string | null = null;

    for (let steps = 0; ; steps++) {
      if (steps > STEP_LIMIT) {
        throw new StoryError('The story seems stuck in a loop with no dialogue or choices', code[s.pc]?.src.line ?? null);
      }
      if (s.ended || s.pc >= code.length) return this.blockOn({ type: 'end' }, effects);

      const ins = code[s.pc];
      switch (ins.op) {
        case 'say': {
          s.pc++;
          if (ins.who && ins.attrs.length) {
            const sp = this.sayAttrs(ins.who, ins.attrs, s.scene.sprites);
            if (sp) effects.push(this.showEffect(sp, null, false, ins));
          }
          const block = this.sayBlock(ins, s.vars);
          const side = ins.who ? this.sideImage(ins.who) : null;
          if (side) block.side = side;
          // A voiced game (header `voice:`) plays each line's file without a `play voice` line.
          const own = voice ? null : this.story.voices?.[ins.id];
          if (own) effects.push({ type: 'play', channel: 'voice', path: own, loop: false, fade: null });
          if (voice ?? own) block.voice = (voice ?? own)!;
          if (s.nvl) s.nvl = [...s.nvl, block].slice(-NVL_PAGE_MAX);
          return this.blockOn(block, effects);
        }
        case 'menu': {
          const choices = ins.choices
            .map((c, index) => ({ c, index }))
            .filter(({ c }) => !c.cond || truthy(this.eval(c.cond, ins)))
            .map(({ c, index }): ChoiceOption => ({ index, id: c.id, ...this.text(c.id, c, ins, s.vars) }));
          if (choices.length === 0) {
            throw new StoryError('Every choice in this menu is hidden by its condition', ins.src.line);
          }
          return this.blockOn({ type: 'menu', id: ins.id, choices, line: ins.src.line, label: ins.src.label, ...fileOf(ins) }, effects);
        }
        case 'wait':
          s.pc++;
          return this.blockOn({ type: 'wait', seconds: ins.seconds, line: ins.src.line, label: ins.src.label, ...fileOf(ins) }, effects);
        case 'scene':
          s.pc++;
          s.scene = { bg: ins.image === 'black' ? null : ins.image, sprites: [], ...(s.scene.tone ? { tone: s.scene.tone } : {}) };
          if (s.nvl) s.nvl = []; // a new scene starts a new page
          effects.push({ type: 'scene', bg: s.scene.bg, path: this.imagePath(ins.image), transition: ins.transition, ...durationOf(ins) });
          break;
        case 'show': {
          s.pc++;
          let sp = s.scene.sprites.find((x) => x.tag === ins.tag);
          const isNew = !sp;
          if (!sp) {
            sp = { tag: ins.tag, attrs: this.nextAttrs(ins.tag, null, ins.attrs), at: ins.at ?? DEFAULT_POSITION };
            s.scene.sprites.push(sp);
          } else {
            if (ins.attrs) sp.attrs = this.nextAttrs(ins.tag, sp.attrs, ins.attrs);
            if (ins.at) sp.at = ins.at;
          }
          this.noteFace(ins.tag, sp.attrs);
          effects.push(this.showEffect(sp, ins.transition, isNew, ins));
          break;
        }
        case 'hide':
          s.pc++;
          if (s.scene.sprites.some((x) => x.tag === ins.tag)) {
            s.scene.sprites = s.scene.sprites.filter((x) => x.tag !== ins.tag);
            effects.push({ type: 'hide', tag: ins.tag, transition: ins.transition, ...durationOf(ins) });
          }
          break;
        case 'play':
          s.pc++;
          if (ins.channel === 'voice') voice = ins.path;
          trackAudio(s.audio, ins);
          effects.push({ type: 'play', channel: ins.channel, path: ins.path, loop: ins.loop, fade: ins.fade });
          break;
        case 'stop':
          s.pc++;
          if (ins.channel === 'voice') voice = null;
          trackAudio(s.audio, ins);
          effects.push({ type: 'stop', channel: ins.channel, fade: ins.fade });
          break;
        case 'nvl':
          s.pc++;
          s.nvl = ins.mode === 'off' ? null : [];
          break;
        case 'shake':
          s.pc++;
          effects.push({ type: 'shake', ...durationOf(ins) });
          break;
        case 'flash':
          s.pc++;
          effects.push({ type: 'flash', color: ins.color, ...durationOf(ins) });
          break;
        case 'motion': {
          s.pc++;
          if (ins.forever) {
            const sp = s.scene.sprites.find((x) => x.tag === ins.target);
            if (sp) sp.loop = ins.motion;
          }
          effects.push({ type: 'motion', motion: ins.motion, target: ins.target, times: ins.times ?? 1, ...(ins.forever ? { forever: true as const } : {}) });
          break;
        }
        case 'still': {
          s.pc++;
          const sp = s.scene.sprites.find((x) => x.tag === ins.target);
          if (sp) delete sp.loop;
          effects.push({ type: 'still', target: ins.target });
          break;
        }
        case 'tone':
          s.pc++;
          if (ins.tone === 'none') delete s.scene.tone; else s.scene.tone = ins.tone;
          effects.push({ type: 'tone', tone: s.scene.tone ?? null, ...durationOf(ins) });
          break;
        case 'movie':
          s.pc++;
          effects.push({ type: 'movie', path: ins.path });
          break;
        case 'screen':
          if (ins.mode === 'call') {
            return this.blockOn({ type: 'screen', name: ins.name, line: ins.src.line, label: ins.src.label, ...fileOf(ins) }, effects);
          }
          s.pc++;
          showScreen(s, ins.name, ins.mode === 'show');
          effects.push({ type: 'screens', screens: [...(s.screens ?? [])] });
          break;
        case 'camera':
          s.pc++;
          s.scene.camera = cameraOf(ins);
          effects.push({ type: 'camera', camera: s.scene.camera, ...durationOf(ins) });
          break;
        case 'achieve': {
          s.pc++;
          const name = this.translation?.strings[`achievement.${ins.id}`]?.text ?? this.story.achievements?.[ins.id]?.name ?? ins.id;
          effects.push({ type: 'achieve', id: ins.id, name });
          break;
        }
        case 'set':
          s.pc++;
          s.vars[ins.name] = this.eval(ins.expr, ins);
          if (this.story.globals?.includes(ins.name)) {
            this.globalValues[ins.name] = s.vars[ins.name]!;
            effects.push({ type: 'globals', values: this.globals });
          }
          break;
        case 'jump':
          s.pc = ins.target;
          break;
        case 'jumpIfNot':
          s.pc = truthy(this.eval(ins.cond, ins)) ? s.pc + 1 : ins.target;
          break;
        case 'call':
          s.stack.push(s.pc + 1);
          s.pc = ins.target;
          break;
        case 'return':
          if (s.stack.length) s.pc = s.stack.pop()!;
          else s.ended = true;
          break;
        case 'end':
          s.ended = true;
          if (ins.ending) {
            const name = this.translation?.strings[`ending.${ins.ending}`]?.text ?? this.story.endings?.[ins.ending]?.name ?? ins.ending;
            effects.push({ type: 'ending', id: ins.ending, name });
          }
          break;
      }
    }
  }

  private blockOn(block: Block, effects: Effect[]): Step {
    this.current = block;
    if (block.type === 'say') this.state.lastSay = block;
    this.history.push({ state: clone(this.state), block });
    if (this.history.length > this.historyLimit) this.history.shift();
    return { effects, block };
  }

  private showEffect(sp: SpriteState, transition: string | null, isNew: boolean, ins: Instr): Effect {
    const layers = this.resolveSprite(sp.tag, sp.attrs);
    if (!layers?.length) throw new StoryError(`No image for '${[sp.tag, ...sp.attrs].join(' ')}'`, ins.src.line);
    return { type: 'show', tag: sp.tag, attrs: [...sp.attrs], path: layers[0]!, layers, at: sp.at, transition, ...durationOf(ins), isNew };
  }

  /** A sprite's images, bottom first: the image named `tag attrs...`, or a layered character's layers. */
  private resolveSprite(tag: string, attrs: string[]): string[] | null {
    const layers = this.story.layered?.[tag];
    if (!layers) {
      const path = this.story.images[[tag, ...attrs].join(' ')];
      return path === undefined ? null : [path];
    }
    return layers.flatMap((l) => {
      if ('path' in l) return [l.path];
      const chosen = attrs.find((a) => Object.hasOwn(l.options, a));
      return chosen ? [l.options[chosen]!] : [];
    });
  }

  /**
   * A sprite's attributes after a line gives `given` (null: none given) to a
   * sprite showing `current` (null: not on screen yet). A plain image swaps
   * all of them; a layered character swaps one group's option per attribute,
   * and `-blush` takes an optional group's option off.
   */
  private nextAttrs(tag: string, current: string[] | null, given: string[] | null): string[] {
    const layers = this.story.layered?.[tag];
    if (!layers) return given ? [...given] : current ? [...current] : this.defaultAttrs(tag);
    const groupOf = (a: string) => layers.findIndex((l) => 'group' in l && Object.hasOwn(l.options, a));
    let attrs = current ? [...current] : layers.flatMap((l) => ('group' in l && l.default ? [l.default] : []));
    for (const g of given ?? []) {
      const name = g.replace(/^-/, '');
      const i = groupOf(name);
      if (i < 0) continue;
      attrs = attrs.filter((a) => groupOf(a) !== i);
      if (!g.startsWith('-')) attrs.push(name);
    }
    return attrs.sort((a, b) => groupOf(a) - groupOf(b));
  }

  /** Side images by character: `image side mira smile` -> mira: [{ attrs: [smile], path }]. */
  private sides: Map<string, Array<{ attrs: string[]; path: string }>> | null = null;

  private sideImages(): Map<string, Array<{ attrs: string[]; path: string }>> {
    if (this.sides) return this.sides;
    this.sides = new Map();
    for (const [name, path] of Object.entries(this.story.images)) {
      const [side, who, ...attrs] = name.split(' ');
      if (side !== 'side' || !who) continue;
      if (!this.sides.has(who)) this.sides.set(who, []);
      this.sides.get(who)!.push({ attrs, path });
    }
    return this.sides;
  }

  /**
   * A line's attributes (`mira smile: ...`) change the speaker's sprite when
   * they're on screen and it has that image, and always their side image.
   * Returns the sprite if it changed.
   */
  private sayAttrs(who: string, attrs: string[], sprites: SpriteState[]): SpriteState | null {
    const sp = sprites.find((x) => x.tag === who);
    this.noteFace(who, this.nextAttrs(who, sp?.attrs ?? this.state.faces?.[who] ?? null, attrs));
    if (!sp) return null;
    const next = this.nextAttrs(who, sp.attrs, attrs);
    if (!this.resolveSprite(who, next)) return null; // only a side image has these attributes
    sp.attrs = next;
    return sp;
  }

  /** Remember a character's latest attributes, for their side image. */
  private noteFace(tag: string, attrs: string[]): void {
    if (!this.sideImages().has(tag)) return;
    (this.state.faces ??= {})[tag] = [...attrs];
  }

  /**
   * The speaker's side image: the `side <who> ...` image whose attributes they
   * all have now, the most specific one first; `side <who>` alone as a fallback.
   */
  private sideImage(who: string): string | null {
    const options = this.sideImages().get(who);
    if (!options) return null;
    const have = new Set(this.state.faces?.[who] ?? []);
    let best: { attrs: string[]; path: string } | null = null;
    for (const o of options) {
      if (o.attrs.every((a) => have.has(a)) && (!best || o.attrs.length > best.attrs.length)) best = o;
    }
    return best?.path ?? null;
  }

  /** Images a line could bring in, for preloading (a layered character's named options only). */
  private previewImages(tag: string, attrs: string[]): string[] {
    const layers = this.story.layered?.[tag];
    if (!layers) return this.resolveSprite(tag, attrs) ?? [];
    return attrs.flatMap((a) => layers.flatMap((l) => ('group' in l && Object.hasOwn(l.options, a) ? [l.options[a]!] : [])));
  }

  /** Attributes to use when showing a tag with none given: exact tag image, else the first declared. */
  private defaultAttrs(tag: string): string[] {
    if (this.story.images[tag]) return [];
    const first = Object.keys(this.story.images).find((n) => n.startsWith(tag + ' '));
    return first ? first.split(' ').slice(1) : [];
  }

  private eval(e: Parameters<typeof evaluate>[0], ins: Instr): Value {
    try {
      return evaluate(e, this.state.vars);
    } catch (err) {
      if (err instanceof EvalError) throw new StoryError(err.message, ins.src.line);
      throw err;
    }
  }

  // ---------------------------------------------------------------- text

  private sayBlock(ins: Extract<Instr, { op: 'say' }>, vars: Record<string, Value>): SayBlock {
    const c = ins.who ? this.story.characters[ins.who] : null;
    return {
      type: 'say',
      id: ins.id,
      who: ins.who && c ? { id: ins.who, name: this.translation?.names[ins.who] ?? c.name, color: c.color } : null,
      ...this.text(ins.id, ins, ins, vars),
      line: ins.src.line,
      ...fileOf(ins),
      label: ins.src.label,
    };
  }

  /** The text for an id: translated if available, with variables filled in. */
  private text(id: string, original: { text: string; spans?: Span[] }, ins: Instr, vars: Record<string, Value>): { text: string; spans?: Span[] } {
    const t = this.translation?.strings[id] ?? original;
    return {
      text: this.interpolate(t.text, ins, vars),
      ...(t.spans ? { spans: t.spans.map((sp) => ({ ...sp, text: this.interpolate(sp.text, ins, vars) })) } : {}),
    };
  }

  /** Redo a block's text in the current language (after switching language, rolling back or loading). */
  private localize(b: Block, vars: Record<string, Value> = this.state.vars): Block {
    if (b.type !== 'say' && b.type !== 'menu') return b;
    this.textInstrs ??= new Map(this.story.code.flatMap((i) => (i.op === 'say' || i.op === 'menu' ? [[i.id, i] as const] : [])));
    const ins = this.textInstrs.get(b.id);
    try {
      if (b.type === 'say' && ins?.op === 'say') {
        return { ...this.sayBlock(ins, vars), ...(b.voice ? { voice: b.voice } : {}), ...(b.side ? { side: b.side } : {}) };
      }
      if (b.type === 'menu' && ins?.op === 'menu') {
        return {
          ...b,
          choices: b.choices.map((c) => {
            const src = ins.choices[c.index];
            return src && src.id === c.id ? { index: c.index, id: c.id, ...this.text(c.id, src, ins, vars) } : c;
          }),
        };
      }
    } catch {
      // A variable the old text used is gone (the script changed): keep the block as it was.
    }
    return b;
  }

  private interpolate(text: string, ins: Instr, vars: Record<string, Value> = this.state.vars): string {
    return text.replace(/\{\{|\}\}|\{([A-Za-z_]\w*)\}/g, (m, name: string | undefined) => {
      if (m === '{{') return '{';
      if (m === '}}') return '}';
      const v = vars[name!];
      if (v === undefined) throw new StoryError(`Unknown variable '${name}' in text`, ins.src.line);
      return String(v);
    });
  }
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Keeps the audio that outlasts a line (music, a looping sound) in the saved state. */
function trackAudio(audio: AudioState, ins: Extract<Instr, { op: 'play' | 'stop' }>): void {
  if (ins.channel === 'music') audio.music = ins.op === 'play' ? { path: ins.path, loop: ins.loop } : null;
  else if (ins.channel === 'sound') {
    if (ins.op === 'stop') audio.sound = null;
    else if (ins.loop) audio.sound = { path: ins.path, loop: true };
  } else if (ins.channel === 'ambience') {
    audio.ambience = ins.op === 'play' && ins.loop ? { path: ins.path } : null;
  }
}

function fileOf(ins: Instr): { file?: string } {
  return ins.src.file ? { file: ins.src.file } : {};
}

/** The camera a `camera` instruction leaves; null for the whole picture (`camera reset`). */
function cameraOf(ins: Extract<Instr, { op: 'camera' }>): CameraState | null {
  return ins.zoom === 1 && ins.x === 50 && ins.y === 50 ? null : { zoom: ins.zoom, x: ins.x, y: ins.y };
}

function durationOf(ins: Instr): { duration?: number } {
  return 'duration' in ins && ins.duration !== undefined ? { duration: ins.duration } : {};
}

/** Put a screen over the story (on top) or take it off. */
function showScreen(s: RunState, name: string, show: boolean): void {
  const list = (s.screens ?? []).filter((n) => n !== name);
  if (show) list.push(name);
  if (list.length) s.screens = list;
  else delete s.screens;
}

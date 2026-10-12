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
  type CompiledStory, type Instr, type Value, type Channel, type Span,
} from '@emaki/format';

export interface SpriteState {
  tag: string;
  attrs: string[];
  at: string;
}

export interface SceneState {
  /** Background image name, or null for black. */
  bg: string | null;
  sprites: SpriteState[];
}

export interface AudioState {
  music: { path: string; loop: boolean } | null;
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
}

/** `label` is the story label the line belongs to (for maps, analytics, debugging). */
export type SayBlock = {
  type: 'say'; id: string; who: Speaker | null;
  /** Plain text (markup removed, variables filled in). */
  text: string;
  /** Styled runs, only when the line uses bold/italic/colour. */
  spans?: Span[];
  line: number; label: string;
};

export interface ChoiceOption { index: number; id: string; text: string; spans?: Span[] }

export type Effect =
  | { type: 'scene'; bg: string | null; path: string | null; transition: string | null }
  | { type: 'show'; tag: string; attrs: string[]; path: string; at: string; transition: string | null; isNew: boolean }
  | { type: 'hide'; tag: string; transition: string | null }
  | { type: 'play'; channel: Channel; path: string; loop: boolean; fade: number | null }
  | { type: 'stop'; channel: Channel; fade: number | null };

export interface Speaker {
  id: string;
  name: string;
  color: string | null;
}

export type Block =
  | SayBlock
  | { type: 'menu'; id: string; choices: ChoiceOption[]; line: number; label: string }
  | { type: 'wait'; seconds: number; line: number; label: string }
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
const DEFAULT_POSITION = 'center';

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

  constructor(story: CompiledStory) {
    this.story = story;
    this.state = this.initialState();
  }

  /** Begin from the start label. */
  start(): Step {
    this.state = this.initialState();
    this.history = [];
    return this.run();
  }

  /**
   * Begin from any label: a testing aid for writers ("play from here").
   * Variables start from their declared values, overridden by `vars`.
   * Pass `scene` to keep what's currently on screen, since a label that
   * doesn't open with `scene` would otherwise start on black.
   */
  startAt(label: string, opts: { vars?: Record<string, Value>; scene?: SceneState } = {}): Step {
    const pc = this.story.labels[label];
    if (pc === undefined) throw new StoryError(`No label named '${label}'`, null);
    this.state = this.initialState();
    this.state.pc = pc;
    for (const [name, v] of Object.entries(opts.vars ?? {})) {
      if (Object.prototype.hasOwnProperty.call(this.story.vars, name)) this.state.vars[name] = v;
    }
    if (opts.scene) this.state.scene = clone(opts.scene);
    this.history = [];
    return this.run();
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

  /** Roll back to the previous blocking event. Returns null if at the beginning. */
  back(): { block: Block; scene: SceneState } | null {
    if (this.history.length < 2) return null;
    this.history.pop();
    const prev = this.history[this.history.length - 1];
    this.state = clone(prev.state);
    this.current = prev.block;
    return { block: prev.block, scene: this.scene() };
  }

  get canGoBack(): boolean {
    return this.history.length > 1;
  }

  get block(): Block | null {
    return this.current;
  }

  get vars(): Readonly<Record<string, Value>> {
    return this.state.vars;
  }

  /** Dialogue lines seen so far on the current path (for the history log). */
  get log(): Array<Extract<Block, { type: 'say' }>> {
    return this.history.map((h) => h.block).filter((b): b is Extract<Block, { type: 'say' }> => b.type === 'say');
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

  spritePath(s: SpriteState): string | null {
    return this.resolveSprite(s.tag, s.attrs);
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
    this.current = clone(data.block);
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
    if (idx < 0) idx = code.findIndex((i) => (i.op === 'say' || i.op === 'menu') && i.src.line >= old.line);
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
      audio: { music: null },
      ended: false,
      lastSay: null,
    };
  }

  /** The line of dialogue most recently shown (e.g. the line a menu responds to). */
  get lastSay(): SayBlock | null {
    return this.state.lastSay ?? null;
  }

  private run(): Step {
    const effects: Effect[] = [];
    const s = this.state;
    const code = this.story.code;

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
            const sp = s.scene.sprites.find((x) => x.tag === ins.who);
            if (sp) {
              sp.attrs = [...ins.attrs];
              effects.push(this.showEffect(sp, null, false, ins));
            }
          }
          const c = ins.who ? this.story.characters[ins.who] : null;
          return this.blockOn({
            type: 'say',
            id: ins.id,
            who: ins.who && c ? { id: ins.who, name: c.name, color: c.color } : null,
            text: this.interpolate(ins.text, ins),
            ...(ins.spans ? { spans: this.interpolateSpans(ins.spans, ins) } : {}),
            line: ins.src.line,
            label: ins.src.label,
          }, effects);
        }
        case 'menu': {
          const choices = ins.choices
            .map((c, index) => ({ c, index }))
            .filter(({ c }) => !c.cond || truthy(this.eval(c.cond, ins)))
            .map(({ c, index }): ChoiceOption => ({
              index, id: c.id, text: this.interpolate(c.text, ins),
              ...(c.spans ? { spans: this.interpolateSpans(c.spans, ins) } : {}),
            }));
          if (choices.length === 0) {
            throw new StoryError('Every choice in this menu is hidden by its condition', ins.src.line);
          }
          return this.blockOn({ type: 'menu', id: ins.id, choices, line: ins.src.line, label: ins.src.label }, effects);
        }
        case 'wait':
          s.pc++;
          return this.blockOn({ type: 'wait', seconds: ins.seconds, line: ins.src.line, label: ins.src.label }, effects);
        case 'scene':
          s.pc++;
          s.scene = { bg: ins.image === 'black' ? null : ins.image, sprites: [] };
          effects.push({ type: 'scene', bg: s.scene.bg, path: this.imagePath(ins.image), transition: ins.transition });
          break;
        case 'show': {
          s.pc++;
          let sp = s.scene.sprites.find((x) => x.tag === ins.tag);
          const isNew = !sp;
          if (!sp) {
            sp = { tag: ins.tag, attrs: ins.attrs ?? this.defaultAttrs(ins.tag), at: ins.at ?? DEFAULT_POSITION };
            s.scene.sprites.push(sp);
          } else {
            if (ins.attrs) sp.attrs = [...ins.attrs];
            if (ins.at) sp.at = ins.at;
          }
          effects.push(this.showEffect(sp, ins.transition, isNew, ins));
          break;
        }
        case 'hide':
          s.pc++;
          if (s.scene.sprites.some((x) => x.tag === ins.tag)) {
            s.scene.sprites = s.scene.sprites.filter((x) => x.tag !== ins.tag);
            effects.push({ type: 'hide', tag: ins.tag, transition: ins.transition });
          }
          break;
        case 'play':
          s.pc++;
          if (ins.channel === 'music') s.audio.music = { path: ins.path, loop: ins.loop };
          effects.push({ type: 'play', channel: ins.channel, path: ins.path, loop: ins.loop, fade: ins.fade });
          break;
        case 'stop':
          s.pc++;
          if (ins.channel === 'music') s.audio.music = null;
          effects.push({ type: 'stop', channel: ins.channel, fade: ins.fade });
          break;
        case 'set':
          s.pc++;
          s.vars[ins.name] = this.eval(ins.expr, ins);
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
    const path = this.resolveSprite(sp.tag, sp.attrs);
    if (path === null) throw new StoryError(`No image for '${[sp.tag, ...sp.attrs].join(' ')}'`, ins.src.line);
    return { type: 'show', tag: sp.tag, attrs: [...sp.attrs], path, at: sp.at, transition, isNew };
  }

  private resolveSprite(tag: string, attrs: string[]): string | null {
    const name = [tag, ...attrs].join(' ');
    return this.story.images[name] ?? null;
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

  private interpolateSpans(spans: Span[], ins: Instr): Span[] {
    return spans.map((sp) => ({ ...sp, text: this.interpolate(sp.text, ins) }));
  }

  private interpolate(text: string, ins: Instr): string {
    return text.replace(/\{\{|\}\}|\{([A-Za-z_]\w*)\}/g, (m, name: string | undefined) => {
      if (m === '{{') return '{';
      if (m === '}}') return '}';
      const v = this.state.vars[name!];
      if (v === undefined) throw new StoryError(`Unknown variable '${name}' in text`, ins.src.line);
      return String(v);
    });
  }
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

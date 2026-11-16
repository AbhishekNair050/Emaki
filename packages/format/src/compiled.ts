/**
 * The compiled story format: what runtimes execute.
 *
 * This is the portability contract. A runtime in any language (TypeScript
 * today, a native player for consoles later) only needs to understand this
 * JSON shape plus the expression trees in expr.ts. See docs/story-format.md.
 */
import type { Channel } from './ast.ts';
import type { Expr, Value } from './expr.ts';
import type { Span } from './markup.ts';
import type { Grade, LayerProps } from './layers.ts';

export const FORMAT_ID = 'emaki-story';
import type { CompiledScreen } from './screens.ts';

/** 3: free layers (D-062): `show` properties, `animate`, `with`. (2 was a packed version-1 story, before `packed` existed: see pack.ts.) */
export const FORMAT_VERSION = 3;

export interface SrcRef {
  /** 1-based line in the source .vn file. */
  line: number;
  /** That file, relative to the game folder, when it isn't the main story.vn. */
  file?: string;
  /** Label this instruction belongs to. */
  label: string;
}

export type Instr =
  /** `text` has markup removed; `spans` (only when styled) carries bold/italic/colour runs. */
  | { op: 'say'; id: string; who: string | null; attrs: string[]; text: string; spans?: Span[]; src: SrcRef }
  /** `duration` (seconds) only when the script gives one: `with dissolve 1.5`. */
  | { op: 'scene'; image: string | null; transition: string | null; duration?: number; src: SrcRef }
  /**
   * `tag` and `attrs` name the image; `layer` is the name it is shown as when that isn't `tag`
   * (`show street as far`). `props`: where and how it is drawn (D-062), positions in percent of the screen.
   */
  | { op: 'show'; tag: string; attrs: string[] | null; layer?: string; at: string | null; props?: LayerProps; transition: string | null; duration?: number; src: SrcRef }
  /**
   * Move a layer toward `props` over `duration` seconds along `ease` (D-062). Non-blocking; the state keeps the targets.
   * With `animation`, play that declared animation instead (null: stop the one playing).
   */
  | { op: 'animate'; layer: string; props: LayerProps; duration: number; ease: string; animation?: string | null; src: SrcRef }
  /** Show the picture changes since the last block through one transition (D-062). */
  | { op: 'with'; transition: string; duration?: number; src: SrcRef }
  | { op: 'hide'; tag: string; transition: string | null; duration?: number; src: SrcRef }
  | { op: 'play'; channel: Channel; path: string; loop: boolean; fade: number | null; src: SrcRef }
  | { op: 'stop'; channel: Channel; fade: number | null; src: SrcRef }
  | { op: 'set'; name: string; expr: Expr; src: SrcRef }
  | { op: 'jump'; target: number; label?: string; src: SrcRef }
  | { op: 'jumpIfNot'; cond: Expr; target: number; src: SrcRef }
  | { op: 'menu'; id: string; choices: CompiledChoice[]; src: SrcRef }
  | { op: 'call'; target: number; label: string; src: SrcRef }
  | { op: 'return'; src: SrcRef }
  | { op: 'end'; ending?: string; src: SrcRef }
  | { op: 'wait'; seconds: number; src: SrcRef }
  /** Unlock an achievement (declared in `achievements`). Non-blocking. */
  | { op: 'achieve'; id: string; src: SrcRef }
  | { op: 'nvl'; mode: 'on' | 'off' | 'clear'; src: SrcRef }
  /** Screen effects; `duration` (seconds) only when the script gives one. Non-blocking. */
  | { op: 'shake'; duration?: number; src: SrcRef }
  /**
   * A character (by tag) or `textbox` hops, nods, bows, shakes or floats, `times`
   * times (once when absent), or over and over with `forever` (characters only;
   * part of the sprite's state until `still` or `hide`). Non-blocking.
   */
  | { op: 'motion'; motion: 'hop' | 'nod' | 'bow' | 'shake' | 'float'; target: string; times?: number; forever?: true; src: SrcRef }
  /** Stop a character's endless move. */
  | { op: 'still'; target: string; src: SrcRef }
  /** Tint the picture (`sepia`, `mono`; `none` for normal colours) over `duration` seconds. Lasts across scenes. */
  | { op: 'tone'; tone: 'sepia' | 'mono' | 'none'; duration?: number; src: SrcRef }
  /** A full-screen video; blocks until it ends or the player skips it. */
  | { op: 'movie'; path: string; src: SrcRef }
  /**
   * `show`/`hide`: a screen stays over the story (part of the state) or goes.
   * `call`: show it and block until one of its buttons returns; the value goes
   * into the variable `into`, when given.
   */
  | { op: 'screen'; mode: 'show' | 'hide' | 'call'; name: string; into?: string; src: SrcRef }
  /**
   * A plugin's command with its arguments. `waits`: the story blocks until the
   * plugin finishes, putting its result in `into`. `lasting`: the command is
   * kept in the state under that slot (`ends` clears it) so it can be redone
   * after a load or rollback.
   */
  | { op: 'plugin'; plugin: string; command: string; args: Record<string, Expr>; waits?: true; lasting?: string; ends?: true; into?: string; src: SrcRef }
  | { op: 'flash'; color: string; duration?: number; src: SrcRef }
  /**
   * Zoom the picture (backgrounds and characters, not the text) by `zoom` (1 =
   * the whole picture) toward the point `x`, `y` (percent of the screen), over
   * `duration` seconds (instant when absent). Non-blocking; a new scene resets it.
   */
  | { op: 'camera'; zoom: number; x: number; y: number; duration?: number; src: SrcRef };

/**
 * An `animation`: keys at `t` seconds setting `props` (the rest hold), easing toward the next key along `ease`;
 * `duration` is the last key's time; a `loop` starts over from its first key.
 */
export interface CompiledAnimation { loop: boolean; duration: number; keys: Array<{ t: number; props: LayerProps; ease: string }> }

/** A layer of a layered character: always drawn, or the group's chosen option (`default` when none was chosen; null for an optional group). */
export type CompiledLayer =
  | { path: string }
  | { group: string; options: Record<string, string>; default: string | null };

export interface CompiledChoice {
  id: string;
  text: string;
  spans?: Span[];
  cond: Expr | null;
  target: number;
}

export interface CompiledStory {
  format: typeof FORMAT_ID;
  version: number;
  /** The code is packed (pack.ts); runtimes expand it with `loadStory` first. */
  packed?: true;
  meta: Record<string, string>;
  /** Instruction index where the story begins. */
  start: number;
  characters: Record<string, { name: string; color: string | null }>;
  /** Image name ("mira smile", "kitchen") -> asset path. */
  images: Record<string, string>;
  audio: Record<string, string>;
  /** Keyed moves (`animation drift:`, D-062) by name; absent when none. */
  animations?: Record<string, CompiledAnimation>;
  /** Colour grades (`grade dusk: ...`, D-062) by name; absent when none. */
  grades?: Record<string, Grade>;
  /** Characters drawn from layers (`layered mira:`): tag -> layers, bottom first. Absent when none. */
  layered?: Record<string, CompiledLayer[]>;
  /** The game's own screens (`screen title:`), by name. Absent when it has none. */
  screens?: Record<string, CompiledScreen>;
  /** Achievement id -> display name. Absent when the story has none. */
  achievements?: Record<string, { name: string }>;
  /** Initial variable values. */
  vars: Record<string, Value>;
  /** Images for the Extras gallery, in the order they're declared (`image ... gallery`). */
  gallery?: string[];
  /** The music room's tracks (`audio ... music "Title"`), in order: audio name, title and file. */
  music?: Array<{ name: string; title: string; path: string }>;
  /** Replayable scenes (`replay label "Name"`), in order; `image` is a picture path. */
  replays?: Array<{ label: string; name: string; image?: string; until?: string }>;
  /** Endings (`ending id "Name"`), reached with `end id`. */
  endings?: Record<string, { name: string }>;
  /**
   * Voice files by line id, for a header `voice: voice/{id}.ogg`: the lines
   * whose file exists. Filled in from the game folder when the whole game is
   * compiled (not part of `hash`).
   */
  voices?: Record<string, string>;
  /** Variables declared `global var`: the player keeps their values across playthroughs. */
  globals?: string[];
  /** Label name -> instruction index. */
  labels: Record<string, number>;
  code: Instr[];
  /** Content hash, used to detect saves from a different build. */
  hash: string;
}

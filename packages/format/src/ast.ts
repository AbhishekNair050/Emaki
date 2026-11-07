import type { ScreenDef } from './screens.ts';
import type { Expr } from './expr.ts';

/** 1-based source line. Every node carries one so tools can jump to source. */
export interface Loc {
  line: number;
  /** The file, relative to the game folder, when it isn't the main story.vn (multi-file stories). */
  file?: string;
}

/**
 * Comments and blank lines written above a node, in order: "# text" for a
 * comment, "" for a blank line. Kept so tools that rewrite a script (the
 * formatter, the visual editor) never lose a writer's notes. Absent when empty.
 */
export interface Trivia {
  leading?: string[];
}

export interface CharacterDef extends Trivia { id: string; name: string; color: string | null; loc: Loc }
export interface ImageDef extends Trivia {
  name: string;
  path: string;
  /** `image beach = "cg/beach.png" gallery`: shown in the Extras gallery once seen. */
  gallery?: boolean;
  loc: Loc;
}
export interface AudioDef extends Trivia { name: string; path: string; loc: Loc }
/** One option of a layer group: `smile "sprites/mira/smile.png"`. */
export interface LayerOption extends Trivia { attr: string; path: string; loc: Loc }
/** A layer of a `layered` character: drawn always, or one option of a group at a time. */
export type LayerDef = Trivia & (
  | { kind: 'always'; path: string; loc: Loc }
  /** `optional`: nothing is drawn until one of its options is shown (`show mira blush`, `show mira -blush`). */
  | { kind: 'group'; name: string; optional: boolean; options: LayerOption[]; loc: Loc }
);
/** `layered mira:` a character drawn from stacked layers (body, outfit, face), bottom first. */
export interface LayeredDef extends Trivia { tag: string; layers: LayerDef[]; loc: Loc }
export interface VarDef extends Trivia {
  name: string;
  init: Expr;
  /** `global var`: kept across playthroughs (endings seen, unlocked extras), not part of saves. */
  global?: boolean;
  loc: Loc;
}
export interface AchievementDef extends Trivia { id: string; name: string; loc: Loc }
/** `ending light_holds "The Light Holds"`, reached with `end light_holds`. */
export interface EndingDef extends Trivia { id: string; name: string; loc: Loc }
export interface LabelDef extends Trivia { name: string; body: Stmt[]; loc: Loc }

export interface Program {
  /** Frontmatter key/values (title, author, start, ...). Key order preserved. */
  meta: Array<[string, string]>;
  characters: CharacterDef[];
  images: ImageDef[];
  audio: AudioDef[];
  layered: LayeredDef[];
  /** `screen title:` and friends: the game's own screens (see screens.ts). */
  screens: ScreenDef[];
  vars: VarDef[];
  achievements: AchievementDef[];
  endings: EndingDef[];
  labels: LabelDef[];
  /** Comments after the last line of the file. */
  trailing?: string[];
}

/** `ambience`: a loop that plays under the music (rain, a crowd), independent of sound effects. */
export type Channel = 'music' | 'ambience' | 'sound' | 'voice';
export type NvlMode = 'on' | 'off' | 'clear';
export type AssignOp = '=' | '+=' | '-=';

export interface Choice extends Trivia {
  text: string;
  cond: Expr | null;
  body: Stmt[];
  loc: Loc;
}

export interface IfBranch extends Trivia {
  /** null for `else`. */
  cond: Expr | null;
  body: Stmt[];
  loc: Loc;
}

export type Stmt = Trivia & (
  /** `attrs` may take an optional layer off: `mira -blush: Fine.` */
  | { type: 'say'; who: string | null; attrs: string[]; text: string; loc: Loc }
  /** `duration`: seconds, from `with dissolve 1.5` (the transition's default when absent). */
  | { type: 'scene'; image: string | null; transition: string | null; duration?: number; loc: Loc }
  | { type: 'show'; tag: string; attrs: string[]; at: string | null; transition: string | null; duration?: number; loc: Loc }
  | { type: 'hide'; tag: string; transition: string | null; duration?: number; loc: Loc }
  | { type: 'play'; channel: Channel; asset: AssetRef; loop: boolean | null; fade: number | null; loc: Loc }
  | { type: 'stop'; channel: Channel; fade: number | null; loc: Loc }
  | { type: 'set'; name: string; op: AssignOp; expr: Expr; loc: Loc }
  | { type: 'jump'; target: string; loc: Loc }
  | { type: 'call'; target: string; loc: Loc }
  | { type: 'return'; loc: Loc }
  /** `end`, or `end light_holds` to reach a declared ending. */
  | { type: 'end'; ending?: string; loc: Loc }
  | { type: 'wait'; seconds: number; loc: Loc }
  | { type: 'achieve'; id: string; loc: Loc }
  /** `nvl on` (full-screen pages of text), `nvl off` (back to the text box), `nvl clear` (a new page). */
  | { type: 'nvl'; mode: NvlMode; loc: Loc }
  /** `shake` or `shake 0.8` (seconds): the picture shakes. */
  | { type: 'shake'; duration?: number; loc: Loc }
  /**
   * `hop mira`, `nod mira 2`, `bow mira`, `shake mira`, `shake textbox`: one
   * character (or the text box) moves. `forever` (and `float`, which always
   * does) keeps the move going until `still mira` or she leaves the screen.
   */
  | { type: 'motion'; motion: Motion; target: string; times?: number; forever?: boolean; loc: Loc }
  /** `still mira`: stop a character's endless move. */
  | { type: 'still'; target: string; loc: Loc }
  /** `tone sepia`, `tone mono over 2`, `tone none`: tint the picture (not the text) until changed. */
  | { type: 'tone'; tone: Tone; over: number | null; loc: Loc }
  /** `movie "movie/op.mp4"`: a full-screen video; the story waits until it ends or the player skips it. */
  | { type: 'movie'; path: string; loc: Loc }
  /**
   * `show screen hud` keeps one of the game's screens over the story until
   * `hide screen hud`; `call screen map -> place` shows it and waits for one of
   * its buttons to `return` (a value, put in the variable `into`).
   */
  | { type: 'screen'; mode: ScreenMode; name: string; into?: string; loc: Loc }
  /** `flash`, `flash red`, `flash #fff 0.3`: the screen flashes a colour (white by default). */
  | { type: 'flash'; color: string | null; duration?: number; loc: Loc }
  /**
   * `camera zoom 1.5 at 70% 30% over 3`: zoom the picture toward a point (over
   * seconds); `camera reset` (zoom null) goes back to the whole picture.
   */
  | { type: 'camera'; zoom: number | null; at: [number, number] | null; over: number | null; loc: Loc }
  | { type: 'menu'; choices: Choice[]; loc: Loc }
  | { type: 'if'; branches: IfBranch[]; loc: Loc }
);

/** An audio reference: either a declared `audio` name or a literal path. */
export type AssetRef = { kind: 'name'; name: string } | { kind: 'path'; path: string };

export type ScreenMode = 'show' | 'hide' | 'call';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  message: string;
  line: number;
  /** The file, relative to the game folder, when it isn't the main story.vn. */
  file?: string;
  /** Short machine-readable code, e.g. "unknown-label". */
  code: string;
}

/** Moves a character (or the text box) can make: a hop, a nod, a bow, a shake of the head. */
export const MOTIONS = ['hop', 'nod', 'bow', 'shake', 'float'] as const;
export type Motion = (typeof MOTIONS)[number];

/** Colour tones for the picture: old photographs and flashbacks (`sepia`), memories (`mono`). */
export const TONES = ['sepia', 'mono', 'none'] as const;
export type Tone = (typeof TONES)[number];

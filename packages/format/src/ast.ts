import type { Grade, LayerPropsSource } from './layers.ts';
import type { ScreenDef } from './screens.ts';
import type { Expr } from './expr.ts';
import type { PluginCall } from './plugins.ts';

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
  /** A comment at the end of the node's own line ("# text"). */
  comment?: string;
}

export interface CharacterDef extends Trivia { id: string; name: string; color: string | null; loc: Loc }
export interface ImageDef extends Trivia {
  name: string;
  path: string;
  /** `image beach = "cg/beach.png" gallery`: shown in the Extras gallery once seen. */
  gallery?: boolean;
  loc: Loc;
}
export interface AudioDef extends Trivia {
  name: string;
  path: string;
  /** `audio theme = "music/theme.ogg" music "Forget-Me-Not"`: in the Extras music room (with this title) once heard. */
  music?: string;
  loc: Loc;
}
/**
 * `replay beach_date "At the Beach" image cg_beach until beach_after`: the
 * scene at a label, replayable from Extras once reached. It plays until the
 * story leaves the label (or reaches `until`).
 */
export interface ReplayDef extends Trivia { label: string; name: string; image?: string; until?: string; loc: Loc }
/** One option of a layer group: `smile "sprites/mira/smile.png"`. */
export interface LayerOption extends Trivia { attr: string; path: string; loc: Loc }
/** A layer of a `layered` character: drawn always, or one option of a group at a time. */
export type LayerDef = Trivia & (
  | { kind: 'always'; path: string; loc: Loc }
  /** `optional`: nothing is drawn until one of its options is shown (`show mira blush`, `show mira -blush`). */
  | { kind: 'group'; name: string; optional: boolean; options: LayerOption[]; loc: Loc }
);
/** One key of an `animation`: at `time` seconds, these properties (the rest hold), easing toward the next key. */
export interface AnimationKey extends Trivia { time: number; props: LayerPropsSource; ease: string | null; loc: Loc }
/** `animation flicker loop:` keyed moves a layer can play (D-062). */
export interface AnimationDef extends Trivia { name: string; loop: boolean; keys: AnimationKey[]; loc: Loc }

/** `grade dusk: gamma 0.94 0.78 0.57 tint #ff6500 14% overlay`: a colour grade layers can wear (D-062). */
export interface GradeDef extends Trivia { name: string; grade: Grade; loc: Loc }

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
  /** Comments in the header: above an entry and at the end of its line, by the entry's index in `meta`. */
  metaTrivia?: Record<number, Trivia>;
  /** Comments after the header's last entry. */
  metaTrailing?: string[];
  characters: CharacterDef[];
  images: ImageDef[];
  audio: AudioDef[];
  layered: LayeredDef[];
  /** `animation` declarations (D-062); absent when there are none. */
  animations?: AnimationDef[];
  /** `grade` declarations (D-062); absent when there are none. */
  grades?: GradeDef[];
  /** `screen title:` and friends: the game's own screens (see screens.ts). */
  screens: ScreenDef[];
  vars: VarDef[];
  achievements: AchievementDef[];
  /** `replay` declarations: scenes for the Extras replay list, in order. */
  replays?: ReplayDef[];
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
  /**
   * `as`: the layer's name when it isn't the image's tag (`show street as far`); `props`: where and how it is
   * drawn (D-062), including a point for `at x y`, while `at` keeps a character's place on the bottom line.
   */
  | { type: 'show'; tag: string; attrs: string[]; as?: string; at: string | null; props?: LayerPropsSource; transition: string | null; duration?: number; loc: Loc }
  /**
   * `animate far zoom 0.7 over 3 ease in-out-sine`: move a layer toward new values, without holding up the story.
   * `animate far with drift` plays a declared `animation` instead (`animation`), and `animate far stop` stops one (null).
   */
  | { type: 'animate'; target: string; props: LayerPropsSource; over: number; ease: string | null; animation?: string | null; loc: Loc }
  /** `with dissolve 0.5` on its own line: every picture change since the last line shows through one transition. */
  | { type: 'with'; transition: string; duration?: number; loc: Loc }
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
  /** `@petals on amount=40`, `@cards play -> score`: a plugin's command (see plugins.ts). */
  | { type: 'plugin'; call: PluginCall; into?: string; loc: Loc }
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

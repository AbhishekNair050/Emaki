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
export interface ImageDef extends Trivia { name: string; path: string; loc: Loc }
export interface AudioDef extends Trivia { name: string; path: string; loc: Loc }
export interface VarDef extends Trivia {
  name: string;
  init: Expr;
  /** `global var`: kept across playthroughs (endings seen, unlocked extras), not part of saves. */
  global?: boolean;
  loc: Loc;
}
export interface AchievementDef extends Trivia { id: string; name: string; loc: Loc }
export interface LabelDef extends Trivia { name: string; body: Stmt[]; loc: Loc }

export interface Program {
  /** Frontmatter key/values (title, author, start, ...). Key order preserved. */
  meta: Array<[string, string]>;
  characters: CharacterDef[];
  images: ImageDef[];
  audio: AudioDef[];
  vars: VarDef[];
  achievements: AchievementDef[];
  labels: LabelDef[];
  /** Comments after the last line of the file. */
  trailing?: string[];
}

export type Channel = 'music' | 'sound' | 'voice';
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
  | { type: 'end'; loc: Loc }
  | { type: 'wait'; seconds: number; loc: Loc }
  | { type: 'achieve'; id: string; loc: Loc }
  | { type: 'menu'; choices: Choice[]; loc: Loc }
  | { type: 'if'; branches: IfBranch[]; loc: Loc }
);

/** An audio reference: either a declared `audio` name or a literal path. */
export type AssetRef = { kind: 'name'; name: string } | { kind: 'path'; path: string };

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

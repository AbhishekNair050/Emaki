import type { Expr } from './expr.ts';

/** 1-based source line. Every node carries one so tools can jump to source. */
export interface Loc {
  line: number;
}

export interface CharacterDef { id: string; name: string; color: string | null; loc: Loc }
export interface ImageDef { name: string; path: string; loc: Loc }
export interface AudioDef { name: string; path: string; loc: Loc }
export interface VarDef { name: string; init: Expr; loc: Loc }
export interface LabelDef { name: string; body: Stmt[]; loc: Loc }

export interface Program {
  /** Frontmatter key/values (title, author, start, ...). Key order preserved. */
  meta: Array<[string, string]>;
  characters: CharacterDef[];
  images: ImageDef[];
  audio: AudioDef[];
  vars: VarDef[];
  labels: LabelDef[];
}

export type Channel = 'music' | 'sound' | 'voice';
export type AssignOp = '=' | '+=' | '-=';

export interface Choice {
  text: string;
  cond: Expr | null;
  body: Stmt[];
  loc: Loc;
}

export interface IfBranch {
  /** null for `else`. */
  cond: Expr | null;
  body: Stmt[];
  loc: Loc;
}

export type Stmt =
  | { type: 'say'; who: string | null; attrs: string[]; text: string; loc: Loc }
  | { type: 'scene'; image: string | null; transition: string | null; loc: Loc }
  | { type: 'show'; tag: string; attrs: string[]; at: string | null; transition: string | null; loc: Loc }
  | { type: 'hide'; tag: string; transition: string | null; loc: Loc }
  | { type: 'play'; channel: Channel; asset: AssetRef; loop: boolean | null; fade: number | null; loc: Loc }
  | { type: 'stop'; channel: Channel; fade: number | null; loc: Loc }
  | { type: 'set'; name: string; op: AssignOp; expr: Expr; loc: Loc }
  | { type: 'jump'; target: string; loc: Loc }
  | { type: 'call'; target: string; loc: Loc }
  | { type: 'return'; loc: Loc }
  | { type: 'end'; loc: Loc }
  | { type: 'wait'; seconds: number; loc: Loc }
  | { type: 'menu'; choices: Choice[]; loc: Loc }
  | { type: 'if'; branches: IfBranch[]; loc: Loc };

/** An audio reference: either a declared `audio` name or a literal path. */
export type AssetRef = { kind: 'name'; name: string } | { kind: 'path'; path: string };

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  message: string;
  line: number;
  /** Short machine-readable code, e.g. "unknown-label". */
  code: string;
}

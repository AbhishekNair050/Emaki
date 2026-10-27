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

export const FORMAT_ID = 'emaki-story';
export const FORMAT_VERSION = 1;

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
  | { op: 'scene'; image: string | null; transition: string | null; src: SrcRef }
  | { op: 'show'; tag: string; attrs: string[] | null; at: string | null; transition: string | null; src: SrcRef }
  | { op: 'hide'; tag: string; transition: string | null; src: SrcRef }
  | { op: 'play'; channel: Channel; path: string; loop: boolean; fade: number | null; src: SrcRef }
  | { op: 'stop'; channel: Channel; fade: number | null; src: SrcRef }
  | { op: 'set'; name: string; expr: Expr; src: SrcRef }
  | { op: 'jump'; target: number; label?: string; src: SrcRef }
  | { op: 'jumpIfNot'; cond: Expr; target: number; src: SrcRef }
  | { op: 'menu'; id: string; choices: CompiledChoice[]; src: SrcRef }
  | { op: 'call'; target: number; label: string; src: SrcRef }
  | { op: 'return'; src: SrcRef }
  | { op: 'end'; src: SrcRef }
  | { op: 'wait'; seconds: number; src: SrcRef }
  /** Unlock an achievement (declared in `achievements`). Non-blocking. */
  | { op: 'achieve'; id: string; src: SrcRef };

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
  meta: Record<string, string>;
  /** Instruction index where the story begins. */
  start: number;
  characters: Record<string, { name: string; color: string | null }>;
  /** Image name ("mira smile", "kitchen") -> asset path. */
  images: Record<string, string>;
  audio: Record<string, string>;
  /** Achievement id -> display name. Absent when the story has none. */
  achievements?: Record<string, { name: string }>;
  /** Initial variable values. */
  vars: Record<string, Value>;
  /** Variables declared `global var`: the player keeps their values across playthroughs. */
  globals?: string[];
  /** Label name -> instruction index. */
  labels: Record<string, number>;
  code: Instr[];
  /** Content hash, used to detect saves from a different build. */
  hash: string;
}

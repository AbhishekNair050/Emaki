/**
 * The compiled story as a file: a packed form of `CompiledStory` (version 2)
 * that leaves out what repeats on almost every instruction, and the loader
 * that expands it again. Runtimes always work with the expanded form.
 *
 * Packing rules (docs/story-format.md):
 * - `src.file` and `src.label` are left out when they're the same as the
 *   previous instruction's. A `file` of "" means story.vn (no file).
 * - On `say`, `who: null` and `attrs: []` are left out.
 *
 * A full-length game's story shrinks by about a third, mostly from `src`.
 */
import type { CompiledStory, Instr, SrcRef } from './compiled.ts';

export const PACKED_VERSION = 2;

type PackedSrc = { line: number; file?: string; label?: string };

/** The story as written to disk or sent to a player. */
export function packStory(story: CompiledStory): CompiledStory {
  let file: string | undefined;
  let label: string | undefined;
  let first = true;
  const code = story.code.map((ins) => {
    const src: PackedSrc = { line: ins.src.line };
    if (first || ins.src.file !== file) src.file = ins.src.file ?? '';
    if (first || ins.src.label !== label) src.label = ins.src.label;
    file = ins.src.file;
    label = ins.src.label;
    first = false;
    const out: Record<string, unknown> = { ...ins, src };
    if (ins.op === 'say') {
      if (ins.who === null) delete out.who;
      if (ins.attrs.length === 0) delete out.attrs;
    }
    return out as unknown as Instr;
  });
  return { ...story, version: PACKED_VERSION, code };
}

/**
 * A story as read from a file, packed or not, ready to run. Stories that
 * aren't packed come back as they are.
 */
export function loadStory(story: CompiledStory): CompiledStory {
  if (story.version !== PACKED_VERSION) return story;
  let file: string | undefined;
  let label = '';
  const code = story.code.map((ins) => {
    const p = ins.src as PackedSrc;
    if (p.file !== undefined) file = p.file === '' ? undefined : p.file;
    if (p.label !== undefined) label = p.label;
    const src: SrcRef = file === undefined ? { line: p.line, label } : { line: p.line, file, label };
    const out = { ...ins, src } as Instr;
    if (out.op === 'say') {
      out.who ??= null;
      out.attrs ??= [];
    }
    return out;
  });
  return { ...story, version: 1, code };
}

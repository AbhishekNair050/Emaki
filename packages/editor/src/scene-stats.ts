/**
 * What each scene holds, from the compiled story: its lines and words, its
 * choices, the variables it sets and its first background. Worked out once
 * per compiled story, and only when a panel asks.
 */
import type { CompiledStory } from '@emaki/format';

export interface SceneStats {
  /** Lines of dialogue and narration. */
  lines: number;
  /** Menus. */
  choices: number;
  words: number;
  /** The ids of those lines, to see which a playtest has read. */
  ids: string[];
  /** Variables the scene sets, in order. */
  sets: string[];
  /** The first background it shows, as a path under assets/. */
  picture: string | null;
}

export function sceneStats(story: CompiledStory): Map<string, SceneStats> {
  const out = new Map<string, SceneStats>();
  for (const ins of story.code) {
    if (ins.op !== 'say' && ins.op !== 'menu' && ins.op !== 'set' && ins.op !== 'scene') continue;
    let s = out.get(ins.src.label);
    if (!s) out.set(ins.src.label, s = { lines: 0, choices: 0, words: 0, ids: [], sets: [], picture: null });
    if (ins.op === 'menu') s.choices++;
    else if (ins.op === 'set') { if (!s.sets.includes(ins.name)) s.sets.push(ins.name); }
    else if (ins.op === 'scene') s.picture ??= ins.image === null ? null : story.images[ins.image] ?? null;
    else {
      s.lines++;
      s.words += countWords(ins.text);
      s.ids.push(ins.id);
    }
  }
  return out;
}

function countWords(text: string): number {
  // Markup (`[w]`, `{name}`, `*`) isn't read out; CJK text has no spaces, so count its characters as words.
  const plain = text.replace(/\[[^\]]*\]/g, ' ').replace(/[*_]/g, '');
  const cjk = plain.match(/[぀-ヿ㐀-鿿가-힯]/g)?.length ?? 0;
  const words = plain.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ').split(/\s+/).filter(Boolean).length;
  return words + cjk;
}
